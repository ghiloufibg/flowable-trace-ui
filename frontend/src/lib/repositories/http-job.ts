/**
 * HTTP-backed JobRepository — Flowable REST for the list, custom endpoint
 * for aggregated KPIs (`jobHealth`).
 *
 * The list is assembled from all three of Flowable's job query endpoints
 * (async/executable, timer, dead-letter) since each lives under a separate
 * REST resource. The per-id enrichment call (`custom/jobs/{id}`) already
 * type-detects across all three tables, so it's reused unchanged here.
 */

import type { JobRepository } from "@/lib/store";
import type { EngineJob } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import type { FlowableList, FlowableJobDTO } from "@/lib/api/flowable-mappers";

type JobHealth = ReturnType<JobRepository["jobHealth"]>;

const EMPTY_HEALTH: JobHealth = {
  timers: 0,
  async: 0,
  dead: 0,
  locked: 0,
};

export class HttpJobRepository implements JobRepository {
  private byId = new Map<string, EngineJob>();
  private order: string[] = [];
  private health: JobHealth = EMPTY_HEALTH;

  seed(items: EngineJob[]): void {
    this.byId.clear();
    this.order = [];
    for (const j of items) {
      this.byId.set(j.id, j);
      this.order.push(j.id);
    }
    this.recomputeHealth();
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
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  getJob(id: string): EngineJob | undefined {
    return this.byId.get(id);
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
    const ids = [
      ...asyncJobs.data.map((d) => d.id),
      ...timerJobs.data.map((d) => d.id),
      ...deadLetterJobs.data.map((d) => d.id),
    ];

    const nextOrder: string[] = [];
    const nextMap = new Map<string, EngineJob>();
    await Promise.all(
      ids.map(async (id) => {
        nextOrder.push(id);
        const domain = await customClient.get<EngineJob>(`jobs/${id}`);
        nextMap.set(id, domain);
      }),
    );
    this.byId = nextMap;
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
  }
}
