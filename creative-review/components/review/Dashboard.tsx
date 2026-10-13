"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/lib/review/types";
import { relativeTime } from "@/lib/review/time";
import { StatusPill } from "./Shell";
import { apiFetch } from "./client";

type Tab = "you" | "ai" | "approved" | "all";

const TABS: { key: Tab; label: string; match: (p: Project) => boolean }[] = [
  { key: "you", label: "Needs you", match: (p) => p.status === "in_review" },
  { key: "ai", label: "With the AI", match: (p) => ["queued", "editing", "changes_requested"].includes(p.status) },
  { key: "approved", label: "Approved", match: (p) => p.status === "approved" },
  { key: "all", label: "All", match: (p) => p.status !== "archived" },
];

export function Dashboard({ initial }: { initial: Project[] }) {
  const [projects, setProjects] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => (initial.some((p) => p.status === "in_review") ? "you" : "all"));
  const [kind, setKind] = useState<"all" | "video" | "static">("all");
  const [q, setQ] = useState("");

  // Keep the board live while the AI works.
  useEffect(() => {
    const t = setInterval(() => {
      apiFetch<{ projects: Project[] }>("/api/review/projects?archived=1")
        .then((r) => setProjects(r.projects))
        .catch(() => undefined);
    }, 20000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, projects.filter(t.match).length])), [projects]);
  const shown = projects
    .filter(TABS.find((t) => t.key === tab)!.match)
    .filter((p) => kind === "all" || p.kind === kind)
    .filter((p) => !q || `${p.name} ${p.brand} ${p.brief}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fade-up">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="eyebrow">
            <span className="dot" />
            AI edits · statics · approvals
          </div>
          <h1 className="mt-3 font-serif text-4xl leading-none sm:text-5xl">
            Review <em className="text-gold">room</em>
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/review/new" className="btn-gold btn-sm sm:hidden">
            + New
          </Link>
          <Stat n={counts.you} label="waiting on you" tone="text-gold" />
          <Stat n={counts.ai} label="with the AI" tone="text-mint" />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.key} className={`chip ${tab === t.key ? "chip-on" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} <span className="num opacity-70">{counts[t.key]}</span>
          </button>
        ))}
        <div className="seg ml-auto">
          {(["all", "video", "static"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "video" ? "Video" : "Static"}
            </button>
          ))}
        </div>
        <input className="field !w-48 !rounded-full !py-1.5 text-sm" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {shown.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="font-serif text-2xl">Nothing here.</p>
          <p className="mt-2 text-sm text-stone">
            {tab === "you" ? "No cuts are waiting on you." : "Start one with a brief and footage, or upload a static for approval."}
          </p>
          <Link href="/review/new" className="btn-gold mt-6">
            + New project
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <p className="mt-10 text-center text-xs text-stone">
        AI editor queue, Airtable sync and keys: <Link href="/review/setup" className="text-gold hover:underline">setup</Link>
      </p>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="card px-4 py-3">
      <div className={`num text-2xl ${tone}`}>{n}</div>
      <div className="k mt-1">{label}</div>
    </div>
  );
}

function ProjectCard({ p }: { p: Project }) {
  return (
    <Link href={`/review/${p.id}`} className="card group block overflow-hidden hover:-translate-y-1 hover:border-line-2">
      <div className="relative aspect-video overflow-hidden rounded-t-[22px] bg-black/60">
        {p.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.poster_url} alt="" className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full place-items-center text-stone">
            <span className="k">{p.status === "queued" || p.status === "editing" ? "AI is on it…" : "No preview"}</span>
          </div>
        )}
        <div className="absolute left-3 top-3 flex gap-2">
          <span className="chip !cursor-default !bg-black/60 !py-0.5">{p.kind === "video" ? "▶ Video" : "▣ Static"}</span>
          {p.brand && <span className="chip !cursor-default !bg-black/60 !py-0.5">{p.brand}</span>}
        </div>
        {p.current_version > 0 && <span className="tc muted absolute bottom-3 right-3">v{p.current_version}</span>}
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 truncate font-medium">{p.name}</h3>
          <StatusPill status={p.status} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-stone">
          {p.open_comments > 0 && <span className="text-gold">{p.open_comments} open note{p.open_comments === 1 ? "" : "s"}</span>}
          {p.source === "ai" && <span className="ai-badge">AI</span>}
          <span className="ml-auto">{relativeTime(p.updated_at)}</span>
        </div>
      </div>
    </Link>
  );
}
