import { useEffect, useMemo, useRef, useState } from "react";
import type { BpmnEdge, BpmnNode, ProcessInstance, TrailEntry } from "@/lib/store";

interface Props {
  instance: ProcessInstance;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  replaying?: boolean;
  replayProgress?: number; // 0..1
}

const NODE_W = 120;
const NODE_H = 70;
const EVENT_R = 20;
const GATE_S = 44;

function nodeBox(n: BpmnNode) {
  if (n.type === "startEvent" || n.type === "endEvent") {
    return { cx: n.x + EVENT_R, cy: n.y + EVENT_R, w: EVENT_R * 2, h: EVENT_R * 2, isEvent: true, isGateway: false };
  }
  if (n.type === "boundaryTimer") {
    return { cx: n.x + EVENT_R, cy: n.y + EVENT_R, w: EVENT_R * 2, h: EVENT_R * 2, isEvent: true, isGateway: false };
  }
  if (n.type === "exclusiveGateway" || n.type === "parallelGateway") {
    return { cx: n.x + GATE_S / 2, cy: n.y + GATE_S / 2, w: GATE_S, h: GATE_S, isEvent: false, isGateway: true };
  }
  return { cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2, w: NODE_W, h: NODE_H, isEvent: false, isGateway: false };
}

function stateStroke(state: BpmnNode["state"]) {
  switch (state) {
    case "active":    return "var(--teal)";
    case "completed": return "var(--success)";
    case "failed":    return "var(--danger)";
    case "waiting":   return "var(--warning)";
    default:          return "var(--border)";
  }
}
function stateFill(state: BpmnNode["state"]) {
  switch (state) {
    case "active":    return "color-mix(in oklch, var(--teal) 18%, var(--panel))";
    case "completed": return "color-mix(in oklch, var(--success) 12%, var(--panel))";
    case "failed":    return "color-mix(in oklch, var(--danger) 15%, var(--panel))";
    case "waiting":   return "color-mix(in oklch, var(--warning) 15%, var(--panel))";
    default:          return "var(--panel-2)";
  }
}

/** Compute edge endpoints on node borders + optional waypoints */
function edgePath(edge: BpmnEdge, nodes: Map<string, BpmnNode>): string {
  const s = nodes.get(edge.source);
  const t = nodes.get(edge.target);
  if (!s || !t) return "";
  const sb = nodeBox(s);
  const tb = nodeBox(t);

  const pts: Array<{ x: number; y: number }> = [];
  if (edge.waypoints && edge.waypoints.length) {
    // start from source center → first waypoint direction
    pts.push({ x: sb.cx, y: sb.cy });
    pts.push(...edge.waypoints);
    pts.push({ x: tb.cx, y: tb.cy });
  } else {
    pts.push({ x: sb.cx, y: sb.cy });
    pts.push({ x: tb.cx, y: tb.cy });
  }

  // Trim first segment to source border, last segment to target border
  pts[0] = borderPoint(s, pts[1]);
  pts[pts.length - 1] = borderPoint(t, pts[pts.length - 2]);

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d;
}

function borderPoint(n: BpmnNode, from: { x: number; y: number }) {
  const b = nodeBox(n);
  const dx = from.x - b.cx;
  const dy = from.y - b.cy;
  if (b.isEvent) {
    const len = Math.hypot(dx, dy) || 1;
    const r = b.w / 2;
    return { x: b.cx + (dx / len) * r, y: b.cy + (dy / len) * r };
  }
  if (b.isGateway) {
    // diamond: |x/hw| + |y/hh| = 1
    const hw = b.w / 2, hh = b.h / 2;
    const denom = Math.abs(dx) / hw + Math.abs(dy) / hh || 1;
    return { x: b.cx + dx / denom, y: b.cy + dy / denom };
  }
  // rectangle
  const hw = b.w / 2, hh = b.h / 2;
  const scale = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh) || 1;
  return { x: b.cx + dx / scale, y: b.cy + dy / scale };
}

/** get midpoint of an edge path for labels */
function edgeMid(edge: BpmnEdge, nodes: Map<string, BpmnNode>) {
  const s = nodes.get(edge.source);
  const t = nodes.get(edge.target);
  if (!s || !t) return { x: 0, y: 0 };
  const sb = nodeBox(s), tb = nodeBox(t);
  if (edge.waypoints && edge.waypoints.length) {
    const mid = edge.waypoints[Math.floor(edge.waypoints.length / 2)];
    return { x: mid.x, y: mid.y - 6 };
  }
  return { x: (sb.cx + tb.cx) / 2, y: (sb.cy + tb.cy) / 2 - 6 };
}

/** Build ordered replay path from trail */
function replayPath(instance: ProcessInstance): TrailEntry[] {
  return [...instance.trail].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
}

