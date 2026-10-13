import { api, body } from "@/lib/review/http";
import { addComment, type NewCommentInput } from "@/lib/review/service";

export const POST = api(async (req, _ctx, caller) => {
  const input = await body<NewCommentInput>(req);
  input.author_kind = caller.kind === "agent" ? "ai" : "human";
  return Response.json({ comment: await addComment(input) }, { status: 201 });
});
