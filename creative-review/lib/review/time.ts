// Timecode helpers shared by the UI, API and labels.

/** 75.4 → "01:15.4"; 3725 → "1:02:05.0" */
export function formatTimecode(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = sec.toFixed(1).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** SMPTE-style HH:MM:SS:FF for the player readout. */
export function formatSmpte(seconds: number, fps = 30): string {
  const totalFrames = Math.floor(Math.max(0, seconds) * fps + 1e-6);
  const f = totalFrames % fps;
  const totalS = Math.floor(totalFrames / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalS / 3600))}:${pad(Math.floor((totalS % 3600) / 60))}:${pad(totalS % 60)}:${pad(f)}`;
}

/** "1:15.4" | "75.4" | "01:02:05" → seconds. Returns null when unparseable. */
export function parseTimecode(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
