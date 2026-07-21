import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { RelTime } from "@/components/rel-time";
import { currentActivities, failedJobCount, type ProcessInstance } from "@/lib/store";

import { useInstances } from "@/lib/store";

interface Props {
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}

/**
 * Three-pane IDE shell: top header · left instance rail · main content.
 * Left rail is a filterable, definition-grouped tree of live instances
 * (Command-Center layout, VS Code / Temporal Web feel).
 */
const GROUPS_PAGE = 15;
const PER_GROUP_INITIAL = 8;

export function AppShell({ children, headerRight }: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "failed" | "ended">("all");
  const [visibleGroups, setVisibleGroups] = useState(GROUPS_PAGE);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ⌘K / Ctrl-K to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("rail-search")?.focus();
      }
      if (e.key === "[" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const activeInstanceId = useMemo(() => {
    const m = currentPath.match(/^\/instances\/([^/]+)/);
    return m ? m[1] : null;
  }, [currentPath]);

  const instances = useInstances();

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = instances.filter((p) => !p.parentInstanceId).filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        p.businessKey?.toLowerCase().includes(q) ||
        p.definitionName.toLowerCase().includes(q) ||
        p.definitionKey.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, ProcessInstance[]>();
    for (const p of filtered) {
      const key = `${p.definitionKey}@v${p.version}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [instances, query, statusFilter]);

  // Reset caps whenever filters change
  useEffect(() => {
    setVisibleGroups(GROUPS_PAGE);
    setExpandedGroups(new Set());
  }, [query, statusFilter]);

  // Active-instance safety net: keep the active row visible.
  useEffect(() => {
    if (!activeInstanceId) return;
    const groupIdx = grouped.findIndex(([, list]) =>
      list.some((p) => p.id === activeInstanceId),
    );
    if (groupIdx === -1) return;
    if (groupIdx >= visibleGroups) {
      setVisibleGroups((v) => Math.max(v, groupIdx + 1));
    }
    const [defKey, list] = grouped[groupIdx];
    const posInGroup = list.findIndex((p) => p.id === activeInstanceId);
    if (posInGroup >= PER_GROUP_INITIAL && !expandedGroups.has(defKey)) {
      setExpandedGroups((s) => {
        const next = new Set(s);
        next.add(defKey);
        return next;
      });
    }
  }, [activeInstanceId, grouped, visibleGroups, expandedGroups]);

  const visibleGrouped = grouped.slice(0, visibleGroups);
  const hiddenGroupCount = Math.max(0, grouped.length - visibleGroups);

  const counts = useMemo(() => ({
    all: instances.filter((p) => !p.parentInstanceId).length,
    active: instances.filter((p) => !p.parentInstanceId && p.status === "active").length,
    failed: instances.filter((p) => !p.parentInstanceId && p.status === "failed").length,
    ended: instances.filter((p) => !p.parentInstanceId && p.status === "ended").length,
  }), [instances]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader right={headerRight} />
      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside
          className={`shrink-0 border-r border-border bg-panel transition-[width] duration-150 ${
            collapsed ? "w-10" : "w-72"
          } flex flex-col`}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="grid h-10 w-full place-items-center text-muted-foreground hover:text-foreground"
              title="Expand sidebar (⌘[)"
            >
              »
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Instances · {counts.all}
                </div>
                <button
                  onClick={() => setCollapsed(true)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  title="Collapse (⌘[)"
                >
                  «
                </button>
              </div>

              <div className="border-b border-border p-2">
                <div className="relative">
                  <input
                    id="rail-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter…"
                    className="w-full rounded border border-input bg-panel-2 py-1 pl-6 pr-8 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px]">⌕</span>
                  <kbd className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 mono text-[9px] text-muted-foreground">⌘K</kbd>
                </div>
                <div className="mt-2 flex gap-1 text-[10px]">
                  <FilterChip label={`All ${counts.all}`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
                  <FilterChip label={`Active ${counts.active}`} tone="teal" active={statusFilter === "active"} onClick={() => setStatusFilter("active")} />
                  <FilterChip label={`Failed ${counts.failed}`} tone="danger" active={statusFilter === "failed"} onClick={() => setStatusFilter("failed")} />
                  <FilterChip label={`Ended ${counts.ended}`} tone="success" active={statusFilter === "ended"} onClick={() => setStatusFilter("ended")} />
                </div>
              </div>

              <nav className="flex-1 overflow-auto scrollbar-thin px-1 py-2">
                <div className="space-y-3">
                  {visibleGrouped.map(([defKey, list]) => {
                    const expanded = expandedGroups.has(defKey);
                    const shownList = expanded ? list : list.slice(0, PER_GROUP_INITIAL);
                    const overflow = list.length - PER_GROUP_INITIAL;
                    return (
                      <div key={defKey}>
                        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                          {list[0].definitionName}
                          <span className="ml-1 mono text-[9px] opacity-60">v{list[0].version}</span>
                          <span className="ml-1 mono text-[9px] opacity-60">· {list.length}</span>
                        </div>
                        <div className="space-y-0.5">
                          {shownList.map((p) => (
                            <InstanceRailItem
                              key={p.id}
                              p={p}
                              active={currentPath === `/instances/${p.id}`}
                            />
                          ))}
                          {overflow > 0 && !expanded && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedGroups((s) => {
                                  const next = new Set(s);
                                  next.add(defKey);
                                  return next;
                                })
                              }
                              className="w-full pl-4 pr-2 py-1 text-left mono text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              + {overflow} more
                            </button>
                          )}
                          {expanded && list.length > PER_GROUP_INITIAL && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedGroups((s) => {
                                  const next = new Set(s);
                                  next.delete(defKey);
                                  return next;
                                })
                              }
                              className="w-full pl-4 pr-2 py-1 text-left mono text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              Show less
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {hiddenGroupCount > 0 && (
                    <div className="flex items-center justify-between gap-2 border-t border-border px-2 pt-2 text-[10px] text-muted-foreground">
                      <span>
                        <span className="mono">{visibleGroups}</span> of{" "}
                        <span className="mono">{grouped.length}</span> definitions
                      </span>
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setVisibleGroups((v) => v + GROUPS_PAGE)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Show {Math.min(GROUPS_PAGE, hiddenGroupCount)} more
                        </button>
                        <button
                          type="button"
                          onClick={() => setVisibleGroups(grouped.length)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Show all
                        </button>
                      </span>
                    </div>
                  )}
                  {grouped.length === 0 && (
                    <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                      No matches
                    </div>
                  )}
                </div>
              </nav>

              <div className="border-t border-border px-3 py-2 mono text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal mr-1.5 align-middle" />
                engine · localhost:8080
              </div>
            </>
          )}
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function FilterChip({
  label, active, onClick, tone,
}: { label: string; active: boolean; onClick: () => void; tone?: "teal" | "danger" | "success" }) {
  const activeCls =
    tone === "teal" ? "bg-teal/20 text-teal border-teal/40" :
    tone === "danger" ? "bg-danger/15 text-danger border-danger/40" :
    tone === "success" ? "bg-success/15 text-success border-success/40" :
    "bg-panel-2 text-foreground border-border";
  return (
    <button
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 transition-colors ${
        active ? activeCls : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}


function InstanceRailItem({ p, active }: { p: ProcessInstance; active: boolean }) {
  const activeNode = currentActivities(p)[0];
  const failed = failedJobCount(p);
  const dot =
    p.status === "failed" ? "bg-danger" :
    p.status === "ended" ? "bg-success" :
    "bg-teal";
  return (
    <Link
      to="/instances/$id"
      params={{ id: p.id }}
      className={`group flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
        active ? "bg-teal/15 text-foreground" : "hover:bg-panel-2"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot} ${p.status === "active" ? "animate-pulse" : ""}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate mono text-[11px]">{p.businessKey}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {activeNode ? activeNode.name : "—"}
          {" · "}
          <RelTime iso={p.startedAt} />
        </div>
      </div>
      {failed > 0 && (
        <span className="shrink-0 rounded-full bg-danger/20 px-1.5 mono text-[9px] font-semibold text-danger">
          {failed}
        </span>
      )}
    </Link>
  );
}
