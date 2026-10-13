"use client";

import Link from "next/link";
import { useState } from "react";
import type { Rule, Scope } from "@/lib/review/types";
import { relativeTime } from "@/lib/review/time";
import { BRANDS } from "@/lib/review/labels";
import { StatusPill } from "./Shell";
import { apiFetch, getReviewerName } from "./client";

export function Playbook({ initial }: { initial: Rule[] }) {
  const [rules, setRules] = useState(initial);
  const [scope, setScope] = useState<"all" | Scope>("all");
  const [text, setText] = useState("");
  const [newScope, setNewScope] = useState<Scope>("video");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => setRules((await apiFetch<{ rules: Rule[] }>("/api/review/rules?status=all")).rules);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    await apiFetch("/api/review/rules", { method: "POST", json: { rule: text, scope: newScope, brand, created_by: getReviewerName() } }).catch(() => undefined);
    setText("");
    await reload();
    setBusy(false);
  }

  async function patch(id: string, p: Partial<Rule>) {
    await apiFetch(`/api/review/rules/${id}`, { method: "PATCH", json: p }).catch(() => undefined);
    await reload();
  }

  const inScope = rules.filter((r) => scope === "all" || r.scope === scope || r.scope === "all");
  const proposed = inScope.filter((r) => r.status === "proposed");
  const active = inScope.filter((r) => r.status === "active");
  const retired = inScope.filter((r) => r.status === "retired");

  return (
    <div className="fade-up">
      <div className="eyebrow">
        <span className="dot" />
        The AI editor&apos;s memory
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-none sm:text-5xl">
        Play<em className="text-gold">book</em>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-stone">
        Every rule here is loaded into the AI editor skill before it touches a cut. Tick <span className="text-gold">★ save to playbook</span> on any note
        and it lands here. The AI also proposes rules when it spots a pattern in your feedback — approve the good ones.
      </p>

      <div className="card mt-6 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <input className="field" placeholder="e.g. Captions never cover faces — keep them in the lower third above the UI safe zone" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <select className="field !w-auto" value={newScope} onChange={(e) => setNewScope(e.target.value as Scope)}>
          <option value="video">Video</option>
          <option value="static">Static</option>
          <option value="all">Both</option>
        </select>
        <select className="field !w-auto" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {BRANDS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code}
            </option>
          ))}
        </select>
        <button className="btn-gold btn-sm" disabled={busy || !text.trim()} onClick={() => void add()}>
          Add rule
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        {(["all", "video", "static"] as const).map((s) => (
          <button key={s} className={`chip ${scope === s ? "chip-on" : ""}`} onClick={() => setScope(s)}>
            {s === "all" ? "Everything" : s === "video" ? "Video" : "Static"}
          </button>
        ))}
        <span className="k ml-auto">{active.length} active</span>
      </div>

      {proposed.length > 0 && (
        <Section title="Proposed by the AI" hint="Approve to make it stick, or dismiss.">
          {proposed.map((r) => (
            <RuleRow key={r.id} r={r}>
              <button className="btn-gold btn-sm !py-1" onClick={() => void patch(r.id, { status: "active" })}>
                Approve
              </button>
              <button className="btn-ghost !py-1" onClick={() => void patch(r.id, { status: "retired" })}>
                Dismiss
              </button>
            </RuleRow>
          ))}
        </Section>
      )}

      <Section title="Active rules" hint="The AI follows these on every edit.">
        {active.length === 0 && <p className="px-4 py-6 text-sm text-stone">No rules yet. They build up as you leave feedback.</p>}
        {active.map((r) => (
          <RuleRow key={r.id} r={r}>
            <button className="chip !py-0.5" onClick={() => void patch(r.id, { status: "retired" })}>
              Retire
            </button>
          </RuleRow>
        ))}
      </Section>

      {retired.length > 0 && (
        <Section title="Retired" hint="Kept for history; not sent to the AI.">
          {retired.map((r) => (
            <RuleRow key={r.id} r={r} dim>
              <button className="chip !py-0.5" onClick={() => void patch(r.id, { status: "active" })}>
                Restore
              </button>
            </RuleRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="card mt-6 overflow-hidden p-0">
      <div className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <h2 className="font-serif text-2xl">{title}</h2>
        <span className="text-xs text-stone">{hint}</span>
      </div>
      <ul className="divide-y divide-[var(--line)]">{children}</ul>
    </section>
  );
}

function RuleRow({ r, children, dim }: { r: Rule; children: React.ReactNode; dim?: boolean }) {
  return (
    <li className={`flex flex-wrap items-start gap-3 px-4 py-3 ${dim ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{r.rule}</p>
        {r.detail && <p className="mt-1 text-xs text-stone">{r.detail}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-stone">
          <StatusPill status={r.status} />
          <span className="chip !cursor-default !py-0">{r.scope === "all" ? "video + static" : r.scope}</span>
          {r.brand && <span className="chip !cursor-default !py-0">{r.brand}</span>}
          {r.created_by && <span>by {r.created_by}</span>}
          <span>{relativeTime(r.created_at)}</span>
          {r.source_project_id && (
            <Link className="text-gold hover:underline" href={`/review/${r.source_project_id}${r.source_comment_id ? `?c=${r.source_comment_id}` : ""}`}>
              from a note ↗
            </Link>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  );
}
