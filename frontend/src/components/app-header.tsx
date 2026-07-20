import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { deadLetterCount } from "@/lib/store";

export function AppHeader({ right }: { right?: React.ReactNode }) {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);

  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const dl = deadLetterCount();

  return (
    <header className="flex h-12 items-center justify-between border-b border-black/40 bg-header px-4 text-header-foreground">
      <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-teal text-white mono">F</span>
        <span>Flowable</span>
        <span className="text-white/50">/</span>
        <span className="font-normal text-white/80">Console</span>
      </Link>
      <nav className="hidden gap-1 md:flex">
        <HeaderLink to="/" label="Instances" active={pathname === "/" || pathname.startsWith("/instances")} />
        <HeaderLink to="/definitions" label="Definitions" active={pathname.startsWith("/definitions")} />
        <HeaderLink to="/deployments" label="Deployments" active={pathname.startsWith("/deployments")} />
        <HeaderLink to="/jobs" label="Jobs" active={pathname.startsWith("/jobs")} badge={dl} />
      </nav>
      <div className="flex items-center gap-3">
        {right}
        <button
          onClick={() => setDark((d) => !d)}
          className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          title="Toggle theme"
        >
          {dark ? "◐ dark" : "◑ light"}
        </button>
        <div className="mono text-[11px] text-white/50">engine: <span className="text-teal">connected</span></div>
      </div>
    </header>
  );
}

function HeaderLink({ to, label, active, badge }: { to: string; label: string; active?: boolean; badge?: number }) {
  const cls = `flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`;
  return (
    <Link to={to} className={cls}>
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-danger/20 px-1.5 mono text-[9px] font-semibold text-danger">{badge}</span>
      )}
    </Link>
  );
}
