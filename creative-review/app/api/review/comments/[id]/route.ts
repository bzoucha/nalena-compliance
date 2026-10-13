import { api, body } from "@/lib/review/http";
import { deleteComment, updateComment } from "@/lib/review/service";
import type { Scope } from "@/lib/review/types";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await body<{ status?: "open" | "resolved"; body?: string; resolution?: string; save_as_rule?: boolean; rule_scope?: Scope; by?: string }>(req);
  return Response.json({ comment: await updateComment(id, patch) });
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await deleteComment(id);
  return Response.json({ ok: true });
});
