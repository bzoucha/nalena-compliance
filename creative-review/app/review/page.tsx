import { connection } from "next/server";
import { Shell } from "@/components/review/Shell";
import { Dashboard } from "@/components/review/Dashboard";
import { listProjects } from "@/lib/review/service";

export default async function ReviewHome() {
  await connection();
  const projects = await listProjects({ includeArchived: true });
  return (
    <Shell active="projects">
      <Dashboard initial={projects} />
    </Shell>
  );
}
