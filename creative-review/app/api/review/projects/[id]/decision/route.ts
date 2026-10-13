import { api, body } from "@/lib/review/http";
import { decide } from "@/lib/review/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const input = await body<{ version_id: string; decision: "approve" | "request_changes"; by?: string; note?: string }>(req);
  return Response.json(await decide(id, input));
});
