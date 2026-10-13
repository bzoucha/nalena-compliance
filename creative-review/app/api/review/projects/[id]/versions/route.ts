import { api, body } from "@/lib/review/http";
import { addVersion, getBundle, type NewVersionInput } from "@/lib/review/service";

type Ctx = { params: Promise<{ id: string }> };

/** Upload a new cut. The AI includes `resolutions` to close out the last round's notes. */
export const POST = api<Ctx>(async (req, { params }, caller) => {
  const { id } = await params;
  const input = await body<NewVersionInput>(req);
  if (caller.kind === "agent" && !input.uploaded_by) input.uploaded_by = "AI editor";
  const version = await addVersion(id, input);
  return Response.json({ version, ...(await getBundle(id)) }, { status: 201 });
});
