import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { api } from "@/lib/review/http";
import { fileMode, LOCAL_ROOT, MAX_UPLOAD_BYTES } from "@/lib/review/files";
import { ReviewError } from "@/lib/review/service";

/** Local-dev upload: POST raw bytes to /api/review/files?name=cut.mp4 → { url } */
export const POST = api(async (req) => {
  if (fileMode() !== "local") throw new ReviewError("Local uploads are disabled; use /api/review/upload (Vercel Blob)", 400);
  const name = (new URL(req.url).searchParams.get("name") || "file").replace(/[^\w.\-]+/g, "_").slice(-120);
  if (!req.body) throw new ReviewError("Empty body");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES) throw new ReviewError("File too large", 413);
  const key = `${randomBytes(6).toString("hex")}/${name}`;
  const dest = path.join(LOCAL_ROOT, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), createWriteStream(dest));
  const { size } = await fs.stat(dest);
  return Response.json({ url: `/api/review/files/${key}`, pathname: key, size }, { status: 201 });
});
