/**
 * Engine job repository — unions every JobItem across INSTANCES and enriches
 * with instance/definition metadata for the /jobs page.
 */

import { INSTANCES, type ProcessInstance } from "@/lib/mock-data";

export type JobKind = "timer" | "async" | "deadletter";

export interface JobAttempt {
  at: string;
  durationMs: number;
  outcome: "success" | "failure";
  worker: string;
  error?: string;
}

export interface EngineJob {
  id: string;
  type: JobKind;
  instanceId: string;
  businessKey: string;
  definitionKey: string;
  definitionName: string;
  version: number;
  activityId: string;
  activityName: string;
  dueDate?: string;
  createdAt: string;
  retries: number;
  maxRetries: number;
  exceptionClass?: string;
  exceptionMessage?: string;
  stackTrace?: string;
  lockOwner?: string;
  lockExpiresAt?: string;
  attempts: JobAttempt[];
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function baseFromInstance(p: ProcessInstance) {
  return {
    instanceId: p.id,
    businessKey: p.businessKey,
    definitionKey: p.definitionKey,
    definitionName: p.definitionName,
    version: p.version,
  };
}

function buildJobs(): EngineJob[] {
  const out: EngineJob[] = [];

  for (const p of INSTANCES) {
    for (const j of p.jobs) {
      // Enrich the mock JobItem into a full EngineJob
      const node = p.nodes.find((n) => n.id === j.activityId);
      const err = node?.jobError;
      out.push({
        id: j.id,
        type: j.type,
        ...baseFromInstance(p),
        activityId: j.activityId,
        activityName: j.activityName,
        dueDate: j.dueDate,
        createdAt: iso(1000 * 60 * 16),
        retries: j.retries ?? (j.type === "deadletter" ? 0 : 3),
        maxRetries: 3,
        exceptionClass: err?.exceptionClass,
        exceptionMessage: err?.message ?? j.exception,
        stackTrace: err?.stackTrace,
        attempts:
          j.type === "deadletter"
            ? [
                { at: iso(1000 * 60 * 14), durationMs: 820, outcome: "failure", worker: "executor-1", error: err?.message },
                { at: iso(1000 * 60 * 11), durationMs: 640, outcome: "failure", worker: "executor-2", error: err?.message },
                { at: iso(1000 * 60 * 6),  durationMs: 900, outcome: "failure", worker: "executor-1", error: err?.message },
                { at: iso(1000 * 60 * 2),  durationMs: 780, outcome: "failure", worker: "executor-3", error: err?.message },
              ]
            : [],
      });
    }
  }

  // Synthetic extras so the page has enough surface
  const active = INSTANCES.find((p) => p.status === "active")!;
  out.push({
    id: "JOB-90101",
    type: "async",
    ...baseFromInstance(active),
    activityId: "notify",
    activityName: "Notify customer",
    createdAt: iso(1000 * 4),
    dueDate: iso(-1000 * 20),
    retries: 3,
    maxRetries: 3,
    lockOwner: "executor-2",
    lockExpiresAt: iso(-1000 * 60 * 5),
    attempts: [],
  });
  out.push({
    id: "JOB-90102",
    type: "async",
    ...baseFromInstance(active),
    activityId: "notify",
    activityName: "Publish event",
    createdAt: iso(1000 * 60 * 3),
    dueDate: iso(-1000 * 30),
    retries: 2,
    maxRetries: 3,
    exceptionClass: "java.net.SocketTimeoutException",
    exceptionMessage: "Read timed out after 5000ms calling https://events.internal/publish",
    attempts: [
      { at: iso(1000 * 60 * 3), durationMs: 5000, outcome: "failure", worker: "executor-4", error: "Read timed out" },
    ],
  });
  out.push({
    id: "JOB-90103",
    type: "timer",
    ...baseFromInstance(active),
    activityId: "escalate",
    activityName: "Escalate to manager",
    createdAt: iso(1000 * 60 * 60 * 4),
    dueDate: iso(-1000 * 60 * 60 * 20),
    retries: 3,
    maxRetries: 3,
    attempts: [],
  });

  return out;
}

const JOBS: EngineJob[] = buildJobs();

export function listJobs(): EngineJob[] {
  return JOBS;
}

export function getJob(id: string): EngineJob | undefined {
  return JOBS.find((j) => j.id === id);
}

export function jobsForInstance(instanceId: string): EngineJob[] {
  return JOBS.filter((j) => j.instanceId === instanceId);
}

export function deadLetterCount(): number {
  return JOBS.filter((j) => j.type === "deadletter").length;
}

export function jobHealth() {
  const timers = JOBS.filter((j) => j.type === "timer");
  const async_ = JOBS.filter((j) => j.type === "async");
  const dead = JOBS.filter((j) => j.type === "deadletter");
  const locked = JOBS.filter((j) => j.lockOwner);
  const nextTimer = timers
    .filter((j) => j.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0];
  const oldestAsync = async_
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
  return {
    timers: timers.length,
    async: async_.length,
    dead: dead.length,
    locked: locked.length,
    nextTimerDue: nextTimer?.dueDate,
    oldestAsyncCreated: oldestAsync?.createdAt,
  };
}
