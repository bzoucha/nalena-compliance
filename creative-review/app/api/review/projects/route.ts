import { api, body } from "@/lib/review/http";
import { createProject, listProjects, type NewProjectInput } from "@/lib/review/service";

export const GET = api(async (req) => {
  const all = new URL(req.url).searchParams.get("archived") === "1";
  return Response.json({ projects: await listProjects({ includeArchived: all }) });
});

export const POST = api(async (req, _ctx, caller) => {
  const input = await body<NewProjectInput>(req);
  if (caller.kind === "agent") input.source = input.source ?? "ai";
  return Response.json(await createProject(input), { status: 201 });
});
