import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { TABLES, type FieldDef, type TableKey } from "./schema";
import type { Rows } from "./types";

// A tiny CRUD layer with two backends: a JSON file for local dev and Airtable
// for production. All domain logic lives in service.ts on top of this.

export type Where = Record<string, string | number | boolean | Array<string | number>>;

export interface Table<T extends { id: string }> {
  list(where?: Where): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(data: Partial<Omit<T, "id">>): Promise<T>;
  update(id: string, patch: Partial<Omit<T, "id">>): Promise<T>;
  remove(id: string): Promise<void>;
}

export type Store = { [K in TableKey]: Table<Rows[K]> };

function fieldsOf(table: TableKey): Record<string, FieldDef> {
  return TABLES[table].fields as Record<string, FieldDef>;
}

/** Fill defaults + coerce types so both backends return identical shapes. */
function normalize<K extends TableKey>(table: K, id: string, raw: Record<string, unknown>): Rows[K] {
  const out: Record<string, unknown> = { id };
  for (const [name, def] of Object.entries(fieldsOf(table))) {
    const v = raw[name];
    switch (def.type) {
      case "number":
        out[name] = typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
        break;
      case "bool":
        out[name] = v === true;
        break;
      case "json":
        if (typeof v === "string") {
          try {
            out[name] = v ? JSON.parse(v) : [];
          } catch {
            out[name] = [];
          }
        } else out[name] = v ?? [];
        break;
      default:
        out[name] = v == null ? "" : String(v);
    }
  }
  return out as unknown as Rows[K];
}

function matches(row: Record<string, unknown>, where?: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, want]) => {
    const have = row[k];
    if (Array.isArray(want)) return want.some((w) => String(w) === String(have));
    if (typeof want === "boolean") return Boolean(have) === want;
    return String(have ?? "") === String(want);
  });
}

export function newId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(14);
  let s = "rec";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

// ─── JSON file store (local dev) ──────────────────────────────────────────

type JsonDb = { [K in TableKey]: Record<string, Record<string, unknown>> };

const g = globalThis as unknown as { __reviewJsonLock?: Promise<unknown> };

function jsonStore(): Store {
  const file = path.join(process.cwd(), ".data", "review.json");

  async function read(): Promise<JsonDb> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as JsonDb;
    } catch {
      return { projects: {}, versions: {}, comments: {}, rules: {} };
    }
  }

  async function write(db: JsonDb) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, file);
  }

  // Serialise writes so concurrent requests don't clobber each other.
  function locked<R>(fn: () => Promise<R>): Promise<R> {
    const prev = g.__reviewJsonLock ?? Promise.resolve();
    const next = prev.then(fn, fn);
    g.__reviewJsonLock = next.catch(() => undefined);
    return next;
  }

  function table<K extends TableKey>(key: K): Table<Rows[K]> {
    return {
      async list(where) {
        const db = await read();
        return Object.entries(db[key])
          .filter(([, row]) => matches(row, where))
          .map(([id, row]) => normalize(key, id, row));
      },
      async get(id) {
        const row = (await read())[key][id];
        return row ? normalize(key, id, row) : null;
      },
      create(data) {
        return locked(async () => {
          const db = await read();
          const id = newId();
          const rows: Record<string, Record<string, unknown>> = db[key];
          rows[id] = { ...(data as Record<string, unknown>) };
          await write(db);
          return normalize(key, id, rows[id]);
        });
      },
      update(id, patch) {
        return locked(async () => {
          const db = await read();
          const rows: Record<string, Record<string, unknown>> = db[key];
          if (!rows[id]) throw new NotFoundError(`${key}/${id}`);
          rows[id] = { ...rows[id], ...(patch as Record<string, unknown>) };
          await write(db);
          return normalize(key, id, rows[id]);
        });
      },
      remove(id) {
        return locked(async () => {
          const db = await read();
          const rows: Record<string, Record<string, unknown>> = db[key];
          delete rows[id];
          await write(db);
        });
      },
    };
  }

  return { projects: table("projects"), versions: table("versions"), comments: table("comments"), rules: table("rules") };
}

// ─── Airtable store (production) ──────────────────────────────────────────

function airtableStore(): Store {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_REVIEW_BASE_ID || process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error("REVIEW_STORE=airtable needs AIRTABLE_TOKEN and AIRTABLE_REVIEW_BASE_ID");
  const apiRoot = (process.env.AIRTABLE_API_URL || "https://api.airtable.com").replace(/\/$/, "");

  async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as Record<string, unknown>;
      // Airtable allows 5 req/s per base; back off on 429 and transient 5xx.
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      if (res.status === 404) throw new NotFoundError(url);
      throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    }
  }

  function serialize(key: TableKey, data: Record<string, unknown>) {
    const defs = fieldsOf(key);
    const out: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(data)) {
      const def = defs[name];
      if (!def) continue;
      if (def.type === "json") out[name] = JSON.stringify(v ?? []);
      else if (def.type === "bool") out[name] = Boolean(v);
      else if (v === "" || v === undefined) out[name] = null;
      else out[name] = v;
    }
    return out;
  }

  function formula(where?: Where): string | null {
    if (!where || !Object.keys(where).length) return null;
    const q = (v: string | number) => (typeof v === "number" ? String(v) : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    const parts = Object.entries(where).map(([k, v]) => {
      if (Array.isArray(v)) return `OR(${v.map((x) => `{${k}}=${q(x)}`).join(",")})`;
      if (typeof v === "boolean") return v ? `{${k}}` : `NOT({${k}})`;
      return `{${k}}=${q(v)}`;
    });
    return parts.length === 1 ? parts[0] : `AND(${parts.join(",")})`;
  }

  function table<K extends TableKey>(key: K): Table<Rows[K]> {
    const url = `${apiRoot}/v0/${base}/${encodeURIComponent(TABLES[key].name)}`;
    type Rec = { id: string; fields: Record<string, unknown> };
    return {
      async list(where) {
        const rows: Rows[K][] = [];
        let offset: string | undefined;
        const f = formula(where);
        do {
          const params = new URLSearchParams({ pageSize: "100" });
          if (f) params.set("filterByFormula", f);
          if (offset) params.set("offset", offset);
          const page = await call(`${url}?${params}`);
          for (const r of page.records as Rec[]) rows.push(normalize(key, r.id, r.fields));
          offset = page.offset as string | undefined;
        } while (offset);
        return rows;
      },
      async get(id) {
        try {
          const r = (await call(`${url}/${id}`)) as unknown as Rec;
          return normalize(key, r.id, r.fields);
        } catch (e) {
          if (e instanceof NotFoundError) return null;
          throw e;
        }
      },
      async create(data) {
        const res = await call(url, {
          method: "POST",
          body: JSON.stringify({ records: [{ fields: serialize(key, data as Record<string, unknown>) }], typecast: true }),
        });
        const r = (res.records as Rec[])[0];
        return normalize(key, r.id, r.fields);
      },
      async update(id, patch) {
        const res = await call(url, {
          method: "PATCH",
          body: JSON.stringify({ records: [{ id, fields: serialize(key, patch as Record<string, unknown>) }], typecast: true }),
        });
        const r = (res.records as Rec[])[0];
        return normalize(key, r.id, r.fields);
      },
      async remove(id) {
        await call(`${url}/${id}`, { method: "DELETE" });
      },
    };
  }

  return { projects: table("projects"), versions: table("versions"), comments: table("comments"), rules: table("rules") };
}

export class NotFoundError extends Error {}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;
  cached = process.env.REVIEW_STORE === "airtable" ? airtableStore() : jsonStore();
  return cached;
}
