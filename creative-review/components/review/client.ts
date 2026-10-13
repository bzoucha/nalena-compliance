"use client";

import { upload } from "@vercel/blob/client";
import type { FileRef } from "@/lib/review/types";

export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let modePromise: Promise<"local" | "blob"> | null = null;
function fileMode() {
  modePromise ??= apiFetch<{ files: "local" | "blob" }>("/api/review/config").then((c) => c.files);
  return modePromise;
}

/** Upload straight to storage (Vercel Blob in prod, .data/ locally). */
export async function uploadFile(file: File | Blob, name: string, folder: string, onProgress?: (pct: number) => void): Promise<FileRef> {
  const type = file.type || "application/octet-stream";
  const clean = name.replace(/[^\w.\-]+/g, "_");
  if ((await fileMode()) === "blob") {
    const res = await upload(`review/${folder}/${clean}`, file, {
      access: "public",
      handleUploadUrl: "/api/review/upload",
      contentType: type,
      multipart: file.size > 50 * 1024 * 1024,
      onUploadProgress: (e) => onProgress?.(e.percentage),
    });
    return { url: res.url, name, size: file.size, type };
  }
  // Local dev: stream the bytes to our own route (XHR for progress events).
  const url = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/review/files?name=${encodeURIComponent(clean)}`);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.((e.loaded / e.total) * 100);
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 300) reject(new Error(data.error || "Upload failed"));
        else resolve(data.url);
      } catch {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
  return { url, name, size: file.size, type };
}

export interface MediaInfo {
  width: number | null;
  height: number | null;
  duration: number | null;
  poster: Blob | null;
}

/** Read dimensions/duration and grab a poster frame from a local file before upload. */
export async function probeMedia(file: File): Promise<MediaInfo> {
  const src = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, duration: null, poster: null };
    }
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = src;
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => rej(new Error("Can't read video"));
      });
      const info: MediaInfo = { width: v.videoWidth, height: v.videoHeight, duration: v.duration, poster: null };
      try {
        v.currentTime = Math.min(1, v.duration / 3);
        await new Promise<void>((res) => (v.onseeked = () => res()));
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        info.poster = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
      } catch {
        /* poster is optional */
      }
      return info;
    }
  } catch {
    /* fall through */
  } finally {
    URL.revokeObjectURL(src);
  }
  return { width: null, height: null, duration: null, poster: null };
}

const NAME_KEY = "vc_review_name";

export function getReviewerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setReviewerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode */
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
}
