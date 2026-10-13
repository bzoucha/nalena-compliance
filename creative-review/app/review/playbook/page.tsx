import { connection } from "next/server";
import { Shell } from "@/components/review/Shell";
import { Playbook } from "@/components/review/Playbook";
import { listRules } from "@/lib/review/service";

export default async function PlaybookPage() {
  await connection();
  const rules = await listRules({ status: "all" });
  return (
    <Shell active="playbook">
      <Playbook initial={rules} />
    </Shell>
  );
}
