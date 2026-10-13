import { createHmac, timingSafeEqual } from "node:crypto";

// Same model as creative.vigomd.com: one team password → signed cookie.
// The AI editor authenticates with a bearer key instead (REVIEW_API_KEY).
// When this moves into the studio app, swap isAuthed() for its own session check.

export const SESSION_COOKIE = "vc_review_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): string {
  return process.env.REVIEW_SESSION_SECRET || process.env.REVIEW_PASSWORD || "dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** No password configured = open access, but only outside production. */
export function authDisabled(): boolean {
  return !process.env.REVIEW_PASSWORD && process.env.NODE_ENV !== "production";
}

export function checkPassword(input: string): boolean {
  const pw = process.env.REVIEW_PASSWORD;
  return Boolean(pw) && safeEqual(input, pw!);
}

export function makeSessionToken(): string {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  return `${exp}.${sign(exp)}`;
}

export function sessionMaxAge(): number {
  return MAX_AGE_S;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) * 1000 > Date.now();
}

export function verifyApiKey(key: string | undefined | null): boolean {
  const want = process.env.REVIEW_API_KEY;
  return Boolean(want && key && safeEqual(key, want));
}

function cookieFrom(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export type Caller = { kind: "human" } | { kind: "agent" };

/** Who is calling an API route: a logged-in reviewer, the AI (bearer key), or nobody. */
export function callerOf(req: Request): Caller | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && verifyApiKey(auth.slice(7).trim())) return { kind: "agent" };
  if (authDisabled()) return { kind: "human" };
  if (verifySessionToken(cookieFrom(req.headers.get("cookie")))) return { kind: "human" };
  return null;
}
