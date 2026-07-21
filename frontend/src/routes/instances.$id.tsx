import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BpmnXmlDiagram } from "@/components/bpmn-xml-diagram";
import { BpmnXmlLoader } from "@/components/bpmn-xml-loader";
import { PinnedInspector } from "@/components/pinned-inspector";
import { EdgeDrawer } from "@/components/edge-drawer";
import { ReplayControl } from "@/components/replay-control";
import { RelTime } from "@/components/rel-time";
import { InstanceTabs, type TabKey } from "@/components/instance-tabs";
import {
  ensureInstance,
  failedJobCount,
  getInstance,
  relativeTime,
  type ProcessInstance,
} from "@/lib/store";

export const Route = createFileRoute("/instances/$id")({
  loader: async ({ params }) => {
    const instance = await ensureInstance(params.id);
    if (!instance) throw notFound();
    return { instance };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Instance not found · Flowable Console" }, { name: "robots", content: "noindex" }] };
    const i = loaderData.instance;
    return {
      meta: [
        { title: `${i.definitionName} · ${i.businessKey} · Flowable Console` },
        { name: "description", content: `Live debug view of ${i.definitionName} instance ${i.id} (${i.status}).` },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: InstanceDetail,
  notFoundComponent: () => (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-lg font-semibold">Instance not found</h1>
        <Link to="/" className="mt-2 inline-block text-xs text-teal">← Back to overview</Link>
      </div>
    </div>
  ),
});

function InstanceDetail() {
  const { instance } = Route.useLoaderData() as { instance: ProcessInstance };
  

  const [pinned, setPinned] = useState<string[]>([]);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [highlightedSegment, setHighlightedSegment] = useState<{ edgeId: string; index: number } | null>(null);
  const [tab, setTab] = useState<TabKey>("variables");
  const [copied, setCopied] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [xmlOverride, setXmlOverride] = useState<string | null>(null);
  const [xmlFilename, setXmlFilename] = useState<string | undefined>(undefined);
  const [loaderOpen, setLoaderOpen] = useState(false);
  const replayRef = useRef<number | null>(null);
  const diagramContainerRef = useRef<HTMLDivElement | null>(null);

  const failed = failedJobCount(instance);
  const parent = instance.parentInstanceId ? getInstance(instance.parentInstanceId) : undefined;

  // Reset per-instance state
  useEffect(() => {
    setPinned([]);
    setActivePin(null);
    setSelectedEdgeId(null);
    setHighlightedSegment(null);
    setTab("variables");
    setXmlOverride(null);
    setXmlFilename(undefined);
  }, [instance.id]);

  // Auto-pin failed/active node on first load so users see something useful
  useEffect(() => {
    if (pinned.length > 0) return;
    const focus =
      instance.nodes.find((n) => n.state === "failed") ??
      instance.nodes.find((n) => n.state === "active");
    if (focus) {
      setPinned([focus.id]);
      setActivePin(focus.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "1") setTab("variables");
      else if (e.key === "2") setTab("tasks");
      else if (e.key === "3") setTab("trail");
      else if (e.key === "4") setTab("jobs");
      else if (e.key === "\\") setDrawerOpen((d) => !d);
      else if (e.key === "Escape") {
        if (highlightedSegment) {
          setHighlightedSegment(null);
        } else if (selectedEdgeId) {
          setSelectedEdgeId(null);
        } else if (activePin) {
          setPinned((p) => p.filter((id) => id !== activePin));
          setActivePin((cur) => {
            const rest = pinned.filter((id) => id !== cur);
            return rest[rest.length - 1] ?? null;
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePin, pinned, selectedEdgeId, highlightedSegment]);

  // Replay loop
  useEffect(() => {
    if (!replaying) {
      if (replayRef.current) cancelAnimationFrame(replayRef.current);
      return;
    }
    let last: number | null = null;
    const DURATION = 4000;
    const tick = (t: number) => {
      if (last == null) last = t;
      const dt = t - last;
      last = t;
      setReplayProgress((prev) => {
        const next = Math.min(1, prev + (dt / DURATION) * replaySpeed);
        if (next >= 1) setReplaying(false);
        return next;
      });
      replayRef.current = requestAnimationFrame(tick);
    };
    replayRef.current = requestAnimationFrame(tick);
    return () => { if (replayRef.current) cancelAnimationFrame(replayRef.current); };
  }, [replaying, replaySpeed]);

  const handleSelectNode = (id: string | null) => {
    if (!id) return;
    setSelectedEdgeId(null);
    setPinned((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setActivePin(id);
    const n = instance.nodes.find((x) => x.id === id);
    if (!n) return;
    if (n.type === "userTask" || n.multiInstance) setTab("tasks");
    else if (n.state === "failed" || n.type === "boundaryTimer") setTab("jobs");
    else setTab("trail");
    if (!drawerOpen) setDrawerOpen(true);
  };

  const selectedEdge = useMemo(
    () => instance.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [instance.edges, selectedEdgeId],
  );

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const jumpToFailedJob = () => {
    const failedNode = instance.nodes.find((n) => n.state === "failed");
    if (failedNode) {
      handleSelectNode(failedNode.id);
      setTab("jobs");
    }
  };

  const testAssertion = useMemo(() => {
    const active = instance.nodes.filter((n) => n.state === "active" || n.state === "failed").map((n) => n.id);
    const vars = instance.variables.map((v) => `        .variable("${v.name}", ${JSON.stringify(v.value)})`).join("\n");
    return `assertThat(processInstance)
    .isStarted()
    .hasBusinessKey("${instance.businessKey}")
    .hasActiveActivities(${active.map((a) => `"${a}"`).join(", ")})
    .hasVariables()
${vars};`;
  }, [instance]);

  const diagnostics = useMemo(() => [
    `Flowable Console diagnostics`,
    `--------------------------------`,
    `Process:     ${instance.definitionName} @v${instance.version}`,
    `Instance:    ${instance.id}`,
    `Business:    ${instance.businessKey}`,
    `Status:      ${instance.status.toUpperCase()}`,
    `Started:     ${new Date(instance.startedAt).toISOString()}  (${relativeTime(instance.startedAt)})`,
    `Started by:  ${instance.startedBy}`,
    ``,
    `Active nodes:`,
    ...instance.nodes.filter((n) => n.state === "active" || n.state === "failed")
      .map((n) => `  - ${n.id} (${n.type}) [${n.state.toUpperCase()}]`),
    ``,
    `Variables:`,
    ...instance.variables.map((v) => `  ${v.name} = ${v.value}  (${v.type}, rev ${v.history.length})`),
    ``,
    `Failed jobs (${failed}):`,
    ...instance.jobs.filter((j) => j.type === "deadletter").map((j) => `  ${j.id} on ${j.activityId}: ${j.exception}`),
  ].join("\n"), [instance, failed]);

  const filterActivityId = activePin;

  return (
    <AppShell
      headerRight={
        failed > 0 ? (
          <button
            onClick={jumpToFailedJob}
            className="inline-flex items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 text-[11px] font-semibold text-danger hover:bg-danger/30"
            title="Jump to failed job"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
            {failed} failed job{failed > 1 ? "s" : ""}
          </button>
        ) : undefined
      }
    >
      {/* Sub-header (instance context) */}
      <div className="border-b border-border bg-panel">
        <div className="flex items-start justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0">
            <nav className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Link to="/" className="hover:text-foreground">Overview</Link>
              {parent && (
                <>
                  <span>›</span>
                  <Link to="/instances/$id" params={{ id: parent.id }} className="mono hover:text-foreground">
                    {parent.definitionName} · {parent.businessKey}
                  </Link>
                </>
              )}
              <span>›</span>
              <span className="mono text-foreground">{instance.businessKey}</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-sm font-semibold tracking-tight">
                {instance.definitionName} <span className="mono text-xs font-normal text-muted-foreground">v{instance.version}</span>
              </h1>
              <StatusPill status={instance.status} />
              <button
                onClick={() => copy("id", instance.id)}
                className="group inline-flex items-center gap-1.5 rounded border border-border bg-panel-2 px-2 py-0.5 mono text-[10px] text-muted-foreground hover:text-foreground"
                title="Copy instance ID"
              >
                {instance.id}
                <span className="text-[9px] text-muted-foreground group-hover:text-teal">
                  {copied === "id" ? "✓" : "⧉"}
                </span>
              </button>
              <span className="text-[10px] text-muted-foreground">
                started <RelTime iso={instance.startedAt} className="text-foreground" /> by <span className="mono text-foreground">{instance.startedBy}</span>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ActionButton onClick={() => copy("assert", testAssertion)}>
              {copied === "assert" ? "✓ Copied" : "Copy assertion"}
            </ActionButton>
            <ActionButton onClick={() => copy("diag", diagnostics)}>
              {copied === "diag" ? "✓ Copied" : "Copy diagnostics"}
            </ActionButton>
          </div>
        </div>
      </div>

      {/* Main body: diagram fills, pinned inspector column, collapsible bottom drawer */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Diagram (fills) */}
          <div ref={diagramContainerRef} className="relative min-h-0 flex-1">
            <BpmnXmlDiagram
              instance={instance}
              xmlOverride={xmlOverride}
              selectedNodeId={activePin}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={handleSelectNode}
              onSelectEdge={(id) => { setHighlightedSegment(null); setSelectedEdgeId(id); }}
              replaying={replaying}
              replayProgress={replayProgress}
              highlightedSegment={highlightedSegment}
            />
            <EdgeDrawer
              instance={instance}
              edge={selectedEdge}
              onClose={() => { setHighlightedSegment(null); setSelectedEdgeId(null); }}
              onNavigateNode={(id) => { setHighlightedSegment(null); setSelectedEdgeId(null); handleSelectNode(id); }}
              highlightedSegment={highlightedSegment}
              onHighlightSegment={setHighlightedSegment}
            />
            {/* XML source control */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md border border-border bg-panel/90 px-2 py-1 backdrop-blur">
              <span className="text-[10px] text-muted-foreground">BPMN source:</span>
              <span className="mono text-[10px] text-foreground">
                {xmlOverride ? (xmlFilename ?? "custom") : "generated"}
              </span>
              <button
                onClick={() => setLoaderOpen(true)}
                className="rounded border border-border bg-panel-2 px-2 py-0.5 text-[10px] hover:border-teal hover:text-teal"
              >
                Load XML…
              </button>
            </div>

            {/* Replay control (draggable) */}
            <ReplayControl
              containerRef={diagramContainerRef}
              replaying={replaying}
              progress={replayProgress}
              speed={replaySpeed}
              onToggle={() => {
                if (replayProgress >= 1) setReplayProgress(0);
                setReplaying((r) => !r);
              }}
              onProgressChange={(p) => { setReplaying(false); setReplayProgress(p); }}
              onSpeedChange={setReplaySpeed}
              onReset={() => { setReplayProgress(0); setReplaying(false); }}
            />

            {/* Bottom drawer toggle */}
            <button
              onClick={() => setDrawerOpen((d) => !d)}
              className="absolute bottom-3 right-3 z-10 rounded-md border border-border bg-panel/90 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur hover:text-foreground"
              title="Toggle data drawer (\\)"
            >
              {drawerOpen ? "▾ Hide data" : "▴ Show data"}
            </button>
          </div>

          {/* Collapsible bottom drawer */}
          {drawerOpen && (
            <div className="min-h-0 border-t border-border" style={{ height: 320 }}>
              <InstanceTabs
                instance={instance}
                active={tab}
                onChange={setTab}
                filterActivityId={filterActivityId}
              />
            </div>
          )}
        </div>

        {/* Pinned inspector column */}
        <PinnedInspector
          instance={instance}
          pinnedIds={pinned}
          activeId={activePin}
          onSelect={setActivePin}
          onUnpin={(id) => {
            setPinned((p) => p.filter((x) => x !== id));
            setActivePin((cur) => {
              if (cur !== id) return cur;
              const rest = pinned.filter((x) => x !== id);
              return rest[rest.length - 1] ?? null;
            });
          }}
          onCloseAll={() => { setPinned([]); setActivePin(null); }}
        />
      </div>

      <BpmnXmlLoader
        open={loaderOpen}
        onClose={() => setLoaderOpen(false)}
        onLoad={(xml, filename) => { setXmlOverride(xml); setXmlFilename(filename); }}
        onReset={() => { setXmlOverride(null); setXmlFilename(undefined); }}
        currentSource={xmlOverride ? "custom" : "generated"}
        currentFilename={xmlFilename}
      />
    </AppShell>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-border bg-panel-2 px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-teal hover:text-teal"
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: "active" | "ended" | "failed" }) {
  const map = {
    active: { bg: "bg-teal/15", fg: "text-teal", label: "Active" },
    ended:  { bg: "bg-success/15", fg: "text-success", label: "Ended" },
    failed: { bg: "bg-danger/15", fg: "text-danger", label: "Failed" },
  } as const;
  const c = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.bg} ${c.fg}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}
