import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/pagination";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { jobHealth, usePagedJobs, type EngineJob, type JobKind } from "@/lib/store";

export const Route = createFileRoute("/jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs · Flowable Console" },
      { name: "description", content: "Timers, async continuations and dead-letter jobs across the attached engine." },
      { property: "og:title", content: "Jobs · Flowable Console" },
      { property: "og:description", content: "Timers, async continuations and dead-letter jobs across the attached engine." },
    ],
  }),
  component: JobsListPage,
});

type SortKey = "due" | "age" | "retries";

// Flowable REST job sort field mapping. `retries` doesn't map to a native
// server field on every Flowable version, so we fall back to client-side
// sort over the fetched page for that case (see below).
const SORT_TO_FLOWABLE: Record<SortKey, string | undefined> = {
  due: "dueDate",
  age: "createTime",
  retries: undefined,
};

function JobsListPage() {
  const health = jobHealth();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | JobKind>("all");
  const [sort, setSort] = useState<SortKey>("due");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [q, type, sort, pageSize]);

  const paged = usePagedJobs({
    page,
    pageSize,
    jobType: type === "all" ? undefined : type,
    sort: SORT_TO_FLOWABLE[sort],
    order: "asc",
  });

  // Text search and `retries` sort don't map to Flowable REST params -
  // apply them over the currently-fetched page. The "N shown" label
  // reflects that post-filter count; server-authoritative `total` still
  // drives Pagination's page count and Next/Prev buttons.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = !needle
      ? paged.items
      : paged.items.filter((j) =>
          j.activityName.toLowerCase().includes(needle) ||
          j.businessKey.toLowerCase().includes(needle) ||
          j.id.toLowerCase().includes(needle) ||
          (j.exceptionMessage ?? "").toLowerCase().includes(needle),
        );
    if (sort === "retries") {
      return filtered.slice().sort((a, b) => a.retries - b.retries);
    }
    return filtered;
  }, [paged.items, q, sort]);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Job executor</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What the async executor is doing right now. {paged.total} jobs total.
            </p>
          </div>

          <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Timers" n={health.timers} tone="muted"
              hint={health.nextTimerDue ? <>next <RelTime iso={health.nextTimerDue} /></> : "none scheduled"}
            />
            <Kpi
              label="Async" n={health.async} tone="teal"
              hint={health.oldestAsyncCreated ? <>oldest <RelTime iso={health.oldestAsyncCreated} /></> : "queue empty"}
            />
            <Kpi
              label="Dead-letter" n={health.dead} tone={health.dead > 0 ? "danger" : "muted"}
              hint={health.dead > 0 ? "needs attention" : "clean"}
            />
            <Kpi label="Locked" n={health.locked} tone="muted" hint={health.locked > 0 ? "workers busy" : "engine idle"} />
          </section>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search activity, instance, exception…"
              className="w-72 rounded border border-input bg-panel-2 px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <Select label="Type" value={type} onChange={(v) => setType(v as typeof type)} options={[
              ["all", "All types"], ["timer", "Timer"], ["async", "Async"], ["deadletter", "Dead-letter"],
            ]} />
            <Select label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)} options={[
              ["due", "Due date"], ["age", "Age"], ["retries", "Retries"],
            ]} />
            <span className="ml-auto mono text-[10px] text-muted-foreground">
              {paged.loading ? "Loading…" : `${rows.length} shown`}
            </span>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border border-border bg-panel">
            <div className="grid grid-cols-[80px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_70px_minmax(0,1.4fr)] items-center gap-3 border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Type</div>
              <div>Activity</div>
              <div>Instance</div>
              <div className="text-right">Due / Age</div>
              <div className="text-right">Retries</div>
              <div>Exception</div>
            </div>
            {paged.error ? (
              <div className="p-8 text-center text-xs text-danger">Failed to load jobs: {paged.error.message}</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {paged.loading ? "Loading jobs…" : "No jobs match those filters."}
              </div>
            ) : (
              rows.map((j, i) => <Row key={j.id} j={j} last={i === rows.length - 1} />)
            )}
          </div>
          <Pagination
            total={paged.total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </main>
    </AppShell>
  );
}

function Row({ j, last }: { j: EngineJob; last: boolean }) {
  const dot =
    j.type === "deadletter" ? "bg-danger" :
    j.type === "timer" ? "bg-warning" :
    "bg-teal";
  return (
    <Link
      to="/jobs/$id"
      params={{ id: j.id }}
      className={`grid grid-cols-[80px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_70px_minmax(0,1.4fr)] items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-panel-2 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="mono text-[10px] uppercase text-muted-foreground">{j.type}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate">{j.activityName}</div>
        <div className="truncate mono text-[10px] text-muted-foreground">{j.id}</div>
      </div>
      <div className="min-w-0 truncate mono text-[11px]">
        {j.businessKey} <span className="text-muted-foreground">· {j.definitionKey} v{j.version}</span>
      </div>
      <div className="text-right text-[11px] text-muted-foreground">
        {j.dueDate ? <RelTime iso={j.dueDate} /> : <RelTime iso={j.createdAt} />}
      </div>
      <div className="text-right mono text-[11px]">
        <span className={j.retries === 0 ? "text-danger" : "text-foreground"}>{j.retries}</span>
        <span className="text-muted-foreground">/{j.maxRetries}</span>
      </div>
      <div className="min-w-0 truncate text-[11px] text-muted-foreground">
        {j.exceptionMessage ?? "—"}
      </div>
    </Link>
  );
}

function Kpi({ label, n, tone, hint }: { label: string; n: number; tone: "teal" | "danger" | "muted"; hint?: React.ReactNode }) {
  const cls = { teal: "text-teal", danger: "text-danger", muted: "text-foreground" }[tone];
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 mono text-2xl font-semibold ${cls}`}>{n}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-input bg-panel-2 px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-teal"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
