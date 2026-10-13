import { connection } from "next/server";
import { Shell } from "@/components/review/Shell";
import { storeStatus } from "@/lib/review/store";

export default async function SetupPage() {
  await connection();
  const env = (k: string) => Boolean(process.env[k]);
  const db = await storeStatus();
  const checks: [string, boolean, string][] = [
    ["REVIEW_PASSWORD", env("REVIEW_PASSWORD"), "Team password for this UI"],
    ["REVIEW_SESSION_SECRET", env("REVIEW_SESSION_SECRET"), "Signs the login cookie"],
    ["REVIEW_API_KEY", env("REVIEW_API_KEY"), "Bearer key the AI editor uses"],
    ["DATABASE_URL", env("DATABASE_URL") || env("POSTGRES_URL"), "Added when you connect a Postgres database"],
    ["BLOB_READ_WRITE_TOKEN", env("BLOB_READ_WRITE_TOKEN"), "Added when you connect a Blob store (where the videos live)"],
    ["REVIEW_WEBHOOK_URL", env("REVIEW_WEBHOOK_URL"), "Optional: ping Slack/Telegram/Make on new versions"],
  ];
  return (
    <Shell>
      <div className="fade-up mx-auto max-w-2xl">
        <h1 className="font-serif text-4xl">
          Set<em className="text-gold">up</em>
        </h1>
        <section className="card mt-6 p-5">
          <div className="k">Environment</div>
          <ul className="mt-3 space-y-2 text-sm">
            {checks.map(([k, ok, why]) => (
              <li key={k} className="flex items-center gap-3">
                <span className={ok ? "text-mint" : "text-stone"}>{ok ? "●" : "○"}</span>
                <code className="num text-xs">{k}</code>
                <span className="ml-auto text-xs text-stone">{why}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card mt-6 p-5 text-sm">
          <div className="k">Database · {db.kind === "postgres" ? "Postgres" : "local file (dev only)"}</div>
          {db.ok ? (
            <p className="mt-3">
              <span className="text-mint">● Connected.</span>{" "}
              <span className="text-stone">
                {db.counts!.projects} projects · {db.counts!.versions} versions · {db.counts!.comments} notes · {db.counts!.rules} rules
              </span>
            </p>
          ) : (
            <p className="mt-3 text-red">{db.error}</p>
          )}
          <p className="mt-2 text-xs text-stone">Tables are created automatically the first time the app runs.</p>
        </section>
      </div>
    </Shell>
  );
}
