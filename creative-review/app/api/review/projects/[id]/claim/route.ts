import { api, body } from "@/lib/review/http";
import { claimProject } from "@/lib/review/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const { by } = await body<{ by?: string }>(req).catch(() => ({ by: undefined }));
  return Response.json({ project: await claimProject(id, by ?? "ai") });
});
