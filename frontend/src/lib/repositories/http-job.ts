/**
 * HTTP-backed JobRepository — Flowable REST for the list, custom endpoint
 * for aggregated KPIs (`jobHealth`).
 *
 * The list is assembled from all three of Flowable's job query endpoints
 * (async/executable, timer, dead-letter) since each lives under a separate
 * REST resource. Same summary/detail split as the other repositories: no
 * real backend summary endpoint exists yet, so every id currently takes the
 * per-id enrichment fallback (`custom/jobs/{id}`, which already
 * type-detects across all three tables) - the same request this repository
 * always made, restructured to warm-cache details and support
 * ensureJob(id) for deep links.
 */

import type { JobRepository } from "@/lib/store";
import { notifyStoreChanged } from "@/lib/store";
import type { EngineJob } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import {
  mapJob,
  type FlowableList,
  type FlowableJobDTO,
} from "@/lib/api/flowable-mappers";

type JobHealth = ReturnType<JobRepository["jobHealth"]>;

const EMPTY_HEALTH: JobHealth = {
  timers: 0,
  async: 0,
  dead: 0,
  locked: 0,
};

export class HttpJobRepository implements JobRepository {
  private summaries = new Map<string, EngineJob>();
  private details = new Map<string, EngineJob>();
  private inFlight = new Map<string, Promise<EngineJob>>();
  private order: string[] = [];
  private health: JobHealth = EMPTY_HEALTH;

  seed(items: EngineJob[]): void {
    this.summaries.clear();
    this.details.clear();
    this.order = [];
    for (const j of items) {
      this.details.set(j.id, j);
      this.order.push(j.id);
    }
    this.recomputeHealth();
    notifyStoreChanged();
  }

  private recomputeHealth(): void {
    const all = this.listJobs();
    const timers = all.filter((j) => j.type === "timer");
    const async_ = all.filter((j) => j.type === "async");
    const dead = all.filter((j) => j.type === "deadletter");
    const locked = all.filter((j) => j.lockOwner);
    const nextTimer = timers
      .filter((j) => j.dueDate)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0];
    const oldestAsync = async_
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    this.health = {
      timers: timers.length,
      async: async_.length,
      dead: dead.length,
      locked: locked.length,
      nextTimerDue: nextTimer?.dueDate,
      oldestAsyncCreated: oldestAsync?.createdAt,
    };
  }

  listJobs(): EngineJob[] {
    return this.order
      .map((id) => this.details.get(id) ?? this.summaries.get(id)!)
      .filter(Boolean);
  }

  getJob(id: string): EngineJob | undefined {
    return this.details.get(id) ?? this.summaries.get(id);
  }

  async ensureJob(id: string): Promise<EngineJob> {
    const cached = this.details.get(id);
    if (cached) return cached;
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const p = customClient
      .get<EngineJob>(`jobs/${id}`)
      .then((full) => {
        this.details.set(id, full);
        this.inFlight.delete(id);
        notifyStoreChanged();
        return full;
      })
      .catch((err) => {
        this.inFlight.delete(id);
        throw err;
      });
    this.inFlight.set(id, p);
    return p;
  }

  jobsForInstance(instanceId: string): EngineJob[] {
    return this.listJobs().filter((j) => j.instanceId === instanceId);
  }

  deadLetterCount(): number {
    return this.listJobs().filter((j) => j.type === "deadletter").length;
  }

  jobHealth(): JobHealth {
    return this.health;
  }

  async hydrate(): Promise<void> {
    const [asyncJobs, timerJobs, deadLetterJobs] = await Promise.all([
      flowableClient.get<FlowableList<FlowableJobDTO>>("management/jobs"),
      flowableClient.get<FlowableList<FlowableJobDTO>>("management/timer-jobs"),
      flowableClient.get<FlowableList<FlowableJobDTO>>("management/deadletter-jobs"),
    ]);
    const dtos = [...asyncJobs.data, ...timerJobs.data, ...deadLetterJobs.data];
    const nextOrder = dtos.map((d) => d.id);

    const nextSummaries = new Map<string, EngineJob>();
    const needsFallback: string[] = [];
    for (const dto of dtos) {
      const summary = mapJob(dto);
      if (summary) nextSummaries.set(dto.id, summary);
      else needsFallback.push(dto.id);
    }

    if (needsFallback.length > 0) {
      const results = await Promise.all(
        needsFallback.map((id) =>
          customClient.get<EngineJob>(`jobs/${id}`).catch(() => undefined),
        ),
      );
      results.forEach((full, i) => {
        if (!full) return;
        const id = needsFallback[i];
        nextSummaries.set(id, full);
        this.details.set(id, full);
      });
    }

    this.summaries = nextSummaries;
    this.order = nextOrder;

    try {
      const h = await customClient.get<JobHealth & { deadLetterCount?: number }>("jobs/health");
      this.health = {
        timers: h.timers,
        async: h.async,
        dead: h.dead,
        locked: h.locked,
        nextTimerDue: h.nextTimerDue,
        oldestAsyncCreated: h.oldestAsyncCreated,
      };
    } catch {
      // Fallback: derive locally if the custom endpoint is unavailable.
      this.recomputeHealth();
    }
    notifyStoreChanged();
  }
}
