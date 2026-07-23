import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/pagination";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import {
  activeCountForDefinition,
  usePagedDefinitions,
  versionCount,
  type ProcessDefinition,
} from "@/lib/store";

export const Route = createFileRoute("/definitions/")({
  head: () => ({
    meta: [
      { title: "Process definitions · Flowable Console" },
      { name: "description", content: "Browse deployed BPMN process definitions, their versions and active instances." },
      { property: "og:title", content: "Process definitions · Flowable Console" },
      { property: "og:description", content: "Browse deployed BPMN process definitions, their versions and active instances." },
    ],
  }),
  component: DefinitionsListPage,
});

function DefinitionsListPage() {
  const [q, setQ] = useState("");
  const [tenant, setTenant] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [q, tenant, status, pageSize]);

  const paged = usePagedDefinitions({
    page,
    pageSize,
    nameLike: q.trim() || undefined,
    tenantId: tenant !== "all" ? tenant : undefined,
    suspended: status === "all" ? undefined : status === "suspended",
    latest: true,
  });

  const tenants = useMemo(() => Array.from(new Set(paged.items.map((d) => d.tenantId))).sort(), [paged.items]);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Process definitions</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {paged.total} unique definition keys · click a row to see all versions.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or key…"
              className="w-64 rounded border border-input bg-panel-2 px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <Select label="Tenant" value={tenant} onChange={setTenant} options={[["all", "All tenants"], ...tenants.map((t) => [t, t] as [string, string])]} />
            <Select label="Status" value={status} onChange={(v) => setStatus(v as typeof status)} options={[["all", "Any status"], ["active", "Active"], ["suspended", "Suspended"]]} />
            <span className="ml-auto mono text-[10px] text-muted-foreground">
              {paged.loading ? "Loading…" : `${paged.items.length} shown`}
            </span>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border border-border bg-panel">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_70px_80px_80px_120px] items-center gap-3 border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Name</div>
              <div>Key</div>
              <div className="text-right">Latest</div>
              <div className="text-right">Versions</div>
              <div className="text-right">Active</div>
              <div className="text-right">Deployed</div>
            </div>
            {paged.error ? (
              <div className="p-8 text-center text-xs text-danger">Failed to load definitions: {paged.error.message}</div>
            ) : paged.items.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {paged.loading ? "Loading definitions…" : "No definitions match those filters."}
              </div>
            ) : (
              paged.items.map((d, i) => <Row key={d.key} d={d} last={i === paged.items.length - 1} />)
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

function Row({ d, last }: { d: ProcessDefinition; last: boolean }) {
  const active = activeCountForDefinition(d.key);
  const versions = versionCount(d.key);
  return (
    <Link
      to="/definitions/$key"
      params={{ key: d.key }}
      className={`grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_70px_80px_80px_120px] items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-panel-2 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{d.name}</span>
          {d.isSuspended && (
            <span className="rounded bg-warning/20 px-1.5 py-0.5 mono text-[9px] uppercase text-warning">suspended</span>
          )}
        </div>
        <div className="truncate mono text-[10px] text-muted-foreground">{d.tenantId} · {d.category ?? "—"}</div>
      </div>
      <div className="truncate mono text-[11px]">{d.key}</div>
      <div className="text-right mono text-[11px]">v{d.version}</div>
      <div className="text-right mono text-[11px] text-muted-foreground">{versions}</div>
      <div className="text-right mono text-[11px]">
        {active > 0 ? <span className="text-teal">{active}</span> : <span className="text-muted-foreground">0</span>}
      </div>
      <div className="text-right text-[11px] text-muted-foreground">
        <RelTime iso={d.deployedAt} />
      </div>
    </Link>
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
