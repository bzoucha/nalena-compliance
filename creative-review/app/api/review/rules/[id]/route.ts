import { api, body } from "@/lib/review/http";
import { updateRule } from "@/lib/review/service";
import type { Rule } from "@/lib/review/types";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await body<Partial<Rule>>(req);
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ["rule", "detail", "scope", "brand", "status"].includes(k)));
  return Response.json({ rule: await updateRule(id, clean) });
});
