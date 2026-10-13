import { api } from "@/lib/review/http";
import { agentJobs } from "@/lib/review/service";

/**
 * Everything the AI editor needs in one call: queued briefs + projects with
 * notes waiting, each with its brief, footage, latest cut, open timestamped
 * feedback and the playbook rules that apply.
 *   ?project=recXXX   just that project (any status)
 *   ?editing=1        also include jobs already claimed
 */
export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams;
  const jobs = await agentJobs({ projectId: q.get("project") ?? undefined, includeEditing: q.get("editing") === "1" });
  return Response.json({ jobs });
});
