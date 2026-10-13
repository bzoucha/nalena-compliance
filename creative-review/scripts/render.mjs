#!/usr/bin/env node
// render.mjs — turn an edit decision list (edit.json) into an MP4 with ffmpeg.
//
//   node scripts/render.mjs render edit.json            → writes output.file (+ .timeline.json)
//   node scripts/render.mjs timeline edit.json          → table of where every clip lands in the output
//   node scripts/render.mjs locate edit.json 12.4       → which clip / source time is at 00:12.4 of the cut
//   node scripts/render.mjs sheet out/v2.mp4 [t1 t2 …]  → contact sheet (default 8 evenly spaced frames) for QA
//
// Why an EDL: reviewer notes arrive as output timestamps ("@00:12.4 caption covers
// her face"). `locate` maps that straight back to the clip + source frame, you change
// that one entry in edit.json, re-render, and nothing else moves by accident.
//
// edit.json (paths are relative to the edit.json file):
// {
//   "output":   { "file": "out/v2.mp4", "width": 1080, "height": 1920, "fps": 30, "crf": 20 },
//   "clips": [
//     { "src": "footage/a.mp4", "in": 1.2, "out": 4.8, "fit": "cover", "volume": 1, "speed": 1, "label": "hook" },
//     { "src": "footage/product.png", "duration": 2.5, "fit": "contain", "zoom": 1.08 }
//   ],
//   "text": [ { "text": "Doctors hate this", "start": 0, "end": 2.2, "y": 0.2, "size": 72, "color": "white", "box": true } ],
//   "captions": [ { "start": 0.2, "end": 1.4, "text": "I tried everything" } ],
//   "captionStyle": { "size": 64, "y": 0.72, "font": "Inter", "color": "#FFFFFF", "outline": 6, "uppercase": false },
//   "overlays": [ { "src": "assets/logo.png", "start": 0, "end": 999, "x": 0.06, "y": 0.05, "width": 0.22 } ],
//   "music":    { "src": "music/track.mp3", "volume": 0.16, "duck": true, "offset": 0, "fadeOut": 1.5 },
//   "voiceover":{ "src": "vo.wav", "volume": 1, "start": 0 }
// }

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [cmd, editPath, arg, ...rest] = process.argv.slice(2);
if (!cmd || !editPath) {
  console.log("usage: render.mjs render|timeline|locate <edit.json> [seconds]  |  render.mjs sheet <video> [seconds…]");
  process.exit(1);
}
if (cmd === "sheet") {
  sheet(path.resolve(editPath), [arg, ...rest].filter(Boolean).map(Number));
  process.exit(0);
}

