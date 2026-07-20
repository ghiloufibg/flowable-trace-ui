import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ProcessInstance, Variable } from "@/lib/store";
import { formatDuration } from "@/lib/store";
import { RelTime } from "@/components/rel-time";

export type TabKey = "variables" | "tasks" | "trail" | "jobs";

const TABS: Array<{ key: TabKey; label: string; num: number }> = [
  { key: "variables", label: "Variables", num: 1 },
  { key: "tasks", label: "Tasks", num: 2 },
  { key: "trail", label: "Activity trail", num: 3 },
  { key: "jobs", label: "Jobs", num: 4 },
];

export function InstanceTabs({
  instance, active, onChange, filterActivityId,
}: {
  instance: ProcessInstance;
  active: TabKey;
  onChange: (t: TabKey) => void;
  filterActivityId: string | null;
}) {
  const counts = {
    variables: instance.variables.length,
    tasks: instance.tasks.length,
    trail: instance.trail.length,
    jobs: instance.jobs.length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-panel">
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors
                ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <span className="mono text-[10px] rounded bg-muted px-1 text-muted-foreground">{t.num}</span>
              {t.label}
              <span className="mono text-[10px] text-muted-foreground">{counts[t.key]}</span>
              {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-teal" />}
            </button>
          );
        })}
        {filterActivityId && (
          <div className="ml-auto mr-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>filtered by</span>
            <code className="rounded bg-muted px-1.5 py-0.5 mono text-foreground">{filterActivityId}</code>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-4">
        {active === "variables" && <VariablesTab instance={instance} filterActivityId={filterActivityId} />}
        {active === "tasks" && <TasksTab instance={instance} filterActivityId={filterActivityId} />}
        {active === "trail" && <TrailTab instance={instance} filterActivityId={filterActivityId} />}
        {active === "jobs" && <JobsTab instance={instance} filterActivityId={filterActivityId} />}
      </div>
    </div>
  );
}

