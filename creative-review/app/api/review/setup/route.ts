import { api } from "@/lib/review/http";
import { airtableStatus, createMissingTables } from "@/lib/review/airtable-setup";

export const GET = api(async () => Response.json(await airtableStatus()));

export const POST = api(async (_req, _ctx, caller) => {
  if (caller.kind !== "human") return Response.json({ error: "Only a signed-in reviewer can run setup" }, { status: 403 });
  const created = await createMissingTables();
  return Response.json({ created, ...(await airtableStatus()) });
});
