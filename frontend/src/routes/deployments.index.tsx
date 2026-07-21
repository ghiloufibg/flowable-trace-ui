import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/pagination";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { activeInstanceCount, useDeployments, type Deployment, type DeploymentSource } from "@/lib/store";

export const Route = createFileRoute("/deployments/")({
  head: () => ({
    meta: [
      { title: "Deployments · Flowable Console" },
      { name: "description", content: "Browse, upload and manage BPMN/DMN deployments across your engine." },
      { property: "og:title", content: "Deployments · Flowable Console" },
      { property: "og:description", content: "Browse, upload and manage BPMN/DMN deployments across your engine." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DeploymentsListPage,
});

function DeploymentsListPage() {
  const all = useDeployments();
  const [q, setQ] = useState("");
  const [tenant, setTenant] = useState<string>("all");
  const [source, setSource] = useState<"all" | DeploymentSource>("all");

  const tenants = useMemo(() => Array.from(new Set(all.map((d) => d.tenantId))).sort(), [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((d) => {
      if (tenant !== "all" && d.tenantId !== tenant) return false;
      if (source !== "all" && d.source !== source) return false;
      if (!needle) return true;
      return (
        d.name.toLowerCase().includes(needle) ||
        d.key.toLowerCase().includes(needle) ||
        d.id.toLowerCase().includes(needle)
      );
    });
  }, [all, q, tenant, source]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [q, tenant, source, rows.length]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Deployments</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Every BPMN/DMN bundle deployed to the attached engine. {all.length} total.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-teal-foreground hover:opacity-90"
              onClick={() => alert("Upload flow — wire this to BpmnXmlLoader in the next pass.")}
            >
              + Upload deployment
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, key, or ID…"
              className="w-64 rounded border border-input bg-panel-2 px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <Select label="Tenant" value={tenant} onChange={setTenant} options={[["all", "All tenants"], ...tenants.map((t) => [t, t] as [string, string])]} />
            <Select label="Source" value={source} onChange={(v) => setSource(v as typeof source)} options={[["all", "Any source"], ["upload", "Upload"], ["api", "API"], ["designer", "Designer"]]} />
            <span className="ml-auto mono text-[10px] text-muted-foreground">{rows.length} shown</span>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border border-border bg-panel">
            <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_60px_90px_90px_120px] items-center gap-3 border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Name</div>
              <div>Key</div>
              <div className="text-right">Ver</div>
              <div>Tenant</div>
              <div className="text-right">Active</div>
              <div className="text-right">Deployed</div>
            </div>
            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No deployments match those filters.
              </div>
            ) : (
              pageRows.map((d, i) => <Row key={d.id} d={d} last={i === pageRows.length - 1} />)
            )}
          </div>
          <Pagination
            total={rows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </main>
    </AppShell>
  );
}

function Row({ d, last }: { d: Deployment; last: boolean }) {
  const active = activeInstanceCount(d);
  return (
    <Link
      to="/deployments/$id"
      params={{ id: d.id }}
      className={`grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_60px_90px_90px_120px] items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-panel-2 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{d.name}</div>
        <div className="truncate mono text-[10px] text-muted-foreground">{d.id}</div>
      </div>
      <div className="truncate mono text-[11px]">{d.key}</div>
      <div className="text-right mono text-[11px] text-muted-foreground">v{d.version}</div>
      <div>
        <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{d.tenantId}</span>
      </div>
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