function VariablesTab({ instance }: { instance: ProcessInstance; filterActivityId: string | null }) {
  const [openVar, setOpenVar] = useState<string | null>(null);
  return (
    <div className="rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-panel-2 text-muted-foreground">
          <tr>
            <Th>Name</Th><Th>Type</Th><Th>Value</Th><Th>Revisions</Th><Th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {instance.variables.map((v) => (
            <VarRow key={v.name} v={v} open={openVar === v.name} onToggle={() => setOpenVar(openVar === v.name ? null : v.name)} />
          ))}
          {instance.variables.length === 0 && (
            <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No variables</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function VarRow({ v, open, onToggle }: { v: Variable; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-border hover:bg-panel-2/50">
        <Td><span className="mono">{v.name}</span></Td>
        <Td><span className="mono text-muted-foreground">{v.type}</span></Td>
        <Td><span className="mono text-foreground">{v.value}</span></Td>
        <Td><span className="mono text-muted-foreground">{v.history.length}</span></Td>
        <Td>
          <button onClick={onToggle} className="text-teal hover:text-teal-hover text-xs">
            {open ? "▾" : "▸"}
          </button>
        </Td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-panel-2/30">
          <td colSpan={5} className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Variable history</div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <Th>Revision</Th><Th>When</Th><Th>Old</Th><Th>→</Th><Th>New</Th>
                </tr>
              </thead>
              <tbody>
                {v.history.map((h) => (
                  <tr key={h.revision} className="border-t border-border/50">
                    <Td><span className="mono">#{h.revision}</span></Td>
                    <Td className="text-muted-foreground"><RelTime iso={h.timestamp} /></Td>
                    <Td><span className="mono text-muted-foreground">{h.oldValue ?? "∅"}</span></Td>
                    <Td className="text-muted-foreground">→</Td>
                    <Td><span className="mono text-success">{h.newValue}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function TasksTab({ instance, filterActivityId }: { instance: ProcessInstance; filterActivityId: string | null }) {
  let tasks = instance.tasks;
  if (filterActivityId) tasks = tasks.filter((t) => t.name.toLowerCase().includes(
    (instance.nodes.find((n) => n.id === filterActivityId)?.name ?? "").toLowerCase()
  ) || instance.nodes.find((n) => n.id === filterActivityId)?.type === "userTask");
  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");
  return (
    <div className="space-y-4">
      <TaskList title="Pending" tasks={pending} emptyText="No pending tasks" pending />
      <TaskList title="Completed" tasks={completed} emptyText="No completed tasks" />
    </div>
  );
}
function TaskList({ title, tasks, emptyText, pending }: {
  title: string; tasks: ProcessInstance["tasks"]; emptyText: string; pending?: boolean;
}) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border bg-panel-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} <span className="mono ml-1">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <Th>Name</Th>
              <Th>{pending ? "Assignee" : "Completed by"}</Th>
              <Th>{pending ? "Due" : "Duration"}</Th>
              <Th>Priority</Th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <Td className="font-medium">{t.name}</Td>
                <Td><span className="mono">{pending ? (t.assignee ?? "—") : (t.completedBy ?? "—")}</span></Td>
                <Td>
                  {pending
                    ? (t.dueDate
                        ? <RelTime iso={t.dueDate} className={new Date(t.dueDate).getTime() < Date.now() ? "text-danger font-medium" : ""} />
                        : "—")
                    : <span className="mono">{formatDuration(t.durationMs)}</span>}
                </Td>
                <Td><span className="mono text-muted-foreground">{t.priority}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TrailTab({ instance, filterActivityId }: { instance: ProcessInstance; filterActivityId: string | null }) {
  const entries = filterActivityId
    ? instance.trail.filter((t) => t.activityId === filterActivityId)
    : instance.trail;
  return (
    <ol className="relative border-l-2 border-border pl-6">
      {entries.map((e) => {
        const ongoing = !e.endedAt;
        return (
          <li key={e.id} className="mb-4 last:mb-0">
            <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2
              ${ongoing ? "bg-teal border-teal bpmn-pulse" : "bg-success border-success"}`} />
            <div className="rounded-md border border-border bg-panel p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{e.activityName}</div>
                  <div className="mono text-[10px] text-muted-foreground">{e.activityId} · {e.type}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="mono text-muted-foreground"><RelTime iso={e.startedAt} /></div>
                  <div className={`mono ${ongoing ? "text-teal" : "text-muted-foreground"}`}>
                    {ongoing ? "in progress" : formatDuration(e.durationMs)}
                  </div>
                </div>
              </div>
            </div>
          </li>
        );
      })}
      {entries.length === 0 && (
        <div className="text-xs text-muted-foreground">No activity yet</div>
      )}
    </ol>
  );
}

function JobsTab({ instance, filterActivityId }: { instance: ProcessInstance; filterActivityId: string | null }) {
  const jobs = filterActivityId
    ? instance.jobs.filter((j) => j.activityId === filterActivityId)
    : instance.jobs;
  const pending = jobs.filter((j) => j.type !== "deadletter");
  const failed = jobs.filter((j) => j.type === "deadletter");
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border">
        <div className="border-b border-border bg-panel-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pending / timer <span className="mono ml-1">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No pending jobs</div>
        ) : pending.map((j) => (
          <div key={j.id} className="flex items-center justify-between border-t border-border p-3 first:border-t-0 text-xs">
            <div>
              <div className="font-medium">{j.activityName}</div>
              <div className="mono text-[10px] text-muted-foreground">{j.id} · {j.type}</div>
            </div>
            <div className="flex items-center gap-3">
              {j.dueDate && (
                <div className="text-warning mono"><RelTime iso={j.dueDate} /></div>
              )}
              <Link
                to="/jobs/$id"
                params={{ id: j.id }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-teal hover:bg-teal/10"
              >
                Open in Jobs →
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-danger/40">
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
          Dead-letter / failed <span className="mono ml-1">{failed.length}</span>
        </div>
        {failed.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No failed jobs</div>
        ) : failed.map((j) => (
          <div key={j.id} className="border-t border-danger/20 p-3 first:border-t-0">
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium">{j.activityName}</div>
                <div className="mono text-[10px] text-muted-foreground">{j.id}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="mono text-[11px] text-danger">retries: {j.retries ?? 0}</div>
                <Link
                  to="/jobs/$id"
                  params={{ id: j.id }}
                  className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/20"
                >
                  Open in Jobs →
                </Link>
              </div>
            </div>
            {j.exception && (
              <pre className="mt-2 overflow-x-auto rounded bg-panel-2 p-2 text-[11px] mono text-danger">{j.exception}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${className ?? ""}`}>{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className ?? ""}`}>{children}</td>;
}
