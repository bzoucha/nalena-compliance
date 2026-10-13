import { connection } from "next/server";
import { Shell } from "@/components/review/Shell";
import { SetupAirtable } from "@/components/review/SetupAirtable";

export default async function SetupPage() {
  await connection();
  const env = (k: string) => Boolean(process.env[k]);
  const checks: [string, boolean, string][] = [
    ["REVIEW_PASSWORD", env("REVIEW_PASSWORD"), "Team password for this UI"],
    ["REVIEW_SESSION_SECRET", env("REVIEW_SESSION_SECRET"), "Signs the login cookie"],
    ["REVIEW_API_KEY", env("REVIEW_API_KEY"), "Bearer key the AI editor uses"],
    ["REVIEW_STORE=airtable", process.env.REVIEW_STORE === "airtable", "Store projects/notes in Airtable (else local JSON)"],
    ["AIRTABLE_TOKEN", env("AIRTABLE_TOKEN"), "Airtable personal access token"],
    ["AIRTABLE_REVIEW_BASE_ID", env("AIRTABLE_REVIEW_BASE_ID") || env("AIRTABLE_BASE_ID"), "Base that holds the Review tables"],
    ["REVIEW_FILES=blob", process.env.REVIEW_FILES === "blob", "Store cuts in Vercel Blob (else local disk)"],
    ["BLOB_READ_WRITE_TOKEN", env("BLOB_READ_WRITE_TOKEN"), "Added when you connect a Blob store"],
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
        {process.env.AIRTABLE_TOKEN && <SetupAirtable />}
      </div>
    </Shell>
  );
}
