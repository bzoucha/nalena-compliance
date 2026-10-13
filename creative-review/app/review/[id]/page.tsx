import { notFound } from "next/navigation";
import { Shell } from "@/components/review/Shell";
import { ReviewRoom } from "@/components/review/ReviewRoom";
import { getBundle, ReviewError } from "@/lib/review/service";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getBundle(id).catch((e) => {
    if (e instanceof ReviewError && e.status === 404) notFound();
    throw e;
  });
  return (
    <Shell wide>
      <ReviewRoom initial={bundle} />
    </Shell>
  );
}
