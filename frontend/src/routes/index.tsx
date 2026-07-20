import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { currentActivities, failedJobCount, type ProcessInstance } from "@/lib/store";
import { useInstances } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview · Flowable Console" },
      { name: "description", content: "Live view of Flowable BPMN process instances — inspect, debug, and replay running workflows in real time." },
      { property: "og:title", content: "Flowable Console — Live process instance debugger" },
      { property: "og:description", content: "Attach to a running Flowable engine and see exactly what your BPMN processes are doing, right now." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const instances = useInstances();
  const roots = instances.filter((p) => !p.parentInstanceId);
  const active = roots.filter((p) => p.status === "active");
  const failed = roots.filter((p) => p.status === "failed");
  const ended  = roots.filter((p) => p.status === "ended");
  const totalFailedJobs = roots.reduce((n, p) => n + failedJobCount(p), 0);
  const attention = roots
    .filter((p) => p.status === "failed" || failedJobCount(p) > 0)
    .concat(roots.filter((p) => currentActivities(p).some((n) => n.dueDate && new Date(n.dueDate).getTime() < Date.now())))
    .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Engine overview</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Everything running in the attached Flowable engine — pick an instance from the sidebar to drill in.
              </p>
            </div>
            <div className="mono text-[10px] text-muted-foreground">
              refreshed just now · live
            </div>
          </div>

          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Active" n={active.length} tone="teal" />
            <Kpi label="Failed" n={failed.length} tone="danger" hint={totalFailedJobs > 0 ? `${totalFailedJobs} dead-letter jobs` : undefined} />
            <Kpi label="Ended" n={ended.length} tone="success" />
            <Kpi label="Definitions" n={new Set(roots.map((p) => p.definitionKey)).size} tone="muted" />
          </section>

          <section className="mt-6">
            <SectionHeader title="Needs attention" hint="Failed jobs, missed SLAs, dead-letters" />
            {attention.length === 0 ? (
              <EmptyPanel>Nothing needs attention — every instance is healthy.</EmptyPanel>
            ) : (
              <div className="mt-2 overflow-hidden rounded-md border border-border">
                {attention.map((p, i) => (
                  <AttentionRow key={p.id} p={p} last={i === attention.length - 1} />
                ))}
              </div>
            )}
          </section>

          <section className="mt-6">
            <SectionHeader title="Recently updated" />
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {roots.slice(0, 6).map((p) => (
                <InstanceCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function Kpi({ label, n, tone, hint }: { label: string; n: number; tone: "teal" | "danger" | "success" | "muted"; hint?: string }) {
  const cls = {
    teal: "text-teal", danger: "text-danger", success: "text-success", muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 mono text-2xl font-semibold ${cls}`}>{n}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function AttentionRow({ p, last }: { p: ProcessInstance; last: boolean }) {
  const failed = failedJobCount(p);
  const activeNode = currentActivities(p)[0];
  return (
    <Link
      to="/instances/$id"
      params={{ id: p.id }}
      className={`flex items-center gap-3 bg-panel px-3 py-2 text-xs transition-colors hover:bg-panel-2 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.status === "failed" ? "bg-danger" : "bg-warning"} animate-pulse`} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <span className="font-medium">{p.definitionName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="mono">{p.businessKey}</span>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          Stuck at {activeNode?.name ?? "—"} · started <RelTime iso={p.startedAt} />
        </div>
      </div>
      {failed > 0 && (
        <span className="shrink-0 rounded-full bg-danger/20 px-2 py-0.5 mono text-[10px] font-semibold text-danger">
          {failed} failed job{failed > 1 ? "s" : ""}
        </span>
      )}
      <span className="text-muted-foreground">→</span>
    </Link>
  );
}

function InstanceCard({ p }: { p: ProcessInstance }) {
  const dot =
    p.status === "failed" ? "bg-danger" :
    p.status === "ended" ? "bg-success" : "bg-teal";
  const activeNode = currentActivities(p)[0];
  return (
    <Link
      to="/instances/$id"
      params={{ id: p.id }}
      className="block rounded-md border border-border bg-panel p-3 transition-colors hover:border-teal/40"
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-xs font-medium">{p.definitionName}</span>
        <span className="mono text-[10px] text-muted-foreground">v{p.version}</span>
        <span className="ml-auto mono text-[10px] text-muted-foreground">
          <RelTime iso={p.startedAt} />
        </span>
      </div>
      <div className="mt-1.5 mono text-[11px]">{p.businessKey}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {activeNode ? `at: ${activeNode.name}` : "ended"}
      </div>
    </Link>
  );
}
