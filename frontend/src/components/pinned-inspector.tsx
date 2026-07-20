import { useCallback, useEffect, useRef, useState } from "react";
import { NodeDrawer } from "@/components/node-drawer";
import type { BpmnNode, ProcessInstance } from "@/lib/store";

interface Props {
  instance: ProcessInstance;
  pinnedIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUnpin: (id: string) => void;
  onCloseAll: () => void;
}

const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 384; // matches original w-96
const STORAGE_KEY = "pinned-inspector:width";
const COLLAPSED_KEY = "pinned-inspector:collapsed";

// Preset snap points (magnetic) plus a 16px grid fallback.
const SNAP_POINTS = [280, 320, 384, 448, 512, 576, 640, 704];
const SNAP_THRESHOLD = 10; // px of magnetism around a preset
const GRID = 16;

function snapWidth(w: number): { width: number; snapped: boolean } {
  for (const p of SNAP_POINTS) {
    if (Math.abs(w - p) <= SNAP_THRESHOLD) return { width: p, snapped: true };
  }
  return { width: Math.round(w / GRID) * GRID, snapped: false };
}

/**
 * Right-side column of pinned node inspectors. Clicking a node in the
 * diagram adds it here (up to N). Multiple can be compared side-by-side,
 * each collapsible via its own header. Empty state shows a hint.
 *
 * The panel can be hidden (collapsed to a slim rail) and resized by
 * dragging its left edge. Width and collapsed state persist in
 * localStorage so the user's layout choice sticks across reloads.
 */
export function PinnedInspector({
  instance, pinnedIds, activeId, onSelect, onUnpin, onCloseAll,
}: Props) {
  const nodes = pinnedIds
    .map((id) => instance.nodes.find((n) => n.id === id))
    .filter(Boolean) as BpmnNode[];

  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [snapPulse, setSnapPulse] = useState<number>(0);
  const lastSnappedRef = useRef<number | null>(null);
  const asideRef = useRef<HTMLDivElement | null>(null);

  // Hydrate persisted layout after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      const w = localStorage.getItem(STORAGE_KEY);
      if (w) {
        const n = parseInt(w, 10);
        if (!isNaN(n)) setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)));
      }
      const c = localStorage.getItem(COLLAPSED_KEY);
      if (c === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastSnappedRef.current = null;
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      // Panel is right-anchored; width = viewport right edge minus mouse X.
      const raw = window.innerWidth - e.clientX;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
      const { width: snapped, snapped: isSnap } = snapWidth(clamped);
      // Emit a subtle pulse only when we newly land on a preset snap point.
      if (isSnap && lastSnappedRef.current !== snapped) {
        lastSnappedRef.current = snapped;
        setSnapPulse((n) => n + 1);
      } else if (!isSnap) {
        lastSnappedRef.current = null;
      }
      setWidth(snapped);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);


  if (collapsed) {
    return (
      <aside className="flex h-full w-8 shrink-0 flex-col items-center border-l border-border bg-panel">
        <button
          onClick={() => setCollapsed(false)}
          title="Show pinned inspectors"
          className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          ‹
        </button>
        <div
          className="mt-2 select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          Pinned{nodes.length ? ` · ${nodes.length}` : ""}
        </div>
      </aside>
    );
  }

  const resizer = (
    <div
      onMouseDown={onDragStart}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      title="Drag to resize · double-click to reset"
      className="group absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
    >
      <div
        key={snapPulse}
        className={`pointer-events-none absolute left-1 top-0 h-full w-px transition-colors duration-150 group-hover:bg-teal/40 ${
          dragging ? "bg-teal/60" : "bg-transparent"
        } ${dragging && snapPulse > 0 ? "animate-[pulse_0.35s_ease-out]" : ""}`}
      />
      {/* Grip dots reveal on hover to hint the drag affordance */}
      <div className="pointer-events-none absolute left-0 top-1/2 flex -translate-y-1/2 flex-col gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground" />
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground" />
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground" />
      </div>
    </div>
  );


  if (nodes.length === 0) {
    return (
      <aside
        ref={asideRef}
        className="relative flex h-full shrink-0 flex-col border-l border-border bg-panel"
        style={{ width, transition: dragging ? "none" : "width 180ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {resizer}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pinned inspectors
          </div>
          <button
            onClick={() => setCollapsed(true)}
            title="Hide panel"
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ›
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          <div>
            <div className="mono text-2xl opacity-40">◎</div>
            <p className="mt-3">Click any node in the diagram to pin its inspector here.</p>
            <p className="mt-2 text-[10px] opacity-70">
              Shift-click to open in a new pin, so you can compare two nodes side-by-side.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-panel"
      style={{ width, transition: dragging ? "none" : "width 180ms cubic-bezier(0.22, 1, 0.36, 1)" }}
    >
      {resizer}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pinned · {nodes.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCloseAll}
            className="text-[10px] text-muted-foreground hover:text-danger"
          >
            Close all
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Hide panel"
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ›
          </button>
        </div>
      </div>

      {/* Tab strip when multiple pinned */}
      {nodes.length > 1 && (
        <div className="flex gap-1 overflow-x-auto scrollbar-thin border-b border-border bg-panel-2/50 px-2 py-1">
          {nodes.map((n) => (
            <button
              key={n.id}
              onClick={() => onSelect(n.id)}
              className={`group inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[10px] transition-colors ${
                activeId === n.id
                  ? "bg-teal/20 text-teal"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  n.state === "active" ? "bg-teal" :
                  n.state === "failed" ? "bg-danger" :
                  n.state === "completed" ? "bg-success" :
                  n.state === "waiting" ? "bg-warning" : "bg-muted-foreground"
                }`}
              />
              <span className="max-w-[110px] truncate">{n.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onUnpin(n.id); }}
                className="ml-1 rounded px-1 text-muted-foreground opacity-0 hover:bg-danger/20 hover:text-danger group-hover:opacity-100"
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {(() => {
          const active = nodes.find((n) => n.id === activeId) ?? nodes[0];
          return (
            <NodeDrawer
              instance={instance}
              node={active}
              onClose={() => onUnpin(active.id)}
            />
          );
        })()}
      </div>
    </aside>
  );
}
