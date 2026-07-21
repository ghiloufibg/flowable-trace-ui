import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RelTime } from "@/components/rel-time";
import { BpmnXmlDiagram } from "@/components/bpmn-xml-diagram";
import { processInstanceToBpmnXml } from "@/lib/bpmn-xml";
import type { ProcessInstance } from "@/lib/store";
import {
  ensureDefinition,
  ensureTemplateInstance,
  instancesForDefinition,
  type ProcessDefinition,
} from "@/lib/store";

export const Route = createFileRoute("/definitions/$key/$version")({
  loader: async ({ params }) => {
    const version = Number(params.version);
    if (!Number.isFinite(version)) throw notFound();
    const def = await ensureDefinition(params.key, version);
    if (!def) throw notFound();
    const template = await ensureTemplateInstance(params.key, version);
    return { def, template };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Definition not found · Flowable Console" }, { name: "robots", content: "noindex" }] };
    }
    const { def } = loaderData;
    return {
      meta: [
        { title: `${def.name} v${def.version} · Definitions · Flowable Console` },
        { name: "description", content: `Diagram, instances and XML for ${def.name} v${def.version}.` },
        { property: "og:title", content: `${def.name} v${def.version}` },
        { property: "og:description", content: `Diagram, instances and XML for ${def.name} v${def.version}.` },
      ],
    };
  },
  notFoundComponent: () => (
    <AppShell>
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <div className="mono text-[11px] uppercase tracking-wider text-muted-foreground">Not found</div>
          <div className="mt-1 text-lg font-semibold">Unknown definition version</div>
          <Link to="/definitions" className="mt-3 inline-block text-xs text-teal hover:underline">← Back to definitions</Link>
        </div>
      </div>
    </AppShell>
  ),
  component: DefinitionDetailPage,
});

type Tab = "overview" | "instances" | "xml";

function DefinitionDetailPage() {
  const { def, template } = Route.useLoaderData();
  const [tab, setTab] = useState<Tab>("overview");
  const instances = instancesForDefinition(def.key, def.version);
  const active = instances.filter((p) => p.status === "active").length;

  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 border-b border-border bg-panel px-5 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Link to="/definitions" className="hover:text-foreground">Definitions</Link>
                  <span>/</span>
                  <Link to="/definitions/$key" params={{ key: def.key }} className="hover:text-foreground mono">{def.key}</Link>
                  <span>/</span>
                  <span className="mono">v{def.version}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-base font-semibold tracking-tight">{def.name}</h1>
                  <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 mono text-[10px] text-muted-foreground">v{def.version}</span>
                  <span className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{def.tenantId}</span>
                  {def.isSuspended && (
                    <span className="rounded bg-warning/20 px-1.5 py-0.5 mono text-[9px] uppercase text-warning">suspended</span>
                  )}
                  {active > 0 && <span className="mono text-[11px] text-teal">{active} active</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <HeaderBtn onClick={() => navigator.clipboard?.writeText(def.key)}>Copy key</HeaderBtn>
                <HeaderBtn onClick={() => alert("Download would export the BPMN resource")}>Download</HeaderBtn>
                <HeaderBtn primary onClick={() => alert("Start instance dialog — coming next")}>Start instance</HeaderBtn>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* Diagram */}
            <div className="flex min-w-0 flex-1 flex-col border-r border-border bg-background">
              {template ? (
                <BpmnXmlDiagram
                  instance={template}
                  selectedNodeId={null}
                  onSelectNode={() => {}}
                />
              ) : (
                <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
                  No diagram available — no instances have been started against this version.
                </div>
              )}
            </div>

            {/* Right pane */}
            <aside className="flex w-[380px] shrink-0 flex-col bg-panel">
              <div className="flex shrink-0 gap-1 border-b border-border px-2 text-xs">
                {(["overview", "instances", "xml"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-2.5 py-2 capitalize transition-colors ${
                      tab === t ? "border-teal text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
                {tab === "overview" && <OverviewTab def={def} />}
                {tab === "instances" && <InstancesTab instances={instances} />}
                {tab === "xml" && <XmlTab template={template} />}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function HeaderBtn({
  children, onClick, primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  const cls = primary
    ? "bg-teal text-teal-foreground hover:opacity-90 border-transparent"
    : "border-border text-foreground hover:bg-panel-2";
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function OverviewTab({ def }: { def: ProcessDefinition }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["ID", <span className="mono text-[11px]">{def.id}</span>],
    ["Key", <span className="mono text-[11px]">{def.key}</span>],
    ["Version", <span className="mono text-[11px]">v{def.version}</span>],
    ["Name", def.name],
    ["Tenant", def.tenantId],
    ["Category", def.category ?? "—"],
    ["Resource", <span className="mono text-[11px]">{def.resource}</span>],
    ["Executable", def.isExecutable ? "Yes" : "No"],
    ["Has start form", def.hasStartForm ? "Yes" : "No"],
    ["Suspended", def.isSuspended ? "Yes" : "No"],
    ["Deployment", (
      <Link to="/deployments/$id" params={{ id: def.deploymentId }} className="mono text-[11px] text-teal hover:underline">
        {def.deploymentName}
      </Link>
    )],
    ["Deployed by", <span className="mono text-[11px]">{def.deployedBy}</span>],
    ["Deployed", <RelTime iso={def.deployedAt} />],
  ];
  return (
    <dl className="divide-y divide-border">
      {rows.map(([label, value], i) => (
        <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 px-3 py-2 text-xs">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InstancesTab({ instances }: { instances: ProcessInstance[] }) {
  if (instances.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        No instances have been started against this version yet.
      </div>
    );
  }
  return (
    <div>
      {instances.map((p) => (
        <Link
          key={p.id}
          to="/instances/$id"
          params={{ id: p.id }}
          className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs transition-colors hover:bg-panel-2"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              p.status === "failed" ? "bg-danger" :
              p.status === "ended" ? "bg-success" : "bg-teal"
            } ${p.status === "active" ? "animate-pulse" : ""}`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate mono text-[11px]">{p.businessKey}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {p.status} · <RelTime iso={p.startedAt} />
            </div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      ))}
    </div>
  );
}

function XmlTab({ template }: { template: ProcessInstance | undefined }) {
  if (!template) {
    return <div className="p-6 text-center text-xs text-muted-foreground">No BPMN XML available.</div>;
  }
  const xml = processInstanceToBpmnXml(template);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="mono text-[10px] text-muted-foreground">bpmn20.xml</span>
        <button
          onClick={() => navigator.clipboard?.writeText(xml)}
          className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-panel-2"
        >
          Copy
        </button>
      </div>
      <pre className="overflow-auto scrollbar-thin p-3 mono text-[10.5px] leading-relaxed text-foreground/90">
        {xml}
      </pre>
    </div>
  );
}
