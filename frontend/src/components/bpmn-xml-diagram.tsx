import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessInstance, TrailEntry } from "@/lib/store";
import { processInstanceToBpmnXml } from "@/lib/bpmn-xml";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

// bpmn-js CSS (scoped by .djs-container in our overrides)
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

interface Props {
  instance: ProcessInstance;
  xmlOverride?: string | null;
  selectedNodeId: string | null;
  selectedEdgeId?: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge?: (id: string | null) => void;
  replaying?: boolean;
  replayProgress?: number;
  highlightedSegment?: { edgeId: string; index: number } | null;
}

type Viewer = {
  importXML: (xml: string) => Promise<{ warnings: unknown[] }>;
  destroy: () => void;
  get: <T = unknown>(name: string) => T;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

type Bounds = { x: number; y: number; width: number; height: number };

function replayPath(instance: ProcessInstance): TrailEntry[] {
  return [...instance.trail].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
}

export function BpmnXmlDiagram({
  instance,
  xmlOverride,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  replaying,
  replayProgress = 0,
  highlightedSegment,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [nodeIdSet, setNodeIdSet] = useState<Set<string>>(new Set());
  const [tokenPos, setTokenPos] = useState<{ x: number; y: number } | null>(null);
  const [multiSelCount, setMultiSelCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const xml = useMemo(
    () => xmlOverride ?? processInstanceToBpmnXml(instance),
    [instance, xmlOverride],
  );

  // Mount viewer once
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    (async () => {
      // Use Modeler so nodes can be dragged/repositioned in-place.
      // No save/export wired — edits live only in the viewer's model.
      const mod = await import("bpmn-js/lib/Modeler");
      if (cancelled || !containerRef.current) return;
      const Modeler = (mod as { default: new (opts: unknown) => Viewer }).default;
      const v = new Modeler({ container: containerRef.current });
      viewerRef.current = v;
      v.on("element.click", (...args: unknown[]) => {
        const evt = args[0] as { element: { id: string; type: string } };
        if (!evt?.element) return;
        const t = evt.element.type;
        if (t === "bpmn:Process" || evt.element.id === "__implicitroot") return;
        if (t === "bpmn:SequenceFlow" || t === "bpmn:MessageFlow" || t === "bpmn:Association") {
          onSelectEdge?.(evt.element.id);
          return;
        }
        onSelectNode(evt.element.id);
      });
      // Track multi-selection count (shift-click is built-in on the Modeler)
      v.on("selection.changed", (...args: unknown[]) => {
        const evt = args[0] as { newSelection: Array<{ type: string }> };
        const shapes = (evt?.newSelection ?? []).filter(
          (e) =>
            e.type !== "bpmn:SequenceFlow" &&
            e.type !== "bpmn:MessageFlow" &&
            e.type !== "bpmn:Association",
        );
        setMultiSelCount(shapes.length);
      });
      // Track undo/redo availability from bpmn-js commandStack
      const cs = v.get<{
        canUndo: () => boolean;
        canRedo: () => boolean;
      }>("commandStack");
      const syncCS = () => {
        setCanUndo(cs.canUndo());
        setCanRedo(cs.canRedo());
      };
      v.on("commandStack.changed", syncCS);
      v.on("import.done", syncCS);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Import XML whenever it changes
  useEffect(() => {
    if (!ready || !viewerRef.current) return;
    setImportErr(null);
    setWarning(null);
    viewerRef.current
      .importXML(xml)
      .then((res) => {
        const canvas = viewerRef.current!.get<{ zoom: (v: string) => void }>("canvas");
        // Fit twice: once now, once on next frame after layout settles
        canvas.zoom("fit-viewport");
        requestAnimationFrame(() => canvas.zoom("fit-viewport"));
        const reg = viewerRef.current!.get<{ getAll: () => Array<{ id: string }> }>(
          "elementRegistry",
        );
        setNodeIdSet(new Set(reg.getAll().map((e) => e.id)));
        if (res.warnings.length > 0) {
          setWarning(`${res.warnings.length} import warning(s)`);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setImportErr(msg);
      });
  }, [xml, ready]);

  // Re-fit on container resize
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const v = viewerRef.current;
      if (!v) return;
      try {
        v.get<{ zoom: (v: string) => void }>("canvas").zoom("fit-viewport");
      } catch { /* viewer torn down */ }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // Apply state markers + overlays whenever instance changes or import completes
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || nodeIdSet.size === 0) return;
    const canvas = v.get<{
      addMarker: (id: string, m: string) => void;
      removeMarker: (id: string, m: string) => void;
      hasMarker: (id: string, m: string) => boolean;
    }>("canvas");
    const overlays = v.get<{
      add: (id: string, cfg: { position: { top?: number; bottom?: number; left?: number; right?: number }; html: string }) => string;
      remove: (filter: { element?: string; type?: string }) => void;
    }>("overlays");

    // Clear our previous overlays
    overlays.remove({ type: "state-badge" });

    const MARKERS = ["state-active", "state-completed", "state-failed", "state-waiting", "state-pending"];

    for (const n of instance.nodes) {
      if (!nodeIdSet.has(n.id)) continue;
      for (const m of MARKERS) canvas.removeMarker(n.id, m);
      canvas.addMarker(n.id, `state-${n.state}`);

      // Multi-instance badge
      if (n.multiInstance) {
        overlays.add(n.id, {
          position: { bottom: -6, right: -6 },
          html: `<div class="fc-badge fc-badge-mi">${n.multiInstance.completed}/${n.multiInstance.total}</div>`,
        });
      }
      // Failed marker
      if (n.state === "failed") {
        overlays.add(n.id, {
          position: { top: -10, right: -10 },
          html: `<div class="fc-badge fc-badge-fail" title="Failed job">!</div>`,
        });
      }
      // Waiting/timer
      if (n.state === "waiting" && n.type !== "boundaryTimer") {
        overlays.add(n.id, {
          position: { top: -10, right: -10 },
          html: `<div class="fc-badge fc-badge-wait" title="Waiting">⏱</div>`,
        });
      }
      // Call activity affordance
      if (n.type === "callActivity" && n.childInstanceId) {
        overlays.add(n.id, {
          position: { bottom: -14, left: 8 },
          html: `<div class="fc-badge fc-badge-sub">▽ sub-process</div>`,
        });
      }
    }

    // Edges: taken vs rejected + condition tooltip overlay
    const EDGE_MARKERS = ["flow-taken", "flow-rejected"];
    const reg = v.get<{ get: (id: string) => { waypoints?: Array<{ x: number; y: number }> } | undefined }>(
      "elementRegistry",
    );
    for (const e of instance.edges) {
      if (!nodeIdSet.has(e.id)) continue;
      for (const m of EDGE_MARKERS) canvas.removeMarker(e.id, m);
      if (e.taken === true) canvas.addMarker(e.id, "flow-taken");
      else if (e.taken === false) canvas.addMarker(e.id, "flow-rejected");
      if (e.condition || e.label) {
        const el = reg.get(e.id);
        const wps = el?.waypoints ?? [];
        const mid = wps[Math.floor(wps.length / 2)] ?? { x: 0, y: 0 };
        const title = e.condition
          ? `${e.label ? e.label + " — " : ""}${e.condition}`
          : e.label ?? "";
        overlays.add(e.id, {
          position: { top: mid.y - 10, left: mid.x - 60 } as never,
          html: `<div class="fc-edge-tip" title="${escapeAttr(title)}">${e.label ? escapeHtml(e.label) : "ƒ"}${e.condition ? ' <span class="fc-edge-tip-cond">?</span>' : ""}</div>`,
        });
      }
    }
  }, [instance, ready, nodeIdSet]);

  // Selection marker
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    const canvas = v.get<{
      addMarker: (id: string, m: string) => void;
      removeMarker: (id: string, m: string) => void;
    }>("canvas");
    // clear from all known
    for (const id of nodeIdSet) canvas.removeMarker(id, "is-selected");
    if (selectedNodeId && nodeIdSet.has(selectedNodeId)) {
      canvas.addMarker(selectedNodeId, "is-selected");
    }
    if (selectedEdgeId && nodeIdSet.has(selectedEdgeId)) {
      canvas.addMarker(selectedEdgeId, "is-selected");
    }
  }, [selectedNodeId, selectedEdgeId, ready, nodeIdSet]);

  // Highlighted routed-path segment overlay
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    const overlays = v.get<{
      add: (
        id: string,
        type: string,
        cfg: { position: { top: number; left: number }; html: string; scale?: boolean },
      ) => string;
      remove: (filter: { element?: string; type?: string }) => void;
    }>("overlays");
    overlays.remove({ type: "segment-highlight" });
    if (!highlightedSegment) return;
    const { edgeId, index } = highlightedSegment;
    if (!nodeIdSet.has(edgeId)) return;
    const reg = v.get<{
      get: (id: string) =>
        | { waypoints?: Array<{ x: number; y: number }>; x: number; y: number }
        | undefined;
    }>("elementRegistry");
    const el = reg.get(edgeId);
    const wps = el?.waypoints ?? [];
    const p1 = wps[index];
    const p2 = wps[index + 1];
    if (!el || !p1 || !p2) return;
    const PAD = 6;
    const minX = Math.min(p1.x, p2.x) - PAD;
    const minY = Math.min(p1.y, p2.y) - PAD;
    const w = Math.abs(p2.x - p1.x) + PAD * 2;
    const h = Math.abs(p2.y - p1.y) + PAD * 2;
    const x1 = p1.x - minX;
    const y1 = p1.y - minY;
    const x2 = p2.x - minX;
    const y2 = p2.y - minY;
    const html =
      `<svg width="${w}" height="${h}" style="overflow:visible;pointer-events:none;" xmlns="http://www.w3.org/2000/svg">` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--teal)" stroke-width="5" stroke-linecap="round" stroke-opacity="0.85" />` +
      `<circle cx="${x1}" cy="${y1}" r="4" fill="var(--teal)" />` +
      `<circle cx="${x2}" cy="${y2}" r="4" fill="var(--teal)" />` +
      `</svg>`;
    overlays.add(edgeId, "segment-highlight", {
      position: { top: minY - el.y, left: minX - el.x },
      html,
      scale: true,
    });
  }, [highlightedSegment, ready, nodeIdSet, instance]);


  // Token replay position (in diagram coordinates)
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || !replaying) {
      setTokenPos(null);
      return;
    }
    const path = replayPath(instance);
    if (path.length === 0) return;
    const reg = v.get<{ get: (id: string) => { id: string } | undefined }>("elementRegistry");
    const canvas = v.get<{ getAbsoluteBBox: (el: unknown) => Bounds }>("canvas");
    const t = Math.max(0, Math.min(1, replayProgress));
    const idx = Math.min(path.length - 1, Math.floor(t * path.length));
    const seg = t * path.length - idx;
    const cur = reg.get(path[idx].activityId);
    const nxt = reg.get(path[Math.min(path.length - 1, idx + 1)].activityId);
    if (!cur) return;
    const cb = canvas.getAbsoluteBBox(cur);
    if (!nxt || nxt === cur) {
      setTokenPos({ x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 });
      return;
    }
    const nb = canvas.getAbsoluteBBox(nxt);
    setTokenPos({
      x: cb.x + cb.width / 2 + (nb.x + nb.width / 2 - (cb.x + cb.width / 2)) * seg,
      y: cb.y + cb.height / 2 + (nb.y + nb.height / 2 - (cb.y + cb.height / 2)) * seg,
    });
  }, [replaying, replayProgress, instance, ready]);

  // Zoom controls
  const zoomBy = (delta: number) => {
    const v = viewerRef.current;
    if (!v) return;
    const canvas = v.get<{ zoom: (z?: number | string, c?: unknown) => number }>("canvas");
    const cur = canvas.zoom();
    canvas.zoom(Math.max(0.2, Math.min(4, (cur || 1) + delta)));
  };
  const fit = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.get<{ zoom: (v: string) => void }>("canvas").zoom("fit-viewport");
  };

  type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
  type Orientation = "horizontal" | "vertical";
  const getSelectedShapes = () => {
    const v = viewerRef.current;
    if (!v) return [];
    const sel = v.get<{ get: () => Array<{ id: string; type: string; waypoints?: unknown }> }>("selection");
    return sel.get().filter((e) => !e.waypoints && e.type !== "bpmn:Process" && e.id !== "__implicitroot");
  };
  const align = (type: Alignment) => {
    const v = viewerRef.current;
    if (!v) return;
    const els = getSelectedShapes();
    if (els.length < 2) return;
    v.get<{ trigger: (els: unknown[], t: Alignment) => void }>("alignElements").trigger(els, type);
  };
  const distribute = (orientation: Orientation) => {
    const v = viewerRef.current;
    if (!v) return;
    const els = getSelectedShapes();
    if (els.length < 3) return;
    v.get<{ trigger: (els: unknown[], o: Orientation) => void }>("distributeElements").trigger(
      els,
      orientation,
    );
  };

  const undo = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.get<{ undo: () => void; canUndo: () => boolean }>("commandStack").undo();
  };
  const redo = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.get<{ redo: () => void; canRedo: () => boolean }>("commandStack").redo();
  };

  // Keyboard shortcuts: Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z / Ctrl+Y
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  return (
    <div className="relative h-full w-full overflow-hidden grid-bg rounded-md border border-border">
      <div ref={containerRef} className="fc-djs h-full w-full" />

      {/* Zoom / fit / undo / redo controls */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-panel/90 p-1 text-xs backdrop-blur">
        <button
          className="px-2 py-1 hover:bg-muted rounded disabled:opacity-40"
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
          onClick={undo}
        >
          ↶
        </button>
        <button
          className="px-2 py-1 hover:bg-muted rounded disabled:opacity-40"
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          onClick={redo}
        >
          ↷
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={() => zoomBy(0.15)}>+</button>
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={() => zoomBy(-0.15)}>−</button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button className="px-2 py-1 hover:bg-muted rounded" onClick={fit}>Fit</button>
      </div>

      {/* Align / distribute toolbar — appears with 2+ selected shapes.
          Shift-click nodes on the canvas to build a multi-selection. */}
      {multiSelCount >= 2 && (
        <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-panel/95 p-1 text-xs shadow-lg backdrop-blur">
          <span className="px-2 text-muted-foreground">{multiSelCount} selected</span>
          <div className="mx-1 h-4 w-px bg-border" />
          <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">Align</span>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align left" onClick={() => align("left")}>⇤</button>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align center (horizontal)" onClick={() => align("center")}>⇔</button>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align right" onClick={() => align("right")}>⇥</button>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align top" onClick={() => align("top")}>⤒</button>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align middle (vertical)" onClick={() => align("middle")}>⇕</button>
          <button className="px-2 py-1 hover:bg-muted rounded" title="Align bottom" onClick={() => align("bottom")}>⤓</button>
          <div className="mx-1 h-4 w-px bg-border" />
          <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">Distribute</span>
          <button
            className="px-2 py-1 hover:bg-muted rounded disabled:opacity-40"
            disabled={multiSelCount < 3}
            title="Distribute horizontally (needs 3+)"
            onClick={() => distribute("horizontal")}
          >
            ⇹
          </button>
          <button
            className="px-2 py-1 hover:bg-muted rounded disabled:opacity-40"
            disabled={multiSelCount < 3}
            title="Distribute vertically (needs 3+)"
            onClick={() => distribute("vertical")}
          >
            ⇳
          </button>
        </div>
      )}

      {/* top-12, not top-3: instances.$id.tsx renders its own "BPMN source" control at
          left-3 top-3 in this same corner - stack below it rather than overlap. */}
      {warning && (
        <div className="absolute left-3 top-12 z-20 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          {warning}
        </div>
      )}
      {importErr && (
        <div className="absolute left-3 top-12 z-20 max-w-md rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          <div className="font-semibold mb-0.5">Invalid BPMN XML</div>
          <div className="mono">{importErr}</div>
        </div>
      )}

      {/* Token overlay */}
      {tokenPos && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: tokenPos.x, top: tokenPos.y }}
        >
          <div className="fc-token" />
        </div>
      )}
    </div>
  );
}