export function BpmnDiagram({ instance, selectedNodeId, onSelectNode, replaying, replayProgress = 0 }: Props) {
  const nodeMap = useMemo(() => new Map(instance.nodes.map((n) => [n.id, n])), [instance]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // canvas bounds
  const bounds = useMemo(() => {
    let maxX = 0, maxY = 0;
    for (const n of instance.nodes) {
      const b = nodeBox(n);
      maxX = Math.max(maxX, n.x + b.w);
      maxY = Math.max(maxY, n.y + b.h);
    }
    return { w: Math.max(maxX + 60, 900), h: Math.max(maxY + 60, 400) };
  }, [instance]);

  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => Math.min(2.5, Math.max(0.4, z + delta)));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.px + (e.clientX - dragRef.current.x),
      y: dragRef.current.py + (e.clientY - dragRef.current.y),
    });
  };
  const onMouseUp = () => { dragRef.current = null; };

  // Replay token position
  const replayToken = useMemo(() => {
    if (!replaying) return null;
    const path = replayPath(instance);
    if (path.length === 0) return null;
    const t = Math.max(0, Math.min(1, replayProgress));
    const idx = Math.min(path.length - 1, Math.floor(t * path.length));
    const seg = t * path.length - idx;
    const cur = nodeMap.get(path[idx].activityId);
    const next = nodeMap.get(path[Math.min(path.length - 1, idx + 1)].activityId);
    if (!cur) return null;
    const cb = nodeBox(cur);
    if (!next || next === cur) return { x: cb.cx, y: cb.cy, name: cur.name };
    const nb = nodeBox(next);
    return {
      x: cb.cx + (nb.cx - cb.cx) * seg,
      y: cb.cy + (nb.cy - cb.cy) * seg,
      name: seg < 0.5 ? cur.name : next.name,
    };
  }, [replaying, replayProgress, instance, nodeMap]);

  return (
    <div className="relative h-full w-full overflow-hidden grid-bg rounded-md border border-border">
      {/* Controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-panel/90 p-1 text-xs backdrop-blur">
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}>+</button>
        <span className="px-1 mono text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>−</button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={fit}>Fit</button>
      </div>

      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
          <marker id="arrow-taken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--teal)" />
          </marker>
          <marker id="arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" opacity="0.4" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {instance.edges.map((e) => {
            const d = edgePath(e, nodeMap);
            const isTaken = e.taken === true;
            const isRejected = e.taken === false;
            const stroke = isTaken ? "var(--teal)" : isRejected ? "var(--muted-foreground)" : "var(--muted-foreground)";
            const marker = isTaken ? "url(#arrow-taken)" : isRejected ? "url(#arrow-muted)" : "url(#arrow)";
            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isTaken ? 2.5 : 1.5}
                  strokeDasharray={isRejected ? "6 4" : undefined}
                  opacity={isRejected ? 0.55 : 1}
                  markerEnd={marker}
                />
                {e.label && (() => {
                  const m = edgeMid(e, nodeMap);
                  return (
                    <g transform={`translate(${m.x} ${m.y})`}>
                      <rect x={-18} y={-11} width={36} height={16} rx={3}
                        fill="var(--panel)" stroke={isTaken ? "var(--teal)" : "var(--border)"} strokeWidth={1} />
                      <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
                        fontSize={10}
                        fill={isTaken ? "var(--teal)" : "var(--muted-foreground)"}
                        style={{ fontFamily: "var(--font-mono)" }}>
                        {e.label}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Nodes */}
          {instance.nodes.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              selected={selectedNodeId === n.id}
              hovered={hoverId === n.id}
              onSelect={() => onSelectNode(n.id)}
              onHover={setHoverId}
            />
          ))}

          {/* Replay token */}
          {replayToken && (
            <g>
              <circle cx={replayToken.x} cy={replayToken.y} r={9} fill="var(--teal)" opacity={0.9} />
              <circle cx={replayToken.x} cy={replayToken.y} r={16} fill="none" stroke="var(--teal)" opacity={0.5}>
                <animate attributeName="r" values="10;20;10" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.2s" repeatCount="indefinite" />
              </circle>
            </g>
          )}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hoverId && (() => {
        const n = nodeMap.get(hoverId);
        if (!n) return null;
        const b = nodeBox(n);
        const left = (b.cx * zoom + pan.x);
        const top  = ((n.y) * zoom + pan.y) - 8;
        return (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-panel px-2 py-1 text-xs shadow-lg"
            style={{ left, top }}
          >
            <div className="font-medium">{n.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {n.type} · {n.state}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function NodeShape({
  node, selected, hovered, onSelect, onHover,
}: {
  node: BpmnNode; selected: boolean; hovered: boolean;
  onSelect: () => void; onHover: (id: string | null) => void;
}) {
  const stroke = stateStroke(node.state);
  const fill = stateFill(node.state);
  const isDim = node.state === "pending";
  const cursor = "cursor-pointer";
  const strokeW = selected ? 3 : node.state === "active" ? 2.5 : 1.5;

  const common = {
    "data-node": node.id,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(); },
    onMouseEnter: () => onHover(node.id),
    onMouseLeave: () => onHover(null),
    className: `${cursor} ${node.state === "active" ? "bpmn-pulse" : ""} transition-opacity`,
    style: { opacity: isDim ? 0.55 : 1 },
  };

  if (node.type === "startEvent" || node.type === "endEvent") {
    const cx = node.x + EVENT_R, cy = node.y + EVENT_R;
    return (
      <g {...common}>
        <circle cx={cx} cy={cy} r={EVENT_R} fill={fill} stroke={stroke} strokeWidth={node.type === "endEvent" ? 3.5 : strokeW} />
        <text x={cx} y={cy + EVENT_R + 14} textAnchor="middle" fontSize={11} fill="var(--foreground)">
          {node.name}
        </text>
        {selected && <SelectionRing cx={cx} cy={cy} r={EVENT_R + 6} />}
      </g>
    );
  }

  if (node.type === "boundaryTimer") {
    const cx = node.x + EVENT_R, cy = node.y + EVENT_R;
    return (
      <g {...common}>
        <circle cx={cx} cy={cy} r={EVENT_R} fill={fill} stroke={stroke} strokeWidth={strokeW} />
        <circle cx={cx} cy={cy} r={EVENT_R - 4} fill="none" stroke={stroke} strokeWidth={1} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} style={{ fontFamily: "var(--font-mono)" }} fill={stroke}>⏱</text>
        <text x={cx} y={cy + EVENT_R + 14} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
          {node.name}
        </text>
      </g>
    );
  }

  if (node.type === "exclusiveGateway" || node.type === "parallelGateway") {
    const cx = node.x + GATE_S / 2, cy = node.y + GATE_S / 2;
    const half = GATE_S / 2;
    const points = `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`;
    const glyph = node.type === "exclusiveGateway" ? "×" : "+";
    return (
      <g {...common}>
        <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeW} />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={16} fill={stroke} style={{ fontWeight: 600 }}>
          {glyph}
        </text>
        <text x={cx} y={cy + half + 14} textAnchor="middle" fontSize={11} fill="var(--foreground)">
          {node.name}
        </text>
        {selected && <SelectionRing cx={cx} cy={cy} r={half + 8} />}
      </g>
    );
  }

  // rectangle-based (tasks, call activity)
  const cx = node.x + NODE_W / 2, cy = node.y + NODE_H / 2;
  const isCall = node.type === "callActivity";
  return (
    <g {...common}>
      <rect
        x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={8}
        fill={fill} stroke={stroke} strokeWidth={isCall ? 3 : strokeW}
      />
      {/* type glyph badge top-left */}
      <g transform={`translate(${node.x + 8} ${node.y + 8})`}>
        <rect width={18} height={18} rx={3} fill="var(--panel-2)" stroke="var(--border)" />
        <text x={9} y={13} textAnchor="middle" fontSize={11}
          style={{ fontFamily: "var(--font-mono)" }} fill="var(--muted-foreground)">
          {node.type === "userTask" ? "👤" : node.type === "serviceTask" ? "⚙" : node.type === "callActivity" ? "▤" : node.type === "scriptTask" ? "≣" : "•"}
        </text>
      </g>
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill="var(--foreground)">
        {node.name.length > 22 ? node.name.slice(0, 21) + "…" : node.name}
      </text>

      {/* state corner badges */}
      {node.state === "completed" && (
        <g transform={`translate(${node.x + NODE_W - 18} ${node.y + 4})`}>
          <circle cx={7} cy={7} r={7} fill="var(--success)" />
          <text x={7} y={11} textAnchor="middle" fontSize={10} fill="#0a1a12" style={{ fontWeight: 700 }}>✓</text>
        </g>
      )}
      {node.state === "failed" && (
        <g transform={`translate(${node.x + NODE_W - 18} ${node.y + 4})`}>
          <circle cx={7} cy={7} r={7} fill="var(--danger)" />
          <text x={7} y={11} textAnchor="middle" fontSize={10} fill="#1a0a0e" style={{ fontWeight: 700 }}>!</text>
        </g>
      )}
      {node.state === "waiting" && (
        <g transform={`translate(${node.x + NODE_W - 18} ${node.y + 4})`}>
          <circle cx={7} cy={7} r={7} fill="var(--warning)" />
          <text x={7} y={11} textAnchor="middle" fontSize={9} fill="#1a1408" style={{ fontWeight: 700 }}>⏱</text>
        </g>
      )}

      {/* multi-instance badge */}
      {node.multiInstance && (
        <g transform={`translate(${node.x + NODE_W - 42} ${node.y + NODE_H - 18})`}>
          <rect width={38} height={14} rx={3} fill="var(--info-bg)" stroke="var(--info)" />
          <text x={19} y={11} textAnchor="middle" fontSize={9}
            fill="var(--info)" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {node.multiInstance.completed}/{node.multiInstance.total}
          </text>
        </g>
      )}

      {isCall && (
        <text x={cx} y={node.y + NODE_H - 6} textAnchor="middle" fontSize={9}
          fill="var(--muted-foreground)" style={{ fontFamily: "var(--font-mono)" }}>
          ▽ sub-process
        </text>
      )}

      {selected && <SelectionRingRect x={node.x - 4} y={node.y - 4} w={NODE_W + 8} h={NODE_H + 8} />}
    </g>
  );
}

function SelectionRing({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--teal)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />;
}
function SelectionRingRect({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke="var(--teal)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />;
}
