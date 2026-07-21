import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { ensureJob, jobsForInstance, type EngineJob } from "@/lib/store";

export const Route = createFileRoute("/jobs/$id")({
  loader: async ({ params }) => {
    const job = await ensureJob(params.id);
    if (!job) throw notFound();
    return { job };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Job not found · Flowable Console" }, { name: "robots", content: "noindex" }] };
    }
    const { job } = loaderData;
    return {
      meta: [
        { title: `${job.type} ${job.id} · Jobs · Flowable Console` },
        { name: "description", content: `${job.activityName} on ${job.businessKey} — ${job.type} job details.` },
        { property: "og:title", content: `${job.type} ${job.id}` },
        { property: "og:description", content: `${job.activityName} on ${job.businessKey}.` },
      ],
    };
  },
  notFoundComponent: () => (
    <AppShell>
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <div className="mono text-[11px] uppercase tracking-wider text-muted-foreground">Not found</div>
          <div className="mt-1 text-lg font-semibold">Job does not exist</div>
          <Link to="/jobs" className="mt-3 inline-block text-xs text-teal hover:underline">← Back to jobs</Link>
        </div>
      </div>
    </AppShell>
  ),
  component: JobDetailPage,
});

function JobDetailPage() {
  const { job } = Route.useLoaderData();
  const related = jobsForInstance(job.instanceId).filter((j) => j.id !== job.id);
  const dot =
    job.type === "deadletter" ? "bg-danger" :
    job.type === "timer" ? "bg-warning" :
    "bg-teal";

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1100px] p-6">
          <Link to="/jobs" className="text-[10px] text-muted-foreground hover:text-foreground">← Jobs</Link>

          <div className="mt-1 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="mono text-[10px] uppercase text-muted-foreground">{job.type}</span>
                <h1 className="mono text-base font-semibold tracking-tight">{job.id}</h1>
                {job.retries === 0 && (
                  <span className="rounded bg-danger/20 px-1.5 py-0.5 mono text-[9px] uppercase text-danger">no retries left</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                <span>{job.activityName}</span>
                <span className="mx-1.5">·</span>
                <span className="mono">{job.definitionKey} v{job.version}</span>
                <span className="mx-1.5">·</span>
                <span className="mono">{job.businessKey}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <HeaderBtn onClick={() => navigator.clipboard?.writeText(job.id)}>Copy ID</HeaderBtn>
              <Link
                to="/instances/$id"
                params={{ id: job.instanceId }}
                className="rounded border border-border px-2 py-1 text-[11px] transition-colors hover:bg-panel-2"
              >
                Open instance
              </Link>
              <HeaderBtn primary disabled title="Not yet implemented">
                Retry now
              </HeaderBtn>
              <HeaderBtn tone="danger" disabled title="Not yet implemented">
                Delete
              </HeaderBtn>
            </div>
          </div>

          <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoPanel title="Job">
              <Row k="Type" v={<span className="capitalize">{job.type}</span>} />
              <Row k="Activity" v={<><span className="mono text-[11px]">{job.activityId}</span> · {job.activityName}</>} />
              <Row k="Retries" v={<span className="mono">{job.retries}/{job.maxRetries}</span>} />
              <Row k="Due" v={job.dueDate ? <RelTime iso={job.dueDate} /> : "—"} />
              <Row k="Created" v={<RelTime iso={job.createdAt} />} />
              <Row k="Lock owner" v={job.lockOwner ? <span className="mono">{job.lockOwner}</span> : "—"} />
              <Row k="Lock expires" v={job.lockExpiresAt ? <RelTime iso={job.lockExpiresAt} /> : "—"} />
            </InfoPanel>
            <InfoPanel title="Context">
              <Row k="Instance" v={
                <Link to="/instances/$id" params={{ id: job.instanceId }} className="mono text-teal hover:underline">
                  {job.businessKey}
                </Link>
              } />
              <Row k="Definition" v={
                <Link to="/definitions/$key/$version" params={{ key: job.definitionKey, version: String(job.version) }} className="text-teal hover:underline">
                  {job.definitionName} v{job.version}
                </Link>
              } />
              <Row k="Executor" v={<span className="mono text-[11px]">last poll 2s ago · workers 4/4 idle</span>} />
            </InfoPanel>
          </section>

          {(job.exceptionClass || job.exceptionMessage) && (
            <section className="mt-4 overflow-hidden rounded-md border border-danger/40 bg-danger/5">
              <div className="flex items-center justify-between border-b border-danger/30 bg-danger/10 px-3 py-2">
                <div className="min-w-0">
                  <div className="mono text-[11px] font-semibold text-danger">{job.exceptionClass ?? "Error"}</div>
                  {job.exceptionMessage && (
                    <div className="mt-0.5 truncate text-[11px] text-foreground/90">{job.exceptionMessage}</div>
                  )}
                </div>
                {job.stackTrace && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(job.stackTrace!)}
                    className="shrink-0 rounded border border-danger/40 px-2 py-0.5 text-[10px] text-danger hover:bg-danger/10"
                  >
                    Copy stack
                  </button>
                )}
              </div>
              {job.stackTrace && (
                <pre className="max-h-72 overflow-auto scrollbar-thin p-3 mono text-[10.5px] leading-relaxed text-foreground/90">
                  {job.stackTrace}
                </pre>
              )}
            </section>
          )}

          <section className="mt-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Retry history</h2>
            <div className="mt-2 overflow-hidden rounded-md border border-border bg-panel">
              {job.attempts.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No attempts recorded yet.</div>
              ) : (
                job.attempts.map((a: import("@/lib/store").JobAttempt, i: number) => (
                  <div
                    key={i}
                    className={`grid grid-cols-[80px_120px_90px_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-xs ${
                      i === job.attempts.length - 1 ? "" : "border-b border-border"
                    }`}
                  >
                    <span className={`mono text-[10px] uppercase ${a.outcome === "success" ? "text-success" : "text-danger"}`}>
                      {a.outcome}
                    </span>
                    <span className="text-[11px] text-muted-foreground"><RelTime iso={a.at} /></span>
                    <span className="mono text-[11px]">{a.durationMs}ms</span>
                    <span className="truncate mono text-[10px] text-muted-foreground">{a.worker}{a.error ? ` · ${a.error}` : ""}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {related.length > 0 && (
            <section className="mt-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Other jobs on this instance</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    to="/jobs/$id"
                    params={{ id: r.id }}
                    className="flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 text-[11px] transition-colors hover:border-teal/40"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      r.type === "deadletter" ? "bg-danger" :
                      r.type === "timer" ? "bg-warning" : "bg-teal"
                    }`} />
                    <span className="mono">{r.id}</span>
                    <span className="text-muted-foreground">· {r.activityName}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-panel">
      <div className="border-b border-border bg-panel-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <dl className="divide-y divide-border">{children}</dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 px-3 py-1.5 text-xs">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className="min-w-0 truncate">{v}</dd>
    </div>
  );
}

function HeaderBtn({
  children, onClick, tone, primary, disabled, title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "danger";
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const cls = primary
    ? "bg-teal text-teal-foreground border-transparent hover:opacity-90"
    : tone === "danger"
      ? "border-danger/40 text-danger hover:bg-danger/10"
      : "border-border text-foreground hover:bg-panel-2";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

// Suppress unused param TS complaints in strict mode when EngineJob attempts field is empty
export type { EngineJob };
