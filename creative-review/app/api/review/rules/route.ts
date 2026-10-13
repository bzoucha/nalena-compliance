import { api, body } from "@/lib/review/http";
import { createRule, listRules } from "@/lib/review/service";
import type { Kind, Rule } from "@/lib/review/types";

/** GET ?scope=video|static&brand=VIG&status=active|proposed|retired|all */
export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope");
  const rules = await listRules({
    status: (q.get("status") as Rule["status"] | "all") ?? "active",
    scope: scope === "video" || scope === "static" ? (scope as Kind) : undefined,
    brand: q.get("brand") ?? undefined,
  });
  return Response.json({ rules });
});

/** The AI proposes rules (status=proposed); a human adding one makes it active. */
export const POST = api(async (req, _ctx, caller) => {
  const input = await body<Partial<Rule> & { rule: string }>(req);
  if (caller.kind === "agent") {
    input.status = "proposed";
    input.created_by = input.created_by || "AI editor";
  }
  return Response.json({ rule: await createRule(input) }, { status: 201 });
});
