import "server-only";
import { TABLES, type FieldDef, type TableKey } from "./schema";

// Creates the four Review tables in the configured Airtable base from schema.ts.
// Needs a token with schema.bases:read + schema.bases:write (one-time).

function fieldSpec(name: string, def: FieldDef) {
  const base = { name, ...(def.description ? { description: def.description } : {}) };
  switch (def.type) {
    case "longtext":
    case "json":
      return { ...base, type: "multilineText" };
    case "number":
      return { ...base, type: "number", options: { precision: 4 } };
    case "bool":
      return { ...base, type: "checkbox", options: { icon: "check", color: "greenBright" } };
    case "date":
      return { ...base, type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "utc" } };
    case "select":
      return { ...base, type: "singleSelect", options: { choices: (def.choices ?? []).map((c) => ({ name: c })) } };
    default:
      return { ...base, type: "singleLineText" };
  }
}

export function tableSpec(key: TableKey) {
  const t = TABLES[key];
  const fields = Object.entries(t.fields as Record<string, FieldDef>);
  // Airtable makes the first field the primary field.
  fields.sort(([a], [b]) => (a === t.primary ? -1 : b === t.primary ? 1 : 0));
  return { name: t.name, description: t.description, fields: fields.map(([n, d]) => fieldSpec(n, d)) };
}

function creds() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_REVIEW_BASE_ID || process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error("Set AIRTABLE_TOKEN and AIRTABLE_REVIEW_BASE_ID first");
  return { token, base };
}

export async function airtableStatus(): Promise<{ base: string; tables: { key: TableKey; name: string; exists: boolean; missingFields: string[] }[] }> {
  const { token, base } = creds();
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const { tables } = (await res.json()) as { tables: { name: string; fields: { name: string }[] }[] };
  return {
    base,
    tables: (Object.keys(TABLES) as TableKey[]).map((key) => {
      const found = tables.find((t) => t.name === TABLES[key].name);
      const have = new Set(found?.fields.map((f) => f.name) ?? []);
      return {
        key,
        name: TABLES[key].name,
        exists: Boolean(found),
        missingFields: found ? Object.keys(TABLES[key].fields).filter((f) => !have.has(f)) : [],
      };
    }),
  };
}

export async function createMissingTables(): Promise<string[]> {
  const { token, base } = creds();
  const status = await airtableStatus();
  const created: string[] = [];
  for (const t of status.tables.filter((t) => !t.exists)) {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(tableSpec(t.key)),
    });
    if (!res.ok) throw new Error(`Creating ${t.name}: Airtable ${res.status} ${await res.text()}`);
    created.push(t.name);
  }
  return created;
}
