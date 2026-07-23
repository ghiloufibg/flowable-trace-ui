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
import type { EngineJob, JobKind } from "@/lib/types";
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

export interface JobPageQuery {
  start: number;
  size: number;
  jobType?: JobKind;
  sort?: string;
  order?: "asc" | "desc";
}

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

  /**
   * Lazy per-page fetch. Routes to the type-specific Flowable endpoint when
   * a `jobType` filter is set (`management/timer-jobs`,
   * `management/deadletter-jobs`) - matches how Flowable REST partitions job
   * kinds - otherwise hits the shared `management/jobs` endpoint. Only
   * covers one job kind per call, unlike hydrate() (which merges all three
   * for the aggregate KPIs); that's fine since the jobs list view always
   * filters to a single type or the unfiltered async queue.
   */
  async fetchPage(q: JobPageQuery): Promise<{ items: EngineJob[]; total: number }> {
    const qs = new URLSearchParams();
    qs.set("start", String(q.start));
    qs.set("size", String(q.size));
    if (q.sort) qs.set("sort", q.sort);
    if (q.order) qs.set("order", q.order);

    const endpoint =
      q.jobType === "timer"
        ? "management/timer-jobs"
        : q.jobType === "deadletter"
          ? "management/deadletter-jobs"
          : "management/jobs";

    const list = await flowableClient.get<FlowableList<FlowableJobDTO>>(`${endpoint}?${qs.toString()}`);
    const items: EngineJob[] = [];
    const needFallback: string[] = [];
    for (const dto of list.data) {
      const j = mapJob(dto);
      if (j) items.push(j);
      else needFallback.push(dto.id);
    }
    if (needFallback.length > 0) {
      const results = await Promise.all(
        needFallback.map((id) => customClient.get<EngineJob>(`jobs/${id}`).catch(() => undefined)),
      );
      for (const j of results) if (j) items.push(j);
    }

    const windowed = items.length > q.size ? items.slice(q.start, q.start + q.size) : items;

    // Populate caches so a subsequent detail navigation is warm.
    for (const j of windowed) {
      this.details.set(j.id, j);
      if (!this.order.includes(j.id)) this.order.push(j.id);
    }
    notifyStoreChanged();

    return { items: windowed, total: list.total };
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
