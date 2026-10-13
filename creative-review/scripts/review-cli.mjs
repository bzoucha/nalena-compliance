#!/usr/bin/env node
// review-cli — the AI editor's side of Vigo Review.
//
//   node scripts/review-cli.mjs jobs                       what's waiting (new briefs + notes to apply)
//   node scripts/review-cli.mjs pull <projectId>           download brief, footage, latest cut, notes + a frame per note
//   node scripts/review-cli.mjs claim <projectId>          mark it "AI editing" so nobody else grabs it
//   node scripts/review-cli.mjs upload <projectId> <file>  upload the next version (see flags below)
//   node scripts/review-cli.mjs reply <projectId> <commentId> "text"
//   node scripts/review-cli.mjs rules [--scope video|static] [--brand VIG] [--write path.md]
//   node scripts/review-cli.mjs propose-rule "text" [--scope video] [--brand VIG] [--detail "..."] [--from <commentId>] [--project <id>]
//
// upload flags:
//   --notes "changelog"                  shown to the reviewer as "what changed"
//   --resolve <commentId>="what I did"   repeatable; closes that note with your explanation
//   --resolutions file.json              [{ "comment_id": "...", "resolution": "..." }]
//   --by "Claude"                        uploader name (default "AI editor")
//
// Config (env or .env.local / .env next to this package):
//   REVIEW_URL       e.g. https://creative.vigomd.com  (default http://localhost:3000)
//   REVIEW_API_KEY   same value as the server's REVIEW_API_KEY

import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, openAsBlob, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

