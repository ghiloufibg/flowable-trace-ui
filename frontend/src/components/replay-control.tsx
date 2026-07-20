import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  replaying: boolean;
  progress: number;
  speed: number;
  onToggle: () => void;
  onProgressChange: (p: number) => void;
  onSpeedChange: (s: number) => void;
  onReset: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const SPEEDS = [0.5, 1, 2, 4];

export function ReplayControl({
  replaying,
  progress,
  speed,
  onToggle,
  onProgressChange,
  onSpeedChange,
  onReset,
  containerRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Initialise position from bottom-left of container
  useEffect(() => {
    if (pos || !containerRef.current || !panelRef.current) return;
    const c = containerRef.current.getBoundingClientRect();
    const p = panelRef.current.getBoundingClientRect();
    setPos({ x: 12, y: c.height - p.height - 12 });
  }, [pos, containerRef]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!panelRef.current || !containerRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    const p = panelRef.current.getBoundingClientRect();
    const c = containerRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - (p.left - c.left), dy: e.clientY - (p.top - c.top) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current || !containerRef.current || !panelRef.current) return;
    const c = containerRef.current.getBoundingClientRect();
    const p = panelRef.current.getBoundingClientRect();
    let x = e.clientX - dragRef.current.dx;
    let y = e.clientY - dragRef.current.dy;
    x = Math.max(0, Math.min(c.width - p.width, x));
    y = Math.max(0, Math.min(c.height - p.height, y));
    setPos({ x, y });
  }, [containerRef]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  return (
    <div
      ref={panelRef}
      className="absolute z-20 select-none rounded-lg border border-border bg-panel/95 shadow-xl backdrop-blur-md transition-shadow hover:shadow-2xl"
      style={{
        left: pos?.x ?? 12,
        top: pos?.y ?? undefined,
        bottom: pos ? undefined : 12,
        minWidth: collapsed ? undefined : 320,
      }}
    >
      {/* Drag handle / header */}
      <div
        onPointerDown={onPointerDown}
        className="flex cursor-grab items-center justify-between gap-2 rounded-t-lg border-b border-border bg-panel-2/60 px-2.5 py-1.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5">
          <div className="flex flex-col gap-0.5" aria-hidden>
            <span className="block h-0.5 w-3 rounded bg-muted-foreground/50" />
            <span className="block h-0.5 w-3 rounded bg-muted-foreground/50" />
            <span className="block h-0.5 w-3 rounded bg-muted-foreground/50" />
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Token Replay
          </span>
          {replaying && (
            <span className="ml-1 inline-flex items-center gap-1 rounded bg-teal/15 px-1.5 py-0.5 text-[9px] font-medium text-teal">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
              LIVE
            </span>
          )}
        </div>
        <button
          data-no-drag
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-0.5 text-muted-foreground hover:bg-panel hover:text-foreground"
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d={collapsed ? "M3 4.5l3 3 3-3" : "M3 7.5l3-3 3 3"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div data-no-drag className="flex flex-col gap-2 p-2.5">
          {/* Transport controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onReset}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-panel-2 text-muted-foreground hover:border-teal hover:text-teal"
              title="Restart"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6a4 4 0 104-4v2L3 1.5 6 -1v2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,3)" />
              </svg>
            </button>
            <button
              onClick={onToggle}
              className="inline-flex h-7 w-7 items-center justify-center rounded bg-teal text-white shadow-sm hover:bg-teal-hover"
              title={replaying ? "Pause" : "Play"}
            >
              {replaying ? (
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1" width="2.5" height="8" fill="currentColor"/><rect x="6" y="1" width="2.5" height="8" fill="currentColor"/></svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
              )}
            </button>
            <span className="mono w-10 text-center text-[10px] tabular-nums text-foreground">
              {Math.round(progress * 100)}%
            </span>
            <div className="ml-auto flex items-center gap-0.5 rounded border border-border bg-panel-2 p-0.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSpeedChange(s)}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium tabular-nums transition-colors ${
                    speed === s
                      ? "bg-teal text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="relative">
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={progress}
              onChange={(e) => onProgressChange(parseFloat(e.target.value))}
              className="w-full accent-teal"
            />
            <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground">
              <span>start</span>
              <span>end</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
