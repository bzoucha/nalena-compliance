"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Comment, ProjectBundle, Version } from "@/lib/review/types";
import { formatTimecode, relativeTime } from "@/lib/review/time";
import { STATUS_LABEL } from "@/lib/review/labels";
import { StatusPill } from "./Shell";
import { apiFetch, formatBytes, getReviewerName, probeMedia, setReviewerName, uploadFile } from "./client";
import { VideoPlayer, type Marker, type Pin, type PlayerHandle } from "./VideoPlayer";
import { ImageViewer } from "./ImageViewer";
import { DropZone } from "./DropZone";

interface Draft {
  body: string;
  t: number | null;
  tEnd: number | null;
  x: number | null;
  y: number | null;
  timed: boolean;
  saveAsRule: boolean;
}

const EMPTY_DRAFT: Draft = { body: "", t: null, tEnd: null, x: null, y: null, timed: true, saveAsRule: false };

type Filter = "open" | "resolved" | "all";
type Side = "notes" | "changes" | "brief";

export function ReviewRoom({ initial }: { initial: ProjectBundle }) {
  const [bundle, setBundle] = useState(initial);
  const { project, versions, comments } = bundle;
  const latest = versions.at(-1) ?? null;
  const [vNum, setVNum] = useState<number | null>(latest?.number ?? null);
  const version = versions.find((v) => v.number === vNum) ?? latest;
  const isLatest = Boolean(version && latest && version.id === latest.id);
  const isVideo = project.kind === "video";

  const [compareNum, setCompareNum] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [side, setSide] = useState<Side>("notes");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pinMode, setPinMode] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [deciding, setDeciding] = useState<null | "approve" | "request_changes">(null);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [help, setHelp] = useState(false);

  const player = useRef<PlayerHandle>(null);
  const comparePlayer = useRef<PlayerHandle>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const latestNumRef = useRef(latest?.number ?? 0);

  const [knownName, setKnownName] = useState(true);
  useEffect(() => {
    const n = getReviewerName();
    setName(n);
    setKnownName(Boolean(n));
  }, []);

  // Deep link: ?v=2&c=recXXX
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const v = Number(q.get("v"));
    if (v && initial.versions.some((x) => x.number === v)) setVNum(v);
    const c = q.get("c");
    if (c) setActiveId(c);
  }, [initial.versions]);

  useEffect(() => {
    if (!version) return;
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(version.number));
    if (activeId) url.searchParams.set("c", activeId);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, [version, activeId]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  const refresh = useCallback(async () => {
    const next = await apiFetch<ProjectBundle>(`/api/review/projects/${project.id}`);
    const newLatest = next.versions.at(-1)?.number ?? 0;
    const prevLatest = latestNumRef.current;
    if (newLatest > prevLatest) {
      // Follow the new cut only if you were on the latest one; don't yank you off an old version.
      setVNum((cur) => (cur == null || cur === prevLatest ? newLatest : cur));
      if (prevLatest > 0) flash(`v${newLatest} just landed`);
      latestNumRef.current = newLatest;
    }
    setBundle(next);
    return next;
  }, [project.id, flash]);

  // Poll faster while the AI is working so v(n+1) shows up on its own.
  useEffect(() => {
    const waiting = ["queued", "editing", "changes_requested"].includes(project.status);
    const t = window.setInterval(() => void refresh().catch(() => undefined), waiting ? 8000 : 30000);
    return () => window.clearInterval(t);
  }, [project.status, refresh]);

  // ── Comments for the version on screen ──────────────────────────────────
  const vComments = useMemo(() => comments.filter((c) => c.version_id === version?.id), [comments, version?.id]);
  const topLevel = useMemo(() => vComments.filter((c) => !c.parent_id), [vComments]);
  const numbered = useMemo(() => new Map(topLevel.map((c, i) => [c.id, i + 1])), [topLevel]);
  const repliesOf = useCallback((id: string) => vComments.filter((c) => c.parent_id === id), [vComments]);
  const openCount = topLevel.filter((c) => c.status === "open").length;
  const shown = topLevel.filter((c) => filter === "all" || c.status === filter);

  const markers: Marker[] = topLevel
    .filter((c) => c.timecode != null)
    .map((c) => ({ id: c.id, n: numbered.get(c.id)!, t: c.timecode!, tEnd: c.timecode_end, resolved: c.status === "resolved" }));
  const pins: Pin[] = topLevel
    .filter((c) => c.x != null && c.y != null)
    .map((c) => ({ id: c.id, n: numbered.get(c.id)!, x: c.x!, y: c.y!, t: c.timecode, resolved: c.status === "resolved" }));

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      const c = comments.find((x) => x.id === id);
      if (c?.timecode != null) {
        player.current?.pause();
        player.current?.seek(c.timecode);
      }
      document.getElementById(`c-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setSide("notes");
    },
    [comments],
  );

  const captureTime = useCallback(() => {
    if (!isVideo || !player.current) return;
    player.current.pause();
    const now = player.current.time();
    setDraft((d) => (d.timed && d.t == null ? { ...d, t: now } : d));
  }, [isVideo]);

  // ── Keyboard shortcuts (frame.io-ish) ───────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const p = player.current;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const order = [...topLevel].filter((c) => c.timecode != null || !isVideo);
      const idx = order.findIndex((c) => c.id === activeId);
      switch (key) {
        case " ":
        case "k":
          if (!isVideo) return;
          e.preventDefault();
          p?.toggle();
          break;
        case "ArrowLeft":
          if (!isVideo) return;
          e.preventDefault();
          if (e.shiftKey) p?.nudge(-1);
          else p?.step(-1);
          break;
        case "ArrowRight":
          if (!isVideo) return;
          e.preventDefault();
          if (e.shiftKey) p?.nudge(1);
          else p?.step(1);
          break;
        case "j":
          p?.nudge(-5);
          break;
        case "l":
          p?.nudge(5);
          break;
        case "c":
        case "Enter":
          e.preventDefault();
          composer.current?.focus();
          break;
        case "i":
          if (!p) return;
          setDraft((d) => ({ ...d, timed: true, t: p.time(), tEnd: d.tEnd != null && d.tEnd > p.time() ? d.tEnd : null }));
          flash(`In point ${formatTimecode(p.time())}`);
          break;
        case "o":
          if (!p) return;
          setDraft((d) => {
            const now = p.time();
            const start = d.t ?? 0;
            return now > start ? { ...d, timed: true, t: start, tEnd: now } : d;
          });
          flash(`Out point ${formatTimecode(p.time())}`);
          break;
        case "p":
          if (isVideo) setPinMode((m) => !m);
          break;
        case "m":
          p?.toggleMute();
          break;
        case "f":
          p?.fullscreen();
          break;
        case "[":
          if (order.length) activate(order[idx <= 0 ? order.length - 1 : idx - 1].id);
          break;
        case "]":
          if (order.length) activate(order[idx < 0 || idx >= order.length - 1 ? 0 : idx + 1].id);
          break;
        case "?":
          setHelp((h) => !h);
          break;
        case "Escape":
          setPinMode(false);
          setActiveId(null);
          setHelp(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, activate, flash, isVideo, topLevel]);

  // ── Actions ─────────────────────────────────────────────────────────────
  function ensureName(): string {
    const n = name.trim();
    if (n) setReviewerName(n);
    return n || "Reviewer";
  }

  async function submitComment() {
    if (!version || !draft.body.trim() || busy) return;
    setBusy(true);
    try {
      const timed = isVideo && draft.timed && draft.t != null;
      await apiFetch("/api/review/comments", {
        method: "POST",
        json: {
          project_id: project.id,
          version_id: version.id,
          author: ensureName(),
          body: draft.body,
          timecode: timed ? draft.t : null,
          timecode_end: timed ? draft.tEnd : null,
          x: draft.x,
          y: draft.y,
          save_as_rule: draft.saveAsRule,
        },
      });
      setDraft({ ...EMPTY_DRAFT, timed: draft.timed });
      setPinMode(false);
      if (draft.saveAsRule) flash("Saved to the playbook — the AI will apply it on every edit");
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't post");
    } finally {
      setBusy(false);
    }
  }

  async function patchComment(id: string, patch: Record<string, unknown>, msg?: string) {
    try {
      await apiFetch(`/api/review/comments/${id}`, { method: "PATCH", json: { ...patch, by: name } });
      if (msg) flash(msg);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't update");
    }
  }

  async function removeComment(id: string) {
    if (!window.confirm("Delete this note?")) return;
    await apiFetch(`/api/review/comments/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (activeId === id) setActiveId(null);
    await refresh();
  }

  async function sendReply(parent: Comment) {
    if (!replyBody.trim() || !version) return;
    await apiFetch("/api/review/comments", {
      method: "POST",
      json: { project_id: project.id, version_id: parent.version_id, parent_id: parent.id, author: ensureName(), body: replyBody },
    }).catch((e) => flash(e.message));
    setReplyBody("");
    setReplyTo(null);
    await refresh();
  }

  async function decide(decision: "approve" | "request_changes", note: string) {
    if (!version) return;
    setBusy(true);
    try {
      await apiFetch(`/api/review/projects/${project.id}/decision`, {
        method: "POST",
        json: { version_id: version.id, decision, by: ensureName(), note },
      });
      setDeciding(null);
      flash(decision === "approve" ? `v${version.number} approved` : "Notes sent to the AI editor");
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const compareVersion = compareNum != null ? versions.find((v) => v.number === compareNum) : null;
  const prevVersion = version ? versions.find((v) => v.number === version.number - 1) : null;
  const prevNotes = prevVersion ? comments.filter((c) => c.version_id === prevVersion.id && !c.parent_id) : [];

  return (
    <div className="fade-up">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/review" className="chip">
          ← Projects
        </Link>
        <h1 className="min-w-0 truncate font-serif text-3xl leading-none sm:text-4xl">{project.name}</h1>
        <StatusPill status={project.status} />
        {project.brand && <span className="chip !cursor-default">{project.brand}</span>}
        {project.format && <span className="chip !cursor-default">{project.format}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {versions.length > 0 && (
            <select
              className="chip"
              value={version?.number ?? ""}
              onChange={(e) => {
                setVNum(Number(e.target.value));
                setActiveId(null);
                setDraft((d) => ({ ...EMPTY_DRAFT, timed: d.timed }));
              }}
              aria-label="Version"
            >
              {[...versions].reverse().map((v) => (
                <option key={v.id} value={v.number}>
                  v{v.number} · {STATUS_LABEL[v.status] ?? v.status} · {relativeTime(v.created_at)}
                </option>
              ))}
            </select>
          )}
          {versions.length > 1 && version && (
            <select
              className={`chip ${compareNum != null ? "chip-on" : ""}`}
              value={compareNum ?? ""}
              onChange={(e) => setCompareNum(e.target.value ? Number(e.target.value) : null)}
              aria-label="Compare with"
            >
              <option value="">⇆ Compare</option>
              {versions
                .filter((v) => v.number !== version.number)
                .map((v) => (
                  <option key={v.id} value={v.number}>
                    vs v{v.number}
                  </option>
                ))}
            </select>
          )}
          <button className="btn-ghost" onClick={() => setUploading(true)}>
            ↑ Upload version
          </button>
          <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setHelp((h) => !h)}>
            ?
          </button>
        </div>
      </div>

      {!version ? (
        <WaitingForFirstCut project={bundle.project} onUpload={() => setUploading(true)} />
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* ── Stage + composer ── */}
          <section className="min-w-0">
            {!isLatest && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl border border-amber/40 bg-amber/10 px-4 py-2 text-sm text-amber">
                You&apos;re looking at v{version.number}. Notes here are history — the AI works from v{latest!.number}.
                <button className="chip ml-auto" onClick={() => setVNum(latest!.number)}>
                  Go to v{latest!.number}
                </button>
              </div>
            )}

            <div className={compareVersion ? "grid gap-3 md:grid-cols-2" : ""}>
              {compareVersion && (
                <div>
                  <div className="k mb-2">v{compareVersion.number}</div>
                  {isVideo ? (
                    <VideoPlayer ref={comparePlayer} src={compareVersion.file_url} width={compareVersion.width} height={compareVersion.height} minimal maxHeight="60vh" />
                  ) : (
                    <ImageViewer src={compareVersion.file_url} width={compareVersion.width} height={compareVersion.height} readOnly maxHeight="60vh" />
                  )}
                </div>
              )}
              <div>
                {compareVersion && <div className="k mb-2 text-gold">v{version.number}</div>}
                {isVideo ? (
                  <VideoPlayer
                    key={version.id}
                    ref={player}
                    src={version.file_url}
                    fps={version.fps || 30}
                    width={version.width}
                    height={version.height}
                    markers={markers}
                    pins={pins}
                    activeId={activeId}
                    draftPin={draft.x != null && draft.y != null ? { x: draft.x, y: draft.y } : null}
                    draftRange={draft.t != null ? { t: draft.t, tEnd: draft.tEnd } : null}
                    pinMode={pinMode && isLatest}
                    maxHeight={compareVersion ? "60vh" : "64vh"}
                    onPlacePin={(x, y) => {
                      captureTime();
                      setDraft((d) => ({ ...d, x, y }));
                      setPinMode(false);
                      composer.current?.focus();
                    }}
                    onMarker={activate}
                    onTick={(t, playing) => comparePlayer.current?.follow(t, playing)}
                  />
                ) : (
                  <ImageViewer
                    key={version.id}
                    src={version.file_url}
                    width={version.width}
                    height={version.height}
                    pins={pins}
                    activeId={activeId}
                    readOnly={!isLatest}
                    draftPin={draft.x != null && draft.y != null ? { x: draft.x, y: draft.y } : null}
                    maxHeight={compareVersion ? "60vh" : "68vh"}
                    onPlacePin={(x, y) => {
                      setDraft((d) => ({ ...d, x, y }));
                      composer.current?.focus();
                    }}
                    onPin={activate}
                  />
                )}
              </div>
            </div>

            {/* Composer */}
            {isLatest && (
              <div className="card mt-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {isVideo &&
                    (draft.timed ? (
                      <span className="tc" title="Click to re-sync to the playhead" onClick={() => player.current && setDraft((d) => ({ ...d, t: player.current!.time(), tEnd: null }))}>
                        ⏱ {draft.t != null ? formatTimecode(draft.t) : "at playhead"}
                        {draft.tEnd != null && ` → ${formatTimecode(draft.tEnd)}`}
                      </span>
                    ) : (
                      <span className="tc muted">General note</span>
                    ))}
                  {isVideo && (
                    <button className="chip !py-0.5" onClick={() => setDraft((d) => ({ ...d, timed: !d.timed, t: null, tEnd: null }))}>
                      {draft.timed ? "Make general" : "Pin to time"}
                    </button>
                  )}
                  {isVideo && draft.timed && (
                    <button
                      className="chip !py-0.5"
                      title="Set the end of a range (O)"
                      onClick={() => {
                        const now = player.current?.time() ?? 0;
                        setDraft((d) => (d.t != null && now > d.t ? { ...d, tEnd: now } : d));
                      }}
                    >
                      ⇥ Range end
                    </button>
                  )}
                  {isVideo && (
                    <button className={`chip !py-0.5 ${pinMode ? "chip-on" : ""}`} onClick={() => setPinMode((m) => !m)} title="Drop a pin on the frame (P)">
                      📍 {draft.x != null ? "Move pin" : "Pin on frame"}
                    </button>
                  )}
                  {draft.x != null && (
                    <button className="chip !py-0.5" onClick={() => setDraft((d) => ({ ...d, x: null, y: null }))}>
                      × Remove pin
                    </button>
                  )}
                  {!isVideo && draft.x == null && <span className="text-xs text-stone">Click the ad to pin this note, or leave it general.</span>}
                </div>
                <textarea
                  ref={composer}
                  className="field mt-3 min-h-20 resize-y"
                  placeholder={isVideo ? "What should change here? (C to focus · ⌘↵ to post)" : "What should change? (⌘↵ to post)"}
                  value={draft.body}
                  onFocus={captureTime}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void submitComment();
                    }
                  }}
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-stone" title="Becomes a standing rule the AI editor loads before every edit">
                    <input type="checkbox" checked={draft.saveAsRule} onChange={(e) => setDraft((d) => ({ ...d, saveAsRule: e.target.checked }))} className="accent-[var(--gold)]" />
                    <span>
                      ★ Always do this — <span className="text-cream">save to playbook</span>
                    </span>
                  </label>
                  {!knownName && (
                    <input className="field !w-36 !rounded-full !py-1 text-xs" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                  )}
                  <button className="btn-gold btn-sm ml-auto" disabled={!draft.body.trim() || busy} onClick={() => void submitComment()}>
                    Post note
                  </button>
                </div>
              </div>
            )}

            {/* Decision bar */}
            {isLatest && (
              <DecisionBar
                version={version}
                openCount={openCount}
                busy={busy}
                deciding={deciding}
                setDeciding={setDeciding}
                onDecide={decide}
              />
            )}
          </section>

          {/* ── Sidebar ── */}
          <aside className="card flex min-h-[420px] flex-col p-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <div className="seg">
                <button className={side === "notes" ? "on" : ""} onClick={() => setSide("notes")}>
                  Notes {topLevel.length > 0 && <span className="opacity-70">{topLevel.length}</span>}
                </button>
                {version.number > 1 && (
                  <button className={side === "changes" ? "on" : ""} onClick={() => setSide("changes")}>
                    What changed
                  </button>
                )}
                <button className={side === "brief" ? "on" : ""} onClick={() => setSide("brief")}>
                  Brief
                </button>
              </div>
            </div>

            {side === "notes" && (
              <>
                <div className="flex items-center gap-2 px-4 pt-3">
                  {(["all", "open", "resolved"] as const).map((f) => (
                    <button key={f} className={`chip !py-0.5 ${filter === f ? "chip-on" : ""}`} onClick={() => setFilter(f)}>
                      {f === "all" ? "All" : f === "open" ? `Open ${openCount}` : `Resolved ${topLevel.length - openCount}`}
                    </button>
                  ))}
                </div>
                <ol className="scroll-thin mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
                  {shown.length === 0 && (
                    <li className="px-3 py-8 text-center text-sm text-stone">
                      {topLevel.length ? "Nothing in this filter." : isVideo ? "Pause anywhere and type — the note sticks to that frame." : "Click the ad to drop your first pin."}
                    </li>
                  )}
                  {shown.map((c) => (
                    <CommentItem
                      key={c.id}
                      c={c}
                      n={numbered.get(c.id)!}
                      active={c.id === activeId}
                      replies={repliesOf(c.id)}
                      canAct={isLatest}
                      replying={replyTo === c.id}
                      replyBody={replyBody}
                      setReplyBody={setReplyBody}
                      onActivate={() => activate(c.id)}
                      onReply={() => {
                        setReplyTo(replyTo === c.id ? null : c.id);
                        setReplyBody("");
                      }}
                      onSendReply={() => void sendReply(c)}
                      onToggle={() => void patchComment(c.id, { status: c.status === "open" ? "resolved" : "open" })}
                      onRule={() => void patchComment(c.id, { save_as_rule: true }, "Saved to the playbook")}
                      onDelete={() => void removeComment(c.id)}
                    />
                  ))}
                </ol>
              </>
            )}

            {side === "changes" && version.number > 1 && (
              <div className="scroll-thin flex-1 overflow-y-auto p-4 text-sm">
                <div className="k">v{version.number} changelog</div>
                <p className="prose-pre mt-2 text-cream">{version.notes || "No notes from the uploader."}</p>
                <div className="k mt-5">Notes on v{version.number - 1}</div>
                <ul className="mt-2 space-y-2">
                  {prevNotes.length === 0 && <li className="text-stone">No notes on v{version.number - 1}.</li>}
                  {prevNotes.map((c, i) => (
                    <li key={c.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-center gap-2">
                        <span className={c.status === "resolved" ? "tc resolved" : "tc"}>{c.timecode != null ? formatTimecode(c.timecode) : `#${i + 1}`}</span>
                        <span className={`text-xs ${c.status === "resolved" ? "text-mint" : "text-amber"}`}>
                          {c.status === "resolved" ? `✓ addressed${c.resolved_in_version ? ` in v${c.resolved_in_version}` : ""}` : "⚠ not marked addressed"}
                        </span>
                      </div>
                      <p className="mt-2 text-stone">{c.body}</p>
                      {c.resolution && <p className="mt-2 border-l-2 border-mint/60 pl-3 text-cream">{c.resolution}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {side === "brief" && (
              <div className="scroll-thin flex-1 overflow-y-auto p-4 text-sm">
                <div className="k">Brief</div>
                <p className="prose-pre mt-2 text-cream">{project.brief || "—"}</p>
                {project.footage.length > 0 && (
                  <>
                    <div className="k mt-5">Source files</div>
                    <ul className="mt-2 space-y-1">
                      {project.footage.map((f) => (
                        <li key={f.url} className="flex gap-2">
                          <a className="min-w-0 flex-1 truncate text-gold hover:underline" href={f.url} target="_blank" rel="noreferrer">
                            {f.name}
                          </a>
                          <span className="num text-xs text-stone">{formatBytes(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="k mt-5">This version</div>
                <ul className="mt-2 space-y-1 text-stone">
                  <li>
                    {version.file_name || "file"} {version.size ? `· ${formatBytes(version.size)}` : ""}
                  </li>
                  {version.width && (
                    <li className="num">
                      {version.width}×{version.height}
                      {version.duration ? ` · ${formatTimecode(version.duration)}` : ""}
                    </li>
                  )}
                  <li>
                    Uploaded by {version.uploaded_by || "—"} · {relativeTime(version.created_at)}
                  </li>
                  <li>
                    <a className="text-gold hover:underline" href={version.file_url} download={version.file_name || undefined} target="_blank" rel="noreferrer">
                      Download ↓
                    </a>
                  </li>
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      {uploading && (
        <UploadVersion
          projectId={project.id}
          kind={project.kind}
          nextNumber={(latest?.number ?? 0) + 1}
          openNotes={latest ? comments.filter((c) => c.version_id === latest.id && !c.parent_id && c.status === "open") : []}
          uploader={name}
          onClose={() => setUploading(false)}
          onDone={async (n) => {
            setUploading(false);
            latestNumRef.current = n;
            await refresh();
            setVNum(n);
            flash(`v${n} uploaded`);
          }}
        />
      )}

      {help && <ShortcutHelp isVideo={isVideo} onClose={() => setHelp(false)} />}

      {toast && (
        <div className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full border border-line-2 bg-bg-2 px-4 py-2 text-sm shadow-xl" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  c,
  n,
  active,
  replies,
  canAct,
  replying,
  replyBody,
  setReplyBody,
  onActivate,
  onReply,
  onSendReply,
  onToggle,
  onRule,
  onDelete,
}: {
  c: Comment;
  n: number;
  active: boolean;
  replies: Comment[];
  canAct: boolean;
  replying: boolean;
  replyBody: string;
  setReplyBody: (s: string) => void;
  onActivate: () => void;
  onReply: () => void;
  onSendReply: () => void;
  onToggle: () => void;
  onRule: () => void;
  onDelete: () => void;
}) {
  const resolved = c.status === "resolved";
  return (
    <li id={`c-${c.id}`} className={`comment group px-3 py-3 ${active ? "active" : ""} ${resolved ? "is-resolved" : ""}`}>
      <div className="flex cursor-pointer items-center gap-2" onClick={onActivate}>
        <span className="num w-5 text-xs text-stone">#{n}</span>
        {c.timecode != null ? (
          <span className={`tc ${resolved ? "resolved" : ""}`}>
            {formatTimecode(c.timecode)}
            {c.timecode_end != null && `–${formatTimecode(c.timecode_end)}`}
          </span>
        ) : c.x != null ? (
          <span className={`tc ${resolved ? "resolved" : ""}`}>📍 pin</span>
        ) : (
          <span className="tc muted">general</span>
        )}
        {c.x != null && c.timecode != null && <span className="text-xs" title="Pinned on frame">📍</span>}
        <span className="truncate text-xs font-medium">{c.author}</span>
        {c.author_kind === "ai" && <span className="ai-badge">AI</span>}
        <span className="ml-auto shrink-0 text-[11px] text-stone">{relativeTime(c.created_at)}</span>
      </div>
      <p className="comment-body prose-pre mt-2 cursor-pointer text-sm" onClick={onActivate}>
        {c.body}
      </p>
      {c.rule_id && <div className="mt-2 text-[11px] text-gold">★ In the playbook</div>}
      {c.resolution && (
        <div className="mt-2 rounded-lg border-l-2 border-mint/60 bg-mint/5 py-1.5 pl-3 pr-2 text-xs text-cream">
          <span className="ai-badge mr-1.5">AI</span>
          {c.resolved_in_version ? <span className="text-mint">Fixed in v{c.resolved_in_version}: </span> : null}
          {c.resolution}
        </div>
      )}
      {replies.length > 0 && (
        <ul className="mt-2 space-y-2 border-l border-line pl-3">
          {replies.map((r) => (
            <li key={r.id} className="text-sm">
              <span className="text-xs font-medium">{r.author}</span> {r.author_kind === "ai" && <span className="ai-badge">AI</span>}{" "}
              <span className="text-[11px] text-stone">{relativeTime(r.created_at)}</span>
              <p className="prose-pre text-stone">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canAct && (
        <div className="mt-2 flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
          <button className="chip !py-0.5" onClick={onToggle}>
            {resolved ? "↺ Reopen" : "✓ Resolve"}
          </button>
          <button className="chip !py-0.5" onClick={onReply}>
            Reply
          </button>
          {!c.rule_id && (
            <button className="chip !py-0.5" onClick={onRule} title="Make this a standing rule for the AI editor">
              ★ Playbook
            </button>
          )}
          <button className="icon-btn danger ml-auto" aria-label="Delete note" onClick={onDelete}>
            ×
          </button>
        </div>
      )}
      {replying && (
        <div className="mt-2 flex gap-2">
          <input
            className="field !rounded-full !py-1.5 text-sm"
            autoFocus
            placeholder="Reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSendReply()}
          />
          <button className="btn-ghost !py-1" onClick={onSendReply}>
            Send
          </button>
        </div>
      )}
    </li>
  );
}

function DecisionBar({
  version,
  openCount,
  busy,
  deciding,
  setDeciding,
  onDecide,
}: {
  version: Version;
  openCount: number;
  busy: boolean;
  deciding: null | "approve" | "request_changes";
  setDeciding: (d: null | "approve" | "request_changes") => void;
  onDecide: (d: "approve" | "request_changes", note: string) => void;
}) {
  const [note, setNote] = useState("");
  if (version.status === "approved") {
    return (
      <div className="card mt-4 flex flex-wrap items-center gap-3 border-mint/40 p-4">
        <span className="pill st-approved">Approved</span>
        <span className="text-sm text-stone">
          v{version.number} approved{version.decision_by ? ` by ${version.decision_by}` : ""}. {version.decision_note}
        </span>
        <a className="btn-ghost ml-auto" href={version.file_url} target="_blank" rel="noreferrer" download>
          Download final ↓
        </a>
      </div>
    );
  }
  if (version.status === "changes_requested" && !deciding) {
    return (
      <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
        <span className="dot" />
        <span className="text-sm">
          Notes sent to the AI editor — <span className="text-stone">v{version.number + 1} will show up here automatically.</span>
        </span>
        <button className="btn-ghost ml-auto" onClick={() => setDeciding("approve")}>
          Approve v{version.number} anyway
        </button>
      </div>
    );
  }
  return (
    <div className="card mt-4 p-4">
      {deciding ? (
        <div className="grid gap-3">
          <div className="font-medium">
            {deciding === "approve"
              ? `Approve v${version.number}?`
              : `Send ${openCount} note${openCount === 1 ? "" : "s"} to the AI editor for v${version.number + 1}?`}
          </div>
          <textarea
            className="field min-h-16"
            placeholder={deciding === "approve" ? "Optional note (e.g. ready to launch)" : "Optional overall note (e.g. tighten everything by ~10%)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button className={deciding === "approve" ? "btn-gold btn-sm" : "btn-ghost btn-amber"} disabled={busy} onClick={() => onDecide(deciding, note)}>
              {deciding === "approve" ? "✓ Approve" : "Send to AI →"}
            </button>
            <button className="btn-ghost" onClick={() => setDeciding(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone">
            {openCount ? (
              <>
                <span className="text-gold">{openCount}</span> open note{openCount === 1 ? "" : "s"} on v{version.number}
              </>
            ) : (
              `No open notes on v${version.number}.`
            )}
          </span>
          <button className="btn-ghost btn-amber ml-auto" onClick={() => setDeciding("request_changes")}>
            Request changes{openCount ? ` · ${openCount}` : ""}
          </button>
          <button className="btn-gold btn-sm" onClick={() => setDeciding("approve")}>
            ✓ Approve v{version.number}
          </button>
        </div>
      )}
    </div>
  );
}

function WaitingForFirstCut({ project, onUpload }: { project: ProjectBundle["project"]; onUpload: () => void }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="card grid min-h-[360px] place-items-center p-10 text-center">
        <div>
          <div className="eyebrow justify-center">
            <span className="dot" />
            {project.status === "editing" ? `AI editing${project.claimed_by ? ` · ${project.claimed_by}` : ""}` : "In the AI queue"}
          </div>
          <p className="mt-4 font-serif text-3xl">Waiting for the first cut.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone">
            The AI editor picks this up from its queue, cuts v1 from the brief and footage, and uploads it here. This page updates on its own.
          </p>
          <button className="btn-ghost mt-6" onClick={onUpload}>
            Or upload v1 yourself
          </button>
        </div>
      </div>
      <aside className="card p-5 text-sm">
        <div className="k">Brief</div>
        <p className="prose-pre mt-2">{project.brief || "—"}</p>
        {project.footage.length > 0 && (
          <>
            <div className="k mt-5">Footage</div>
            <ul className="mt-2 space-y-1">
              {project.footage.map((f) => (
                <li key={f.url} className="flex gap-2">
                  <a className="min-w-0 flex-1 truncate text-gold hover:underline" href={f.url} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                  <span className="num text-xs text-stone">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

function UploadVersion({
  projectId,
  kind,
  nextNumber,
  openNotes,
  uploader,
  onClose,
  onDone,
}: {
  projectId: string;
  kind: "video" | "static";
  nextNumber: number;
  openNotes: Comment[];
  uploader: string;
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [resolve, setResolve] = useState(true);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const info = await probeMedia(file);
      const folder = `${projectId}/v${nextNumber}`;
      const ref = await uploadFile(file, file.name, folder, setPct);
      const poster = info.poster ? await uploadFile(info.poster, "poster.jpg", folder) : null;
      const res = await apiFetch<{ version: Version }>(`/api/review/projects/${projectId}/versions`, {
        method: "POST",
        json: {
          file_url: ref.url,
          file_name: file.name,
          mime: file.type,
          size: file.size,
          width: info.width,
          height: info.height,
          duration: info.duration,
          poster_url: poster?.url ?? "",
          notes,
          uploaded_by: uploader || "Reviewer",
          resolutions: resolve ? openNotes.map((c) => ({ comment_id: c.id, resolution: "Addressed in this upload." })) : [],
        },
      });
      onDone(res.version.number);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="font-serif text-3xl">Upload v{nextNumber}</h2>
          <button className="icon-btn ml-auto" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-stone">The AI editor normally does this itself; use it for manual cuts or designer statics.</p>
        <DropZone accept={kind === "video" ? "video/*" : "image/*"} onFiles={([f]) => setFile(f)} className="mt-4 p-6 text-center text-sm">
          {file ? (
            <span>
              {file.name} <span className="text-stone">· {formatBytes(file.size)}</span>
            </span>
          ) : (
            <span className="text-stone">Drop the new {kind === "video" ? "cut" : "image"} or click</span>
          )}
        </DropZone>
        {busy && (
          <div className="progress mt-3">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        <label className="mt-4 block">
          <span className="label">What changed</span>
          <textarea className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tightened the hook, new captions…" />
        </label>
        {openNotes.length > 0 && (
          <label className="mt-3 flex items-center gap-2 text-sm text-stone">
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} className="accent-[var(--gold)]" />
            Mark the {openNotes.length} open note{openNotes.length === 1 ? "" : "s"} on the last version as addressed
          </label>
        )}
        {error && <p className="mt-3 text-sm text-red">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button className="btn-gold btn-sm" disabled={!file || busy} onClick={() => void go()}>
            {busy ? `Uploading ${Math.round(pct)}%` : `Upload v${nextNumber}`}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ShortcutHelp({ isVideo, onClose }: { isVideo: boolean; onClose: () => void }) {
  const rows: [string, string][] = isVideo
    ? [
        ["Space / K", "Play · pause"],
        ["← / →", "Step one frame"],
        ["Shift + ← / →", "Jump 1 second"],
        ["J / L", "Jump 5 seconds"],
        ["C or Enter", "Write a note at the playhead"],
        ["I / O", "Set range in / out for the note"],
        ["P", "Drop a pin on the frame"],
        ["[ / ]", "Previous / next note"],
        ["⌘ + Enter", "Post the note"],
        ["M / F", "Mute · fullscreen"],
      ]
    : [
        ["Click the ad", "Pin a note"],
        ["C or Enter", "Write a note"],
        ["[ / ]", "Previous / next note"],
        ["⌘ + Enter", "Post the note"],
      ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-2xl">Shortcuts</h2>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-1 pr-4">
                  <kbd>{k}</kbd>
                </td>
                <td className="py-1 text-stone">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
