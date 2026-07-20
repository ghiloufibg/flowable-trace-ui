import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { activeCountForDefinition, activeInstanceCount, formatBytes, getDeployment, type Deployment, type DeploymentResource } from "@/lib/store";

export const Route = createFileRoute("/deployments/$id")({
  loader: ({ params }) => {
    const dep = getDeployment(params.id);
    if (!dep) throw notFound();
    return { dep };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Deployment not found · Flowable Console" }, { name: "robots", content: "noindex" }] };
    }
    const { dep } = loaderData;
    return {
      meta: [
        { title: `${dep.name} v${dep.version} · Deployments · Flowable Console` },
        { name: "description", content: `Deployment ${dep.id} — resources, definitions and activity for ${dep.name}.` },
        { property: "og:title", content: `${dep.name} v${dep.version}` },
        { property: "og:description", content: `Deployment ${dep.id} — resources, definitions and activity.` },
      ],
    };
  },
  notFoundComponent: () => (
    <AppShell>
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <div className="mono text-[11px] uppercase tracking-wider text-muted-foreground">Not found</div>
          <div className="mt-1 text-lg font-semibold">Deployment does not exist</div>
          <Link to="/deployments" className="mt-3 inline-block text-xs text-teal hover:underline">← Back to deployments</Link>
        </div>
      </div>
    </AppShell>
  ),
  component: DeploymentDetailPage,
});

type Tab = "definitions" | "resources" | "activity";

function DeploymentDetailPage() {
  const { dep } = Route.useLoaderData();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("definitions");
  const [selected, setSelected] = useState<DeploymentResource | null>(dep.resources[0] ?? null);
  const active = activeInstanceCount(dep);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          {/* Header */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <Link to="/deployments" className="text-[10px] text-muted-foreground hover:text-foreground">← Deployments</Link>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">{dep.name}</h1>
                <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 mono text-[10px] text-muted-foreground">v{dep.version}</span>
                <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{dep.tenantId}</span>
                <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{dep.source}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                <span className="mono">{dep.id}</span>
                <span className="mx-1.5">·</span>
                <RelTime iso={dep.deployedAt} />
                <span className="mx-1.5">·</span>
                by <span className="mono">{dep.deployedBy}</span>
                <span className="mx-1.5">·</span>
                {active > 0 ? <span className="text-teal">{active} active instances</span> : <span>no active instances</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <HeaderBtn onClick={() => navigator.clipboard?.writeText(dep.id)}>Copy ID</HeaderBtn>
              <HeaderBtn onClick={() => alert("Download would export a .bar archive")}>Download</HeaderBtn>
              <HeaderBtn onClick={() => alert("Redeploy would open the upload dialog seeded with this bundle")}>Redeploy</HeaderBtn>
              <HeaderBtn
                tone="danger"
                onClick={() => {
                  if (confirm(`Delete ${dep.name} v${dep.version}? This cannot be undone.`)) {
                    router.navigate({ to: "/deployments" });
                  }
                }}
              >
                Delete
              </HeaderBtn>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex gap-1 border-b border-border text-xs">
            {(["definitions", "resources", "activity"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-1.5 capitalize transition-colors ${
                  tab === t ? "border-teal text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "definitions" && <DefinitionsTab dep={dep} />}
          {tab === "resources" && (
            <ResourcesTab dep={dep} selected={selected} onSelect={setSelected} />
          )}
          {tab === "activity" && <ActivityTab dep={dep} />}
        </div>
      </main>
    </AppShell>
  );
}

function HeaderBtn({
  children, onClick, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "danger";
}) {
  const cls =
    tone === "danger"
      ? "border-danger/40 text-danger hover:bg-danger/10"
      : "border-border text-foreground hover:bg-panel-2";
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[11px] transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function DefinitionsTab({ dep }: { dep: Deployment }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-border bg-panel">
      <div className="grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_60px_120px] items-center gap-3 border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div>Kind</div>
        <div>Name</div>
        <div>Key</div>
        <div className="text-right">Ver</div>
        <div className="text-right">Instances</div>
      </div>
      {dep.definitions.map((d, i) => {
        // Active-only, matching the page header's "N active instances" figure - previously this
        // counted all instances (active + ended), which summed to a different total than the
        // header and read as a data bug even though both numbers were individually correct.
        const count = activeCountForDefinition(d.key, d.version);
        return (
          <div
            key={d.id}
            className={`grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_60px_120px] items-center gap-3 px-3 py-2 text-xs ${
              i === dep.definitions.length - 1 ? "" : "border-b border-border"
            }`}
          >
            <div>
              <span className="rounded bg-teal/15 px-1.5 py-0.5 mono text-[10px] uppercase text-teal">{d.kind}</span>
            </div>
            <div className="truncate">{d.name}</div>
            <div className="truncate mono text-[11px] text-muted-foreground">{d.key}</div>
            <div className="text-right mono text-[11px] text-muted-foreground">v{d.version}</div>
            <div className="text-right mono text-[11px]">{count}</div>
          </div>
        );
      })}
    </div>
  );
}

function ResourcesTab({
  dep, selected, onSelect,
}: {
  dep: Deployment;
  selected: DeploymentResource | null;
  onSelect: (r: DeploymentResource) => void;
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-md border border-border bg-panel">
        <div className="border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {dep.resources.length} resources
        </div>
        {dep.resources.map((r) => {
          const isSel = selected?.name === r.name;
          return (
            <button
              key={r.name}
              onClick={() => onSelect(r)}
              className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
                isSel ? "bg-teal/10" : "hover:bg-panel-2"
              }`}
            >
              <span className="mono text-[10px] uppercase text-muted-foreground">{r.kind}</span>
              <span className="min-w-0 flex-1 truncate mono text-[11px]">{r.name}</span>
              <span className="mono text-[10px] text-muted-foreground">{formatBytes(r.sizeBytes)}</span>
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-panel">
        <div className="border-b border-border bg-panel-2 px-3 py-2 text-[11px]">
          <span className="mono">{selected?.name ?? "—"}</span>
          {selected && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              {selected.kind} · {formatBytes(selected.sizeBytes)}
            </span>
          )}
        </div>
        {selected?.preview ? (
          <pre className="max-h-[540px] overflow-auto scrollbar-thin p-3 mono text-[11px] leading-relaxed text-foreground/90">
            {selected.preview}
          </pre>
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {selected ? "Binary resource — no text preview available." : "Select a resource to preview it."}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTab({ dep }: { dep: Deployment }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-border bg-panel">
      {dep.activity.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 px-3 py-2 text-xs ${
            i === dep.activity.length - 1 ? "" : "border-b border-border"
          }`}
        >
          <span
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              a.kind === "created" ? "bg-teal" :
              a.kind === "superseded" ? "bg-muted-foreground" :
              a.kind === "instance-started" ? "bg-success" :
              "bg-danger"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <span className="mono text-[10px] uppercase text-muted-foreground">{a.kind}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{a.detail}</span>
            </div>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            <RelTime iso={a.at} />
          </span>
        </div>
      ))}
    </div>
  );
}
