"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./client";

type Status = { base: string; tables: { key: string; name: string; exists: boolean; missingFields: string[] }[]; created?: string[] };

export function SetupAirtable() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Status>("/api/review/setup").then(setStatus, (e) => setError(e.message));
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      setStatus(await apiFetch<Status>("/api/review/setup", { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const missing = status?.tables.filter((t) => !t.exists) ?? [];
  return (
    <section className="card mt-6 p-5">
      <div className="k">Airtable · {status?.base ?? "…"}</div>
      {error && <p className="mt-3 text-sm text-red">{error}</p>}
      <ul className="mt-3 space-y-2 text-sm">
        {status?.tables.map((t) => (
          <li key={t.key} className="flex items-center gap-3">
            <span className={t.exists ? "text-mint" : "text-amber"}>{t.exists ? "●" : "○"}</span>
            {t.name}
            {t.missingFields.length > 0 && <span className="text-xs text-amber">missing: {t.missingFields.join(", ")}</span>}
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <button className="btn-gold btn-sm mt-4" disabled={busy} onClick={() => void create()}>
          {busy ? "Creating…" : `Create ${missing.length} table${missing.length === 1 ? "" : "s"}`}
        </button>
      )}
      {status?.created?.length ? <p className="mt-3 text-sm text-mint">Created: {status.created.join(", ")}</p> : null}
    </section>
  );
}
