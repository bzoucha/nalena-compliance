import Link from "next/link";
import { STATUS_LABEL } from "@/lib/review/labels";

export function Shell({ active, children, wide }: { active?: "projects" | "playbook" | "new"; children: React.ReactNode; wide?: boolean }) {
  const tab = (key: string, href: string, label: string) => (
    <Link href={href} className={active === key ? "on" : ""}>
      {label}
    </Link>
  );
  return (
    <div className="relative min-h-screen">
      <div className="grain" aria-hidden="true" />
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className={`mx-auto flex items-center gap-4 px-4 py-3 sm:px-6 ${wide ? "max-w-[1600px]" : "max-w-6xl"}`}>
          <Link href="/review" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="font-serif text-2xl leading-none text-cream">
              Vigo <em className="text-gold">Review</em>
            </span>
          </Link>
          <nav className="seg ml-auto">
            {tab("projects", "/review", "Projects")}
            {tab("playbook", "/review/playbook", "Playbook")}
          </nav>
          <Link href="/review/new" className="btn-gold btn-sm hidden whitespace-nowrap sm:inline-flex">
            + New
          </Link>
        </div>
      </header>
      <div className={`relative z-[1] mx-auto px-4 pb-16 pt-6 sm:px-6 ${wide ? "max-w-[1600px]" : "max-w-6xl"}`}>{children}</div>
    </div>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill st-${status}`}>{label ?? STATUS_LABEL[status] ?? status}</span>;
}
