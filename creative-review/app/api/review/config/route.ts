import { api } from "@/lib/review/http";
import { fileMode } from "@/lib/review/files";

export const GET = api(async () =>
  Response.json({ files: fileMode(), store: process.env.REVIEW_STORE === "airtable" ? "airtable" : "json" }),
);
