import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { TABLES, type FieldDef, type TableKey } from "./schema";
import type { Rows } from "./types";

// A tiny CRUD layer with two backends: Postgres in production (DATABASE_URL,
// set by Vercel's Postgres integration) and a JSON file for local dev. All
// domain logic lives in service.ts on top of this.

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
      case "date":
        out[name] = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
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

// ─── Postgres store (production: Vercel Postgres / Neon) ──────────────────

const SQL_TYPES: Record<FieldDef["type"], string> = {
  text: "text",
  longtext: "text",
  select: "text",
  number: "double precision",
  bool: "boolean",
  json: "jsonb",
  date: "timestamptz",
};

const pg = globalThis as unknown as { __reviewSql?: postgres.Sql; __reviewSchema?: Promise<void> };

// Tables and columns are created from schema.ts on first use, so a fresh
// database needs no setup step and new fields appear on the next deploy.
async function migrate(sql: postgres.Sql) {
  await sql.begin(async (tx) => {
    // Serverless instances can cold-start together; serialise the DDL.
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('vigo_review_schema'))");
    for (const key of Object.keys(TABLES) as TableKey[]) {
      const t = TABLES[key].table;
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS ${t} (id text PRIMARY KEY)`);
      for (const [name, def] of Object.entries(fieldsOf(key))) {
        await tx.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "${name}" ${SQL_TYPES[def.type]}`);
      }
    }
    await tx.unsafe("CREATE INDEX IF NOT EXISTS review_projects_status ON review_projects (status)");
    await tx.unsafe("CREATE INDEX IF NOT EXISTS review_versions_project ON review_versions (project_id)");
    await tx.unsafe("CREATE INDEX IF NOT EXISTS review_comments_project ON review_comments (project_id)");
    await tx.unsafe("CREATE INDEX IF NOT EXISTS review_comments_version ON review_comments (version_id)");
  });
}

function pgStore(url: string): Store {
  // prepare:false — Vercel/Neon hand out pooled (PgBouncer) URLs, which can't hold prepared statements.
  const sql = (pg.__reviewSql ??= postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} }));
  const ready = () =>
    (pg.__reviewSchema ??= migrate(sql).catch((e) => {
      pg.__reviewSchema = undefined;
      throw e;
    }));

  function table<K extends TableKey>(key: K): Table<Rows[K]> {
    const name = TABLES[key].table;
    const defs = fieldsOf(key);
    const col = (k: string) => {
      if (!defs[k]) throw new Error(`Unknown field ${key}.${k}`);
      return `"${k}"`;
    };
    const cast = (k: string) => `::${SQL_TYPES[defs[k].type]}`;
    const toDb = (k: string, v: unknown) => {
      const type = defs[k].type;
      if (type === "json") return JSON.stringify(v ?? []);
      if (type === "bool") return Boolean(v);
      if (v === undefined || (v === "" && type !== "text" && type !== "longtext" && type !== "select")) return null;
      return v;
    };
    const fields = (data: Record<string, unknown>) => Object.keys(data).filter((k) => defs[k] && data[k] !== undefined);
    const rows = (res: Record<string, unknown>[]) => res.map((r) => normalize(key, String(r.id), r));

    return {
      async list(where) {
        await ready();
        const params: postgres.ParameterOrJSON<never>[] = [];
        const conds: string[] = [];
        for (const [k, v] of Object.entries(where ?? {})) {
          if (Array.isArray(v)) {
            if (!v.length) return [];
            const ph = v.map((x) => {
              params.push(x);
              return `$${params.length}${cast(k)}`;
            });
            conds.push(`${col(k)} IN (${ph.join(", ")})`);
          } else if (typeof v === "boolean") {
            conds.push(`${col(k)} IS ${v ? "" : "NOT "}TRUE`);
          } else {
            params.push(v);
            conds.push(`${col(k)} = $${params.length}${cast(k)}`);
          }
        }
        const q = `SELECT * FROM ${name}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""}`;
        return rows(await sql.unsafe(q, params));
      },
      async get(id) {
        await ready();
        const res = await sql.unsafe(`SELECT * FROM ${name} WHERE id = $1`, [id]);
        return res.length ? rows(res)[0] : null;
      },
      async create(data) {
        await ready();
        const d = data as Record<string, unknown>;
        const keys = fields(d);
        const params = [newId(), ...keys.map((k) => toDb(k, d[k]))] as postgres.ParameterOrJSON<never>[];
        const q = `INSERT INTO ${name} (id${keys.map((k) => `, ${col(k)}`).join("")}) VALUES ($1${keys
          .map((k, i) => `, $${i + 2}${cast(k)}`)
          .join("")}) RETURNING *`;
        return rows(await sql.unsafe(q, params))[0];
      },
      async update(id, patch) {
        await ready();
        const d = patch as Record<string, unknown>;
        const keys = fields(d);
        if (!keys.length) {
          const row = await this.get(id);
          if (!row) throw new NotFoundError(`${key}/${id}`);
          return row;
        }
        const params = [id, ...keys.map((k) => toDb(k, d[k]))] as postgres.ParameterOrJSON<never>[];
        const q = `UPDATE ${name} SET ${keys.map((k, i) => `${col(k)} = $${i + 2}${cast(k)}`).join(", ")} WHERE id = $1 RETURNING *`;
        const res = await sql.unsafe(q, params);
        if (!res.length) throw new NotFoundError(`${key}/${id}`);
        return rows(res)[0];
      },
      async remove(id) {
        await ready();
        await sql.unsafe(`DELETE FROM ${name} WHERE id = $1`, [id]);
      },
    };
  }

  return { projects: table("projects"), versions: table("versions"), comments: table("comments"), rules: table("rules") };
}

export class NotFoundError extends Error {}

let cached: Store | null = null;

function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function storeKind(): "postgres" | "json" {
  return databaseUrl() ? "postgres" : "json";
}

export function store(): Store {
  if (cached) return cached;
  const url = databaseUrl();
  if (url) cached = pgStore(url);
  else if (process.env.VERCEL) {
    throw new Error("No database connected. In Vercel: Storage → Create Database → Postgres, then connect it to this project (it sets DATABASE_URL).");
  } else cached = jsonStore();
  return cached;
}

/** For the setup page: can we reach the database, and how much is in it. */
export async function storeStatus(): Promise<{ kind: "postgres" | "json"; ok: boolean; error?: string; counts?: Record<string, number> }> {
  const kind = storeKind();
  try {
    const s = store();
    const counts: Record<string, number> = {};
    for (const key of Object.keys(TABLES) as TableKey[]) counts[key] = (await s[key].list()).length;
    return { kind, ok: true, counts };
  } catch (e) {
    return { kind, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
