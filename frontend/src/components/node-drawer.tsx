import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { BpmnNode, ProcessInstance } from "@/lib/store";
import { RelTime } from "@/components/rel-time";
import { jobsForInstance } from "@/lib/store";

interface Props {
  instance: ProcessInstance;
  node: BpmnNode | null;
  onClose: () => void;
}

export function NodeDrawer({ instance, node, onClose }: Props) {
  const [stackOpen, setStackOpen] = useState(false);
  if (!node) return null;

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-panel">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {node.type}
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold">{node.name}</h3>
          <div className="mt-1 mono text-[11px] text-muted-foreground truncate">id: {node.id}</div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4 scrollbar-thin space-y-4 text-sm">
        <StateBadge state={node.state} />

        {(node.type === "userTask" || node.type === "serviceTask") && (
          <Section title="Task details">
            <KV k="Assignee" v={<span className="mono">{node.assignee ?? "—"}</span>} />
            <KV k="Candidate groups" v={
              node.candidateGroups?.length
                ? <span className="mono">{node.candidateGroups.join(", ")}</span>
                : <span className="text-muted-foreground">—</span>
            } />
            <KV k="Due" v={node.dueDate
              ? <RelTime iso={node.dueDate} className={new Date(node.dueDate).getTime() < Date.now() ? "text-danger" : ""} />
              : <span className="text-muted-foreground">—</span>} />
            <KV k="Priority" v={node.priority ?? 50} />
          </Section>
        )}

        {node.multiInstance && (
          <Section title="Multi-instance progress">
            <KV k="Total instances" v={node.multiInstance.total} />
            <KV k="Active" v={<span className="text-teal">{node.multiInstance.active}</span>} />
            <KV k="Completed" v={<span className="text-success">{node.multiInstance.completed}</span>} />
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-success"
                style={{ width: `${(node.multiInstance.completed / node.multiInstance.total) * 100}%` }}
              />
            </div>
          </Section>
        )}

        {node.type === "exclusiveGateway" && (
          <Section title="Gateway decision">
            {node.gatewayDecision && (
              <div className="mb-3 rounded-md border border-teal/40 bg-teal/10 p-2 text-xs">
                {node.gatewayDecision}
              </div>
            )}
            <div className="space-y-1.5">
              {instance.edges.filter((e) => e.source === node.id).map((e) => (
                <div key={e.id} className={`flex items-start gap-2 rounded-md border p-2 text-xs
                  ${e.taken ? "border-teal/50 bg-teal/5" : e.taken === false ? "border-border bg-muted/30 opacity-70" : "border-border"}`}>
                  <span className={`mt-0.5 shrink-0 mono ${e.taken ? "text-teal" : "text-muted-foreground"}`}>
                    {e.taken ? "✓" : e.taken === false ? "✕" : "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.label ?? "→ " + e.target}</span>
                      <span className="mono text-[10px] text-muted-foreground">→ {e.target}</span>
                    </div>
                    {e.condition && (
                      <pre className="mt-1 overflow-x-auto rounded bg-panel-2 p-1.5 text-[11px] mono text-foreground">{e.condition}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {node.jobError && (() => {
          const relatedJob = jobsForInstance(instance.id).find((j) => j.activityId === node.id);
          return (
          <Section title="Failed job">
            <div className="rounded-md border border-danger/50 bg-danger/10 p-3 text-xs">
              <div className="mono text-danger break-all">{node.jobError.exceptionClass}</div>
              <div className="mt-2 text-foreground">{node.jobError.message}</div>
              <div className="mt-2 flex items-center gap-3 text-muted-foreground">
                <span>Retries left: <span className="mono text-danger">{node.jobError.retries}</span></span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => setStackOpen((v) => !v)}
                className="text-xs text-teal hover:text-teal-hover"
              >
                {stackOpen ? "▾ Hide" : "▸ Show"} stack trace
              </button>
              {relatedJob && (
                <Link
                  to="/jobs/$id"
                  params={{ id: relatedJob.id }}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-teal/40 bg-teal/10 px-2 py-1 text-[11px] font-medium text-teal hover:bg-teal/20"
                >
                  Open in Jobs
                  <span className="mono text-[10px]">{relatedJob.id}</span>
                  <span>→</span>
                </Link>
              )}
            </div>
            {stackOpen && (
              <pre className="mt-2 max-h-64 overflow-auto scrollbar-thin rounded-md border border-border bg-panel-2 p-3 text-[11px] mono leading-relaxed">
{node.jobError.stackTrace}
              </pre>
            )}
          </Section>
          );
        })()}

        {node.type === "callActivity" && node.childInstanceId && (
          <Section title="Called sub-process">
            <Link
              to="/instances/$id"
              params={{ id: node.childInstanceId }}
              className="inline-flex items-center gap-2 rounded-md border border-teal/40 bg-teal/10 px-3 py-2 text-xs font-medium text-teal hover:bg-teal/20"
            >
              View child instance
              <span className="mono">{node.childInstanceId}</span>
              <span>→</span>
            </Link>
          </Section>
        )}

        {node.type === "boundaryTimer" && node.timerDueAt && (
          <Section title="Timer">
            <KV k="Attached to" v={<span className="mono">{node.attachedTo}</span>} />
            <KV k="Due" v={<RelTime iso={node.timerDueAt} className={new Date(node.timerDueAt).getTime() < Date.now() ? "text-danger" : "text-warning"} />} />
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
function StateBadge({ state }: { state: BpmnNode["state"] }) {
  const map = {
    active:    { bg: "bg-teal/15",    fg: "text-teal",    label: "Active" },
    completed: { bg: "bg-success/15", fg: "text-success", label: "Completed" },
    failed:    { bg: "bg-danger/15",  fg: "text-danger",  label: "Failed" },
    waiting:   { bg: "bg-warning/15", fg: "text-warning", label: "Waiting" },
    pending:   { bg: "bg-muted",      fg: "text-muted-foreground", label: "Not yet reached" },
  } as const;
  const c = map[state];
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${c.bg} ${c.fg}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {c.label}
    </div>
  );
}