for (const f of [".env.local", ".env"]) {
  for (const dir of [process.cwd(), pkgRoot]) {
    const p = path.join(dir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const BASE = (process.env.REVIEW_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.REVIEW_API_KEY || "";

// ── tiny arg parser ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv.shift();
const pos = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    if (flags[k] === undefined) flags[k] = v;
    else flags[k] = [].concat(flags[k], v);
  } else pos.push(a);
}
const list = (v) => (v === undefined ? [] : [].concat(v));

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function api(p, init = {}) {
  const res = await fetch(`${BASE}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, ...(init.json ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    body: init.json ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) die(`${init.method || "GET"} ${p} → ${res.status} ${data.error || ""}`);
  return data;
}

const tc = (s) => {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

function hasBin(bin) {
  return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
}

function absolute(url) {
  return url.startsWith("http") ? url : `${BASE}${url}`;
}

async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(absolute(url), { headers: url.startsWith("http") && !url.startsWith(BASE) ? {} : { Authorization: `Bearer ${KEY}` } });
  if (!res.ok || !res.body) die(`download ${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

function probe(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
    const j = JSON.parse(out);
    const v = (j.streams || []).find((s) => s.codec_type === "video");
    const [n, d] = (v?.r_frame_rate || "0/1").split("/").map(Number);
    const duration = Number(j.format?.duration);
    return {
      width: v?.width ?? null,
      height: v?.height ?? null,
      fps: d ? Math.round((n / d) * 100) / 100 : null,
      duration: Number.isFinite(duration) && duration > 0.05 ? duration : null,
    };
  } catch {
    return { width: null, height: null, fps: null, duration: null };
  }
}

const MIME = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

async function uploadFile(file, folder) {
  const name = path.basename(file).replace(/[^\w.\-]+/g, "_");
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const { files } = await api("/api/review/config");
  if (files === "blob") {
    const { upload } = await import("@vercel/blob/client");
    const blob = await openAsBlob(file, { type });
    const res = await upload(`review/${folder}/${name}`, blob, {
      access: "public",
      handleUploadUrl: `${BASE}/api/review/upload`,
      headers: { Authorization: `Bearer ${KEY}` },
      contentType: type,
      multipart: blob.size > 50 * 1024 * 1024,
    });
    return { url: res.url, size: blob.size, type };
  }
  const blob = await openAsBlob(file, { type });
  const res = await api(`/api/review/files?name=${encodeURIComponent(name)}`, { method: "POST", body: blob, headers: { "Content-Type": type } });
  return { url: res.url, size: res.size, type };
}

// Draw a numbered target where the reviewer pinned the note, so the AI sees exactly what they pointed at.
function markFrame(src, dest, marks, at) {
  const filters = [];
  for (const m of marks) {
    // A bold target box + centre dot + the note number, sized relative to the frame.
    const box = 0.1;
    const x0 = (m.x - box / 2).toFixed(4);
    const y0 = `ih*${m.y.toFixed(4)}-iw*${(box / 2).toFixed(4)}`;
    filters.push(`drawbox=x=iw*${x0}-4:y=${y0}-4:w=iw*${box}+8:h=iw*${box}+8:color=black@0.8:t=4`);
    filters.push(`drawbox=x=iw*${x0}:y=${y0}:w=iw*${box}:h=iw*${box}:color=yellow:t=8`);
    filters.push(`drawbox=x=iw*${m.x.toFixed(4)}-5:y=ih*${m.y.toFixed(4)}-5:w=10:h=10:color=red:t=fill`);
    filters.push(`drawtext=text='${m.n}':x=w*${(m.x + box / 2).toFixed(4)}+10:y=h*${m.y.toFixed(4)}-w*${(box / 2).toFixed(4)}:fontsize=h/22:fontcolor=yellow:borderw=4:bordercolor=black`);
  }
  const args = ["-v", "error", "-y"];
  if (at != null) args.push("-ss", String(at));
  args.push("-i", src, "-frames:v", "1");
  if (filters.length) args.push("-vf", filters.join(","));
  args.push("-q:v", "3", dest);
  const r = spawnSync("ffmpeg", args, { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) console.warn(`  ⚠ couldn't extract ${path.basename(dest)}: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.status === 0;
}

// ── commands ────────────────────────────────────────────────────────────

async function cmdJobs() {
  const q = new URLSearchParams();
  if (flags.project) q.set("project", flags.project);
  if (flags.editing) q.set("editing", "1");
  const { jobs } = await api(`/api/review/agent/jobs?${q}`);
  if (flags.json) return console.log(JSON.stringify(jobs, null, 2));
  if (!jobs.length) return console.log("Queue is empty — nothing waiting on the AI editor.");
  for (const j of jobs) {
    const p = j.project;
    console.log(`\n■ ${p.name}  [${p.kind} · ${p.brand || "—"} · ${p.status}]  id=${p.id}`);
    console.log(`  ${j.next_step}`);
    for (const f of j.feedback) {
      const where = f.timecode_label ? `@${f.timecode_label}` : f.x != null ? "📍" : "general";
      console.log(`   - ${where}${f.x != null && f.timecode != null ? " 📍" : ""}  ${f.body.replace(/\n/g, " ")}  (${f.author})  [${f.id}]`);
    }
  }
  console.log(`\n${jobs.length} job(s). Next: node scripts/review-cli.mjs pull <id>`);
}

async function cmdPull() {
  const id = pos[0] || die("usage: pull <projectId> [--dir path] [--no-footage]");
  const { jobs } = await api(`/api/review/agent/jobs?project=${id}`);
  const job = jobs[0] || die("project not found");
  const p = job.project;
  const dir = path.resolve(flags.dir || path.join("review-work", `${p.name.replace(/[^\w\-]+/g, "-").slice(0, 50)}-${p.id}`));
  await fs.mkdir(dir, { recursive: true });
  console.log(`→ ${dir}`);

  await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2));
  await fs.writeFile(
    path.join(dir, "brief.md"),
    `# ${p.name}\n\nKind: ${p.kind} · Brand: ${p.brand || "—"} · Format: ${p.format || "—"}\n\n${p.brief || "(no brief)"}\n`,
  );

  if (!flags["no-footage"] && p.footage.length) {
    for (const f of p.footage) {
      const dest = path.join(dir, "footage", f.name.replace(/[^\w.\-]+/g, "_"));
      if (existsSync(dest)) continue;
      process.stdout.write(`  footage ${f.name} … `);
      await download(f.url, dest);
      console.log("ok");
    }
  }

  const v = job.latest_version;
  const lines = [`# Feedback on ${v ? `v${v.number}` : "(no version yet)"} — ${p.name}`, ""];
  if (v) {
    const ext = path.extname(v.file_name || new URL(absolute(v.file_url)).pathname) || (p.kind === "video" ? ".mp4" : ".png");
    const cut = path.join(dir, "versions", `v${v.number}${ext}`);
    if (!existsSync(cut)) {
      process.stdout.write(`  v${v.number} … `);
      await download(v.file_url, cut);
      console.log("ok");
    }
    const ff = hasBin("ffmpeg");
    let n = 0;
    for (const f of job.feedback) {
      n++;
      const where = f.timecode_label ? `@ ${f.timecode_label}` : f.x != null ? "pinned" : "general";
      lines.push(`## ${n}. ${where} — ${f.author}`, "", f.body, "");
      if (f.x != null) lines.push(`Pin: x=${(f.x * 100).toFixed(1)}% from left, y=${(f.y * 100).toFixed(1)}% from top`, "");
      if (f.timecode_end != null) lines.push(`Range: ${tc(f.timecode)} → ${tc(f.timecode_end)} (${(f.timecode_end - f.timecode).toFixed(2)}s)`, "");
      for (const r of f.replies) lines.push(`> ${r.author}${r.author_kind === "ai" ? " (AI)" : ""}: ${r.body}`, "");
      lines.push(`comment_id: \`${f.id}\``);
      if (ff && (f.timecode != null || f.x != null)) {
        const marks = f.x != null ? [{ x: f.x, y: f.y, n }] : [];
        const at = p.kind === "video" ? f.timecode ?? 0 : null;
        const frame = path.join(dir, "frames", `note-${String(n).padStart(2, "0")}${f.timecode != null ? `-${tc(f.timecode).replace(/[:.]/g, "_")}` : ""}.jpg`);
        await fs.mkdir(path.dirname(frame), { recursive: true });
        if (markFrame(cut, frame, marks, at)) lines.push(`frame: ${path.relative(dir, frame)}`);
        if (p.kind === "video" && f.timecode_end != null) {
          const end = frame.replace(/\.jpg$/, "-end.jpg");
          if (markFrame(cut, end, [], f.timecode_end)) lines.push(`frame (range end): ${path.relative(dir, end)}`);
        }
      }
      lines.push("");
    }
    if (!job.feedback.length) lines.push("No open notes on this version.", "");
    if (ff && p.kind === "static") {
      const all = job.feedback.map((f, i) => ({ ...f, n: i + 1 })).filter((f) => f.x != null);
      const out = path.join(dir, "frames", "all-pins.jpg");
      if (all.length && markFrame(cut, out, all, null)) lines.push(`All pins on one image: frames/all-pins.jpg`, "");
    }
  } else {
    lines.push("No version yet — make v1 from brief.md and footage/.", "");
  }

  lines.push("## Playbook rules (always apply)", "");
  for (const r of job.rules) lines.push(`- ${r.rule}${r.brand ? ` [${r.brand}]` : ""}${r.detail ? ` — ${r.detail}` : ""}`);
  if (!job.rules.length) lines.push("(none yet)");
  lines.push("");
  await fs.writeFile(path.join(dir, "feedback.md"), lines.join("\n"));
  await fs.writeFile(path.join(dir, "rules.md"), rulesMarkdown(job.rules, p.kind));

  console.log(`  brief.md · feedback.md · rules.md · job.json${v ? " · versions/" : ""}${job.feedback.length ? " · frames/" : ""}`);
  console.log(`\nNext step: ${job.next_step}`);
}

async function cmdClaim() {
  const id = pos[0] || die("usage: claim <projectId> [--by name]");
  const { project } = await api(`/api/review/projects/${id}/claim`, { method: "POST", json: { by: flags.by || "AI editor" } });
  console.log(`✓ ${project.name} → ${project.status}`);
}

async function cmdUpload() {
  const [id, file] = pos;
  if (!id || !file) die("usage: upload <projectId> <file> [--notes ...] [--resolve id=\"what changed\"]");
  if (!existsSync(file)) die(`no such file: ${file}`);

  const resolutions = [];
  for (const r of list(flags.resolve)) {
    const i = r.indexOf("=");
    if (i < 1) die(`--resolve expects <commentId>="what changed", got ${r}`);
    resolutions.push({ comment_id: r.slice(0, i), resolution: r.slice(i + 1) });
  }
  if (flags.resolutions) resolutions.push(...JSON.parse(await fs.readFile(flags.resolutions, "utf8")));

  const { project, versions } = await api(`/api/review/projects/${id}`);
  const next = (versions.at(-1)?.number ?? 0) + 1;
  const folder = `${id}/v${next}`;
  const meta = hasBin("ffprobe") ? probe(file) : {};
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";

  process.stdout.write(`  uploading ${path.basename(file)} … `);
  const up = await uploadFile(file, folder);
  console.log("ok");

  let poster_url = "";
  if (hasBin("ffmpeg")) {
    const posterFile = path.join(path.dirname(path.resolve(file)), `.poster-${Date.now()}.jpg`);
    const at = type.startsWith("video/") ? Math.min(1, (meta.duration || 3) / 3) : null;
    const args = ["-v", "error", "-y", ...(at != null ? ["-ss", String(at)] : []), "-i", file, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "4", posterFile];
    if (spawnSync("ffmpeg", args).status === 0) {
      poster_url = (await uploadFile(posterFile, folder)).url;
      await fs.rm(posterFile, { force: true });
    }
  }

  const res = await api(`/api/review/projects/${id}/versions`, {
    method: "POST",
    json: {
      file_url: up.url,
      file_name: path.basename(file),
      mime: type,
      size: up.size,
      ...meta,
      poster_url,
      notes: flags.notes || "",
      uploaded_by: flags.by || "AI editor",
      resolutions,
    },
  });
  const left = res.comments.filter((c) => c.version_number === next - 1 && !c.parent_id && c.status === "open");
  console.log(`✓ ${project.name} v${res.version.number} is up for review (${resolutions.length} note(s) resolved)`);
  if (left.length) console.log(`  ⚠ ${left.length} note(s) on v${next - 1} still open: ${left.map((c) => c.id).join(", ")}`);
  console.log(`  ${BASE}/review/${id}?v=${res.version.number}`);
}

async function cmdReply() {
  const [id, commentId, ...rest] = pos;
  const text = rest.join(" ");
  if (!id || !commentId || !text) die('usage: reply <projectId> <commentId> "text"');
  const { comments } = await api(`/api/review/projects/${id}`);
  const parent = comments.find((c) => c.id === commentId) || die("comment not found");
  await api("/api/review/comments", {
    method: "POST",
    json: { project_id: id, version_id: parent.version_id, parent_id: commentId, author: flags.by || "AI editor", body: text },
  });
  console.log("✓ replied");
}

function rulesMarkdown(rules, kind) {
  const head = [
    "# Learned rules",
    "",
    "Synced from the Vigo Review playbook. Every rule came from real feedback on a real cut —",
    "apply all of them on every edit before you upload. Do not edit by hand; run",
    "`node creative-review/scripts/review-cli.mjs rules --write <this file>` to refresh.",
    "",
    `_Synced ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${rules.length} rule(s)${kind ? ` · scope: ${kind}` : ""}_`,
    "",
  ];
  const group = (s) => rules.filter((r) => r.scope === s);
  const out = [...head];
  for (const [s, title] of [["all", "Everything"], ["video", "Video"], ["static", "Static"]]) {
    const g = group(s);
    if (!g.length) continue;
    out.push(`## ${title}`, "");
    for (const r of g) out.push(`- ${r.rule}${r.brand ? ` **[${r.brand} only]**` : ""}${r.detail ? `\n  - ${r.detail}` : ""}`);
    out.push("");
  }
  if (!rules.length) out.push("_No rules yet._", "");
  return out.join("\n");
}

async function cmdRules() {
  const q = new URLSearchParams({ status: flags.status || "active" });
  if (flags.scope) q.set("scope", flags.scope);
  if (flags.brand) q.set("brand", flags.brand);
  const { rules } = await api(`/api/review/rules?${q}`);
  const md = rulesMarkdown(rules, flags.scope);
  if (flags.write) {
    await fs.mkdir(path.dirname(path.resolve(flags.write)), { recursive: true });
    await fs.writeFile(flags.write, md);
    console.log(`✓ wrote ${rules.length} rule(s) → ${flags.write}`);
  } else console.log(md);
}

async function cmdProposeRule() {
  const text = pos.join(" ");
  if (!text) die('usage: propose-rule "text" [--scope video|static|all] [--brand VIG] [--detail "..."] [--from commentId] [--project id]');
  const { rule } = await api("/api/review/rules", {
    method: "POST",
    json: {
      rule: text,
      scope: flags.scope || "all",
      brand: flags.brand || "",
      detail: flags.detail || "",
      source_comment_id: flags.from || "",
      source_project_id: flags.project || "",
    },
  });
  console.log(`✓ proposed (${rule.status}) — approve it at ${BASE}/review/playbook`);
}

const commands = { jobs: cmdJobs, pull: cmdPull, claim: cmdClaim, upload: cmdUpload, reply: cmdReply, rules: cmdRules, "propose-rule": cmdProposeRule };

if (!cmd || !commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 25).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd ? 1 : 0);
}
if (!KEY && !BASE.includes("localhost")) die("REVIEW_API_KEY is not set");
await commands[cmd]();
