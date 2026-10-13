import "server-only";
import { callerOf, type Caller } from "./auth";
import { ReviewError } from "./service";

type Handler<C> = (req: Request, ctx: C, caller: Caller) => Promise<Response> | Response;

/** Auth (cookie or bearer key) + uniform JSON errors for every review API route. */
export function api<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const caller = callerOf(req);
    if (!caller) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      return await handler(req, ctx, caller);
    } catch (e) {
      if (e instanceof ReviewError) return Response.json({ error: e.message }, { status: e.status });
      console.error("[review api]", e);
      return Response.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ReviewError("Body must be JSON");
  }
}
