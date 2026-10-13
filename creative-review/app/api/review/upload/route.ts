import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { callerOf } from "@/lib/review/auth";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/review/files";

// Vercel Blob client-upload token endpoint. Browsers (cookie) and the AI
// editor (bearer key) both upload straight to Blob — big video files never
// pass through a serverless function.
export async function POST(req: Request): Promise<Response> {
  const payload = (await req.json()) as HandleUploadBody;
  if (payload.type === "blob.generate-client-token" && !callerOf(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await handleUpload({
      body: payload,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("review/")) throw new Error("Uploads must go under review/");
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_UPLOAD_BYTES, addRandomSuffix: true };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
