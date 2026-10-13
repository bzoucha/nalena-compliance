import { api } from "@/lib/review/http";
import { fileMode } from "@/lib/review/files";
import { storeKind } from "@/lib/review/store";

export const GET = api(async () => Response.json({ files: fileMode(), store: storeKind() }));
