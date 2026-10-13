import { api, body } from "@/lib/review/http";
import { getBundle, updateProject } from "@/lib/review/service";
import type { Project } from "@/lib/review/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  return Response.json(await getBundle(id));
});

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await body<Partial<Project>>(req);
  const allowed: (keyof Project)[] = ["name", "brand", "brief", "format", "footage", "status", "claimed_by"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Project)));
  return Response.json({ project: await updateProject(id, clean) });
});