// QA: one image with labelled frames so you can eyeball the whole cut (or the exact note timecodes).
function sheet(video, times) {
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
  const ts = times.length ? times : Array.from({ length: 8 }, (_, i) => ((i + 0.5) * d) / 8);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));
  const frames = ts.map((t, i) => {
    const f = path.join(tmp, `f${i}.jpg`);
    const label = `${String(Math.floor(t / 60)).padStart(2, "0")}\\:${(t % 60).toFixed(1).padStart(4, "0")}`;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(t, Math.max(0, d - 0.05))), "-i", video, "-frames:v", "1",
      "-vf", `scale=-2:480,drawtext=text='${label}':x=10:y=10:fontsize=28:fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=6`, f]);
    return f;
  });
  const cols = Math.min(ts.length, 4);
  const rows = Math.ceil(ts.length / cols);
  const out = video.replace(/\.\w+$/, "") + ".sheet.jpg";
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(tmp, "f%d.jpg"), "-vf", `tile=${cols}x${rows}:padding=6:color=black`, "-frames:v", "1", out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ ${path.relative(process.cwd(), out)}  (${ts.map((t) => t.toFixed(1)).join(", ")}s)`);
}

const editFile = path.resolve(editPath);
const root = path.dirname(editFile);
const edit = JSON.parse(fs.readFileSync(editFile, "utf8"));
const out = { width: 1080, height: 1920, fps: 30, crf: 20, preset: "medium", ...(edit.output || {}) };
const W = out.width;
const H = out.height;
const FPS = out.fps;
const abs = (p) => (path.isAbsolute(p) ? p : path.join(root, p));
const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i;
const tc = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;

function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file], { encoding: "utf8" }));
  return { hasAudio: (j.streams || []).some((s) => s.codec_type === "audio"), duration: Number(j.format?.duration) || 0 };
}

// Lay clips end to end and remember where each lands in the output.
function layout() {
  let t = 0;
  return (edit.clips || []).map((c, i) => {
    const file = abs(c.src);
    if (!fs.existsSync(file)) throw new Error(`clip ${i}: missing ${c.src}`);
    const isImage = IMG.test(file);
    const speed = c.speed || 1;
    const srcIn = isImage ? 0 : c.in ?? 0;
    let srcOut = isImage ? c.duration ?? 2 : c.out;
    const info = isImage ? { hasAudio: false, duration: srcOut } : probe(file);
    if (srcOut == null) srcOut = info.duration;
    const len = (srcOut - srcIn) / speed;
    if (!(len > 0)) throw new Error(`clip ${i}: out must be after in`);
    const placed = { ...c, i, file, isImage, speed, srcIn, srcOut, hasAudio: info.hasAudio, start: t, end: t + len, len };
    t += len;
    return placed;
  });
}

function writeTimeline(clips) {
  const total = clips.at(-1)?.end ?? 0;
  return {
    duration: total,
    clips: clips.map((c) => ({ i: c.i, label: c.label || "", src: c.src, out_start: +c.start.toFixed(3), out_end: +c.end.toFixed(3), src_in: c.srcIn, src_out: c.srcOut, speed: c.speed })),
    text: (edit.text || []).map((x, i) => ({ i, text: x.text, start: x.start, end: x.end })),
  };
}

function esc(p) {
  // For filter args: escape \ : ' and , per ffmpeg's filtergraph rules.
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

function assColor(hex, alpha = 0) {
  const h = (hex || "#FFFFFF").replace("#", "");
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

function assTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
}

function captionsAss(tmp) {
  const st = { size: 64, y: 0.72, font: "Inter", color: "#FFFFFF", outline: 6, uppercase: false, bold: true, ...(edit.captionStyle || {}) };
  const marginV = Math.round(H * (1 - st.y));
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${st.font},${st.size},${assColor(st.color)},${assColor(st.color)},${assColor("#000000")},${assColor("#000000", 0x80)},${st.bold ? -1 : 0},0,0,0,100,100,0,0,1,${st.outline},0,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const c of edit.captions) {
    const text = (st.uppercase ? c.text.toUpperCase() : c.text).replace(/\n/g, "\\N");
    lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${text}`);
  }
  const file = path.join(tmp, "captions.ass");
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function fontFile(name) {
  if (name && fs.existsSync(abs(name))) return abs(name);
  try {
    return execFileSync("fc-match", ["-f", "%{file}", name || "Inter:bold"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function render() {
  const clips = layout();
  if (!clips.length) throw new Error("edit.json has no clips");
  const total = clips.at(-1).end;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const inputs = [];
  const graph = [];
  let inputCount = 0;
  const addInput = (args) => {
    inputs.push(...args);
    return inputCount++;
  };

  // 1. Clips → normalised video + audio segments
  clips.forEach((c, k) => {
    const idx = c.isImage
      ? addInput(["-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", c.file])
      : addInput(["-ss", String(c.srcIn), "-t", String(c.srcOut - c.srcIn), "-i", c.file]);
    const fit =
      c.fit === "contain"
        ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${c.bg || "black"}`
        : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    const tail = `setsar=1,format=yuv420p,trim=duration=${c.len.toFixed(4)}`;
    if (c.isImage && c.zoom && c.zoom !== 1) {
      // Slow push-in on stills (Ken Burns), rendered at 2x then scaled down for smoothness.
      const frames = Math.max(1, Math.round(c.len * FPS));
      graph.push(
        `[${idx}:v]` +
          (c.fit === "contain"
            ? `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=decrease,pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:color=${c.bg || "black"},`
            : `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`) +
          `zoompan=z='1+(${c.zoom}-1)*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},${tail}[v${k}]`,
      );
    } else {
      const speed = c.speed !== 1 && !c.isImage ? `setpts=(PTS-STARTPTS)/${c.speed}` : "setpts=PTS-STARTPTS";
      graph.push(`[${idx}:v]${speed},fps=${FPS},${fit},${tail}[v${k}]`);
    }
    if (c.hasAudio && (c.volume ?? 1) > 0) {
      const tempo = c.speed !== 1 ? `,atempo=${Math.min(2, Math.max(0.5, c.speed))}` : "";
      graph.push(`[${idx}:a]asetpts=PTS-STARTPTS${tempo},volume=${c.volume ?? 1},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${c.len.toFixed(4)}[a${k}]`);
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${c.len.toFixed(4)}[a${k}]`);
    }
  });
  graph.push(`${clips.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${clips.length}:v=1:a=1[vcat][acat]`);
  let v = "vcat";

  // 2. Image overlays (logos, stickers, product shots)
  (edit.overlays || []).forEach((o, k) => {
    const idx = addInput(["-loop", "1", "-i", abs(o.src)]);
    graph.push(`[${idx}:v]scale=${Math.round(W * (o.width ?? 0.2))}:-1,format=rgba[ol${k}]`);
    graph.push(`[${v}][ol${k}]overlay=x=${Math.round(W * (o.x ?? 0))}:y=${Math.round(H * (o.y ?? 0))}:enable='between(t,${o.start ?? 0},${o.end ?? total})':shortest=1[vo${k}]`);
    v = `vo${k}`;
  });

  // 3. On-screen text (hooks, supers, disclaimers)
  (edit.text || []).forEach((x, k) => {
    const tf = path.join(tmp, `text${k}.txt`);
    fs.writeFileSync(tf, x.text);
    const font = fontFile(x.font || "Inter:bold");
    const size = x.size ?? 64;
    const parts = [
      `textfile='${esc(tf)}'`,
      font ? `fontfile='${esc(font)}'` : "",
      `fontsize=${size}`,
      `fontcolor=${x.color || "white"}`,
      `line_spacing=${Math.round(size * 0.2)}`,
      `x=${x.x != null ? Math.round(W * x.x) : "(w-text_w)/2"}`,
      `y=${Math.round(H * (x.y ?? 0.2))}-text_h/2`,
      x.box !== false ? `box=1:boxcolor=${x.boxColor || "black@0.55"}:boxborderw=${Math.round(size * 0.35)}` : `borderw=${x.outline ?? 4}:bordercolor=black`,
      `enable='between(t,${x.start ?? 0},${x.end ?? total})'`,
    ].filter(Boolean);
    graph.push(`[${v}]drawtext=${parts.join(":")}[vt${k}]`);
    v = `vt${k}`;
  });

  // 4. Burned-in captions
  if (edit.captions?.length) {
    const ass = captionsAss(tmp);
    graph.push(`[${v}]ass='${esc(ass)}'[vcap]`);
    v = "vcap";
  }

  // 5. Audio: clip audio + voiceover, music ducked under them
  const voices = ["acat"];
  if (edit.voiceover?.src) {
    const idx = addInput(["-i", abs(edit.voiceover.src)]);
    const d = Math.round((edit.voiceover.start ?? 0) * 1000);
    graph.push(`[${idx}:a]adelay=${d}|${d},volume=${edit.voiceover.volume ?? 1},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[vo]`);
    voices.push("vo");
  }
  let a;
  if (voices.length > 1) {
    graph.push(`${voices.map((x) => `[${x}]`).join("")}amix=inputs=${voices.length}:duration=first:normalize=0[voice]`);
    a = "voice";
  } else a = "acat";

  if (edit.music?.src) {
    const m = edit.music;
    const idx = addInput(["-stream_loop", "-1", "-ss", String(m.offset ?? 0), "-i", abs(m.src)]);
    const fade = m.fadeOut ? `,afade=t=out:st=${Math.max(0, total - m.fadeOut).toFixed(3)}:d=${m.fadeOut}` : "";
    graph.push(`[${idx}:a]atrim=duration=${total.toFixed(4)},asetpts=PTS-STARTPTS,volume=${m.volume ?? 0.16},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${fade}[mus]`);
    if (m.duck !== false) {
      graph.push(`[${a}]asplit=2[vmain][vkey]`);
      graph.push(`[mus][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[musd]`);
      graph.push(`[vmain][musd]amix=inputs=2:duration=first:normalize=0[aout]`);
    } else {
      graph.push(`[${a}][mus]amix=inputs=2:duration=first:normalize=0[aout]`);
    }
    a = "aout";
  }

  const outFile = abs(out.file || "out.mp4");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const args = [
    "-y", "-hide_banner", "-loglevel", "error", "-stats",
    ...inputs,
    "-filter_complex", graph.join(";\n"),
    "-map", `[${v}]`, "-map", `[${a}]`,
    "-t", total.toFixed(3),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", out.preset, "-crf", String(out.crf), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outFile,
  ];
  fs.writeFileSync(path.join(tmp, "graph.txt"), graph.join(";\n"));
  const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`ffmpeg failed — filter graph saved at ${path.join(tmp, "graph.txt")}`);
    process.exit(1);
  }
  fs.writeFileSync(outFile.replace(/\.\w+$/, ".timeline.json"), JSON.stringify(writeTimeline(clips), null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ ${path.relative(process.cwd(), outFile)}  ${tc(total)}  ${W}×${H}@${FPS}`);
}

function timeline() {
  const t = writeTimeline(layout());
  console.log(`total ${tc(t.duration)}\n`);
  console.log("  #  out              src                                   in → out        label");
  for (const c of t.clips) {
    console.log(
      `${String(c.i).padStart(3)}  ${tc(c.out_start)}–${tc(c.out_end)}  ${c.src.padEnd(36).slice(0, 36)}  ${c.src_in.toFixed(2).padStart(6)} → ${c.src_out.toFixed(2).padEnd(7)} ${c.label}`,
    );
  }
  if (t.text.length) {
    console.log("\ntext:");
    for (const x of t.text) console.log(`${String(x.i).padStart(3)}  ${tc(x.start ?? 0)}–${tc(x.end ?? t.duration)}  ${x.text.replace(/\n/g, " / ")}`);
  }
}

function locate(at) {
  const clips = layout();
  const c = clips.find((x) => at >= x.start && at < x.end) || clips.at(-1);
  const src = c.srcIn + (at - c.start) * c.speed;
  const text = (edit.text || []).map((x, i) => ({ ...x, i })).filter((x) => at >= (x.start ?? 0) && at <= (x.end ?? Infinity));
  const caps = (edit.captions || []).map((x, i) => ({ ...x, i })).filter((x) => at >= x.start && at <= x.end);
  console.log(`@${tc(at)} → clips[${c.i}]${c.label ? ` "${c.label}"` : ""}  ${c.src} @ ${src.toFixed(3)}s  (clip spans ${tc(c.start)}–${tc(c.end)} of the cut)`);
  for (const x of text) console.log(`          text[${x.i}] "${x.text.replace(/\n/g, " / ")}"`);
  for (const x of caps) console.log(`          captions[${x.i}] "${x.text}"`);
}

try {
  if (cmd === "render") render();
  else if (cmd === "timeline") timeline();
  else if (cmd === "locate") locate(Number(arg));
  else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
