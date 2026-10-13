import "server-only";
import path from "node:path";

// Where uploaded cuts / statics / footage live.
//   local → .data/files, served by /api/review/files/* (dev only)
//   blob  → Vercel Blob, browser + AI upload straight to it via /api/review/upload
export type FileMode = "local" | "blob";

/** Blob as soon as a Blob store is connected (its token appears); REVIEW_FILES=local forces disk. */
export function fileMode(): FileMode {
  if (process.env.REVIEW_FILES === "local") return "local";
  return process.env.REVIEW_FILES === "blob" || process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

export const LOCAL_ROOT = path.join(process.cwd(), ".data", "files");

/** Reject anything that could escape the files directory. */
export function safeKey(parts: string[]): string | null {
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  if (!key || key.includes("..") || key.startsWith("/") || !/^[\w.\-/ ]+$/.test(key)) return null;
  return key;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB raw footage ceiling

export const ALLOWED_TYPES = [
  "video/*",
  "image/*",
  "audio/*",
  "application/pdf",
  "application/zip",
  "application/octet-stream",
  "text/plain",
  "application/json",
];
