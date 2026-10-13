import { Shell } from "@/components/review/Shell";
import { NewProjectForm } from "@/components/review/NewProjectForm";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return (
    <Shell active="new">
      <NewProjectForm initialKind={kind === "static" ? "static" : "video"} />
    </Shell>
  );
}
