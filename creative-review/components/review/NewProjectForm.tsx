"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FileRef, Kind } from "@/lib/review/types";
import { BRANDS } from "@/lib/review/labels";
import { apiFetch, formatBytes, getReviewerName, probeMedia, setReviewerName, uploadFile } from "./client";
import { DropZone } from "./DropZone";

type Pending = { file: File; pct: number; done?: FileRef; error?: string };

export function NewProjectForm({ initialKind }: { initialKind: Kind }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("VIG");
  const [format, setFormat] = useState(initialKind === "video" ? "9:16 · 30–45s" : "1:1 + 4:5");
  const [brief, setBrief] = useState("");
  const [footage, setFootage] = useState<Pending[]>([]);
  const [first, setFirst] = useState<Pending | null>(null);
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setAuthor(getReviewerName()), []);

  function pickKind(k: Kind) {
    setKind(k);
    setFormat(k === "video" ? "9:16 · 30–45s" : "1:1 + 4:5");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name.");
    if (kind === "video" && !footage.length && !first) return setError("Add footage for the AI to cut (or an existing cut as v1).");
    if (kind === "static" && !first && !brief.trim()) return setError("Add a brief for the AI, or upload the static as v1.");
    setBusy(true);
    setError("");
    if (author) setReviewerName(author);
    try {
      const folder = `${brand.toLowerCase()}-${Date.now().toString(36)}`;
      const refs: FileRef[] = [];
      for (let i = 0; i < footage.length; i++) {
        const f = footage[i].file;
        const ref = await uploadFile(f, f.name, `${folder}/footage`, (pct) =>
          setFootage((list) => list.map((x, j) => (j === i ? { ...x, pct } : x))),
        );
        refs.push(ref);
        setFootage((list) => list.map((x, j) => (j === i ? { ...x, pct: 100, done: ref } : x)));
      }

      let version = undefined;
      if (first) {
        const info = await probeMedia(first.file);
        const ref = await uploadFile(first.file, first.file.name, `${folder}/v1`, (pct) => setFirst((x) => (x ? { ...x, pct } : x)));
        const poster = info.poster ? await uploadFile(info.poster, "poster.jpg", `${folder}/v1`) : null;
        version = {
          file_url: ref.url,
          file_name: first.file.name,
          mime: first.file.type,
          size: first.file.size,
          width: info.width,
          height: info.height,
          duration: info.duration,
          poster_url: poster?.url ?? "",
          uploaded_by: author || "Reviewer",
          notes: "Uploaded with the brief.",
        };
      }

      const res = await apiFetch<{ project: { id: string } }>("/api/review/projects", {
        method: "POST",
        json: {
          name,
          kind,
          brand,
          brief,
          format,
          footage: refs,
          source: kind === "video" || !first ? "ai" : "human",
          created_by: author,
          version,
        },
      });
      router.push(`/review/${res.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fade-up mx-auto max-w-3xl">
      <div className="eyebrow">
        <span className="dot" />
        New project
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-none sm:text-5xl">
        Brief <em className="text-gold">in</em>, cuts <em className="text-gold">out</em>.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-stone">
        {kind === "video"
          ? "Give the AI editor a brief and the footage. It cuts v1, you leave timestamped notes, it ships v2 — until you approve."
          : "Upload a static for approval, or give the AI a brief to generate one. Drop pins where you want changes."}
      </p>

      <div className="card mt-8 grid gap-5 p-6">
        <div className="seg w-fit">
          <button type="button" className={kind === "video" ? "on" : ""} onClick={() => pickKind("video")}>
            ▶ AI video edit
          </button>
          <button type="button" className={kind === "static" ? "on" : ""} onClick={() => pickKind("static")}>
            ▣ Static ad
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_140px_180px]">
          <label>
            <span className="label">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. V3 skeleton VSL — hook test" autoFocus />
          </label>
          <label>
            <span className="label">Brand</span>
            <select className="field" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRANDS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Format</span>
            <input className="field" value={format} onChange={(e) => setFormat(e.target.value)} />
          </label>
        </div>

        <label>
          <span className="label">Brief</span>
          <textarea
            className="field min-h-48 font-mono !text-[13px]"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={
              kind === "video"
                ? "Angle, hook(s), script / beat sheet, on-screen text, music vibe, CTA, compliance notes, references…"
                : "Headline, body, visual direction, sizes, what to test…"
            }
          />
        </label>

        {kind === "video" && (
          <div>
            <span className="label">Footage, music, logos, b-roll</span>
            <DropZone multiple accept="video/*,audio/*,image/*" onFiles={(files) => setFootage((l) => [...l, ...files.map((file) => ({ file, pct: 0 }))])} className="p-6 text-center">
              <p className="text-sm">Drop raw files here or click to browse</p>
              <p className="k mt-1">Uploaded straight to storage · up to 5 GB each</p>
            </DropZone>
            {footage.length > 0 && (
              <ul className="mt-3 grid gap-2">
                {footage.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                    <span className="num text-xs text-stone">{formatBytes(f.file.size)}</span>
                    {busy ? (
                      <div className="progress w-24">
                        <div style={{ width: `${f.pct}%` }} />
                      </div>
                    ) : (
                      <button type="button" className="icon-btn danger" aria-label="Remove" onClick={() => setFootage((l) => l.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <span className="label">{kind === "video" ? "Already have a first cut? (optional v1)" : "The static (v1) — leave empty to have the AI make it"}</span>
          {first ? (
            <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{first.file.name}</span>
              <span className="num text-xs text-stone">{formatBytes(first.file.size)}</span>
              {busy ? (
                <div className="progress w-24">
                  <div style={{ width: `${first.pct}%` }} />
                </div>
              ) : (
                <button type="button" className="icon-btn danger" aria-label="Remove" onClick={() => setFirst(null)}>
                  ×
                </button>
              )}
            </div>
          ) : (
            <DropZone accept={kind === "video" ? "video/*" : "image/*"} onFiles={([file]) => setFirst({ file, pct: 0 })} className="p-4 text-center text-sm text-stone">
              Drop {kind === "video" ? "a video" : "an image"} or click
            </DropZone>
          )}
        </div>

        <label className="sm:w-64">
          <span className="label">Your name</span>
          <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Brayden" />
        </label>

        {error && <p className="text-sm text-red">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-gold" disabled={busy}>
            {busy ? "Uploading…" : kind === "video" && !first ? "Send to the AI editor" : "Create project"}
          </button>
          <span className="text-xs text-stone">
            {kind === "video" && !first ? "It lands in the AI queue; the editor picks it up on its next run." : ""}
          </span>
        </div>
      </div>
    </form>
  );
}
