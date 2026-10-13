import { NextResponse, type NextRequest } from "next/server";
import { authDisabled, SESSION_COOKIE, verifySessionToken } from "@/lib/review/auth";

// Gate the review pages behind the team password. API routes check auth
// themselves (they also accept the AI's bearer key), so they're not matched
// here — that also keeps large uploads from being buffered by the proxy.
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/") return NextResponse.redirect(new URL("/review", req.url));
  if (authDisabled() || verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/login", req.url);
  login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/", "/review/:path*"],
};
