import { useMemo } from "react";
import type { BpmnEdge, ProcessInstance } from "@/lib/store";
import { computeAllEdgeRoutes } from "@/lib/bpmn-xml";

interface Props {
  instance: ProcessInstance;
  edge: BpmnEdge | null;
  onClose: () => void;
  onNavigateNode?: (id: string) => void;
  highlightedSegment?: { edgeId: string; index: number } | null;
  onHighlightSegment?: (seg: { edgeId: string; index: number } | null) => void;
}

export function EdgeDrawer({
  instance,
  edge,
  onClose,
  onNavigateNode,
  highlightedSegment,
  onHighlightSegment,
}: Props) {
  const route = useMemo(
    () => (edge ? computeAllEdgeRoutes(instance.edges, instance.nodes).get(edge.id) ?? null : null),
    [edge, instance.nodes, instance.edges],
  );
  if (!edge) return null;
  const src = instance.nodes.find((n) => n.id === edge.source);
  const tgt = instance.nodes.find((n) => n.id === edge.target);
  const takenLabel =
    edge.taken === true ? "Taken" : edge.taken === false ? "Rejected" : "Not evaluated";
  const takenClass =
    edge.taken === true
      ? "bg-teal/15 text-teal"
      : edge.taken === false
        ? "bg-muted text-muted-foreground"
        : "bg-warning/15 text-warning";

  const pathLength = route
    ? route.waypoints.reduce((sum, p, i, a) => {
        if (i === 0) return 0;
        const q = a[i - 1];
        return sum + Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      }, 0)
    : 0;
  const segments = route ? Math.max(0, route.waypoints.length - 1) : 0;
  const bends = route ? Math.max(0, route.waypoints.length - 2) : 0;

  return (
    <div
      className="absolute right-3 bottom-14 z-20 w-80 rounded-md border border-border bg-panel/95 shadow-xl backdrop-blur"
      role="dialog"
      aria-label="Sequence flow details"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Sequence flow
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold">
            {edge.label ?? edge.id}
          </h3>
          <div className="mt-0.5 mono text-[10px] text-muted-foreground truncate">
            id: {edge.id}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="space-y-3 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${takenClass}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {takenLabel}
          </span>
          {route ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                route.detoured ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
              }`}
              title={
                route.detoured
                  ? `Path was re-routed around ${route.obstaclesHit} obstacle segment${route.obstaclesHit === 1 ? "" : "s"}`
                  : "Direct orthogonal path — no obstacles"
              }
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {route.detoured ? "Detoured" : "Direct"}
            </span>
          ) : null}
        </div>


        <Row label="Source">
          <button
            className="mono text-teal hover:text-teal-hover text-left"
            onClick={() => onNavigateNode?.(edge.source)}
            title={src?.name ?? edge.source}
          >
            {src?.name ?? edge.source}
            <span className="ml-1 text-muted-foreground">({edge.source})</span>
          </button>
        </Row>
        <Row label="Target">
          <button
            className="mono text-teal hover:text-teal-hover text-left"
            onClick={() => onNavigateNode?.(edge.target)}
            title={tgt?.name ?? edge.target}
          >
            {tgt?.name ?? edge.target}
            <span className="ml-1 text-muted-foreground">({edge.target})</span>
          </button>
        </Row>

        {route ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Routed path
              </span>
              <span className="mono text-[10px] text-muted-foreground">
                {segments} seg · {bends} bend{bends === 1 ? "" : "s"} · {Math.round(pathLength)}px
              </span>
            </div>
            <ul
              className="max-h-40 space-y-0.5 overflow-auto scrollbar-thin rounded-md border border-border bg-panel-2 p-1 mono text-[10px] leading-relaxed"
              onMouseLeave={() => onHighlightSegment?.(null)}
            >
              {route.waypoints.slice(0, -1).map((p, i) => {
                const q = route.waypoints[i + 1];
                const isActive =
                  highlightedSegment?.edgeId === edge.id &&
                  highlightedSegment?.index === i;
                const segLen = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onMouseEnter={() => onHighlightSegment?.({ edgeId: edge.id, index: i })}
                      onFocus={() => onHighlightSegment?.({ edgeId: edge.id, index: i })}
                      onClick={() =>
                        onHighlightSegment?.(isActive ? null : { edgeId: edge.id, index: i })
                      }
                      className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
                        isActive
                          ? "bg-teal/20 text-teal ring-1 ring-teal/50"
                          : "text-foreground hover:bg-muted"
                      }`}
                      title={`Segment ${i + 1}: (${Math.round(p.x)}, ${Math.round(p.y)}) → (${Math.round(q.x)}, ${Math.round(q.y)})`}
                    >
                      <span>
                        <span className="text-muted-foreground">{String(i + 1).padStart(2, " ")}.</span>{" "}
                        ({Math.round(p.x)}, {Math.round(p.y)}) → ({Math.round(q.x)}, {Math.round(q.y)})
                      </span>
                      <span className="shrink-0 text-muted-foreground">{Math.round(segLen)}px</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {route.detoured ? (
              <div className="mt-1 text-[10px] text-warning">
                Path was re-routed to avoid {route.obstaclesHit || route.waypoints.length - route.baseWaypoints.length} obstacle crossing{route.obstaclesHit === 1 ? "" : "s"}.
              </div>
            ) : (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Direct orthogonal path — no obstacles required avoidance.
              </div>
            )}
          </div>
        ) : null}



        {edge.condition ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Condition
            </div>
            <pre className="max-h-40 overflow-auto scrollbar-thin rounded-md border border-border bg-panel-2 p-2 mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
{edge.condition}
            </pre>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-panel-2/50 p-2 text-[11px] text-muted-foreground">
            No condition — unconditional flow.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-right truncate">{children}</span>
    </div>
  );
}
