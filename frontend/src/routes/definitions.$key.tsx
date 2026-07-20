import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import {
  activeCountForDefinition,
  instancesForDefinition,
  listDefinitionVersions,
  type ProcessDefinition,
} from "@/lib/store";

export const Route = createFileRoute("/definitions/$key")({
  loader: ({ params }) => {
    const versions = listDefinitionVersions(params.key);
    if (versions.length === 0) throw notFound();
    return { versions, key: params.key };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Definition not found · Flowable Console" }, { name: "robots", content: "noindex" }] };
    }
    const latest = loaderData.versions[0];
    return {
      meta: [
        { title: `${latest.name} · Definitions · Flowable Console` },
        { name: "description", content: `Version history and active instances for ${latest.name} (${latest.key}).` },
        { property: "og:title", content: `${latest.name} · Definitions` },
        { property: "og:description", content: `Version history and active instances for ${latest.name}.` },
      ],
    };
  },
  notFoundComponent: () => (
    <AppShell>
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <div className="mono text-[11px] uppercase tracking-wider text-muted-foreground">Not found</div>
          <div className="mt-1 text-lg font-semibold">No definition with that key</div>
          <Link to="/definitions" className="mt-3 inline-block text-xs text-teal hover:underline">← Back to definitions</Link>
        </div>
      </div>
    </AppShell>
  ),
  component: DefinitionVersionsPage,
});

function DefinitionVersionsPage() {
  const { versions, key } = Route.useLoaderData();
  const latest = versions[0];
  const totalActive = activeCountForDefinition(key);
  const recent = instancesForDefinition(key)
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 10);

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1200px] p-6">
          <Link to="/definitions" className="text-[10px] text-muted-foreground hover:text-foreground">← Definitions</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{latest.name}</h1>
            <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{latest.tenantId}</span>
            {latest.isSuspended && (
              <span className="rounded bg-warning/20 px-1.5 py-0.5 mono text-[9px] uppercase text-warning">suspended</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            <span className="mono">{latest.key}</span>
            <span className="mx-1.5">·</span>
            {versions.length} versions
            <span className="mx-1.5">·</span>
            {totalActive > 0 ? <span className="text-teal">{totalActive} active instances</span> : "no active instances"}
          </div>

          <h2 className="mt-6 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Version history</h2>
          <div className="mt-2 overflow-hidden rounded-md border border-border bg-panel">
            <div className="grid grid-cols-[70px_minmax(0,1.5fr)_minmax(0,1fr)_90px_90px_120px] items-center gap-3 border-b border-border bg-panel-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Version</div>
              <div>Deployment</div>
              <div>Deployed by</div>
              <div className="text-right">Active</div>
              <div className="text-right">Ended</div>
              <div className="text-right">Deployed</div>
            </div>
            {versions.map((d: ProcessDefinition, i: number) => (
              <VersionRow key={d.id} d={d} isLatest={i === 0} last={i === versions.length - 1} />
            ))}
          </div>

          {recent.length > 0 && (
            <>
              <h2 className="mt-6 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent instances</h2>
              <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {recent.map((p) => (
                  <Link
                    key={p.id}
                    to="/instances/$id"
                    params={{ id: p.id }}
                    className="flex items-center gap-2 rounded border border-border bg-panel px-3 py-1.5 text-xs transition-colors hover:border-teal/40"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        p.status === "failed" ? "bg-danger" :
                        p.status === "ended" ? "bg-success" : "bg-teal"
                      }`}
                    />
                    <span className="mono text-[11px]">{p.businessKey}</span>
                    <span className="mono text-[10px] text-muted-foreground">v{p.version}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground"><RelTime iso={p.startedAt} /></span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function VersionRow({ d, isLatest, last }: { d: ProcessDefinition; isLatest: boolean; last: boolean }) {
  const inst = instancesForDefinition(d.key, d.version);
  const active = inst.filter((p) => p.status === "active").length;
  const ended = inst.filter((p) => p.status === "ended").length;
  return (
    <Link
      to="/definitions/$key/$version"
      params={{ key: d.key, version: String(d.version) }}
      className={`grid grid-cols-[70px_minmax(0,1.5fr)_minmax(0,1fr)_90px_90px_120px] items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-panel-2 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="mono text-[11px]">v{d.version}</span>
        {isLatest && <span className="rounded bg-teal/15 px-1 py-0.5 mono text-[9px] uppercase text-teal">latest</span>}
      </div>
      <div className="truncate">
        <Link
          to="/deployments/$id"
          params={{ id: d.deploymentId }}
          className="text-foreground hover:text-teal"
          onClick={(e) => e.stopPropagation()}
        >
          {d.deploymentName}
        </Link>
      </div>
      <div className="truncate mono text-[10px] text-muted-foreground">{d.deployedBy}</div>
      <div className="text-right mono text-[11px]">
        {active > 0 ? <span className="text-teal">{active}</span> : <span className="text-muted-foreground">0</span>}
      </div>
      <div className="text-right mono text-[11px] text-muted-foreground">{ended}</div>
      <div className="text-right text-[11px] text-muted-foreground">
        <RelTime iso={d.deployedAt} />
      </div>
    </Link>
  );
}
