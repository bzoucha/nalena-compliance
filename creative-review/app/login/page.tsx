import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, makeSessionToken, SESSION_COOKIE, sessionMaxAge } from "@/lib/review/auth";

async function login(formData: FormData) {
  "use server";
  const next = String(formData.get("next") || "/review");
  if (!checkPassword(String(formData.get("password") || ""))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(SESSION_COOKIE, makeSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge(),
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/review");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="relative min-h-screen grid place-items-center overflow-hidden px-6">
      <div className="stars" aria-hidden="true" />
      <div className="glow glow-gold" style={{ top: "-20%", right: "-10%" }} aria-hidden="true" />
      <div className="glow glow-mint" style={{ bottom: "-25%", left: "-10%" }} aria-hidden="true" />
      <div className="card w-full max-w-sm p-8 text-center fade-up">
        <div className="eyebrow mb-6 justify-center">
          <span className="dot" />
          Internal
        </div>
        <h1 className="font-serif text-4xl leading-none text-cream">
          Vigo <em className="text-gold">Review</em>
        </h1>
        <p className="mt-4 text-sm text-stone">Enter the team password.</p>
        <form action={login} className="mt-8 grid gap-3">
          <input type="hidden" name="next" value={next ?? "/review"} />
          <input className="field text-center" type="password" name="password" placeholder="Password" autoFocus required />
          {error && <p className="text-xs text-red">That password didn&apos;t work.</p>}
          <button className="btn-gold" type="submit">
            Enter
          </button>
        </form>
      </div>
    </main>
  );
}
