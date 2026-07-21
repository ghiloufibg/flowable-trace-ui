/**
 * HTTP-backed DeploymentRepository.
 *
 * Same summary/detail split as HttpInstanceRepository (see its doc comment):
 * `summaries` from hydrate()'s list call, `details` filled lazily by
 * ensureDeployment(id), preserved across hydrate() calls. No real backend
 * summary endpoint exists yet, so every id currently takes the per-id
 * enrichment fallback - same request this repository always made, just
 * restructured to warm-cache details and give deep links a fetch path.
 */

import type { DeploymentRepository } from "@/lib/store";
import { notifyStoreChanged } from "@/lib/store";
import type { Deployment, ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import {
  mapDeployment,
  type FlowableList,
  type FlowableDeploymentDTO,
} from "@/lib/api/flowable-mappers";
import type { HttpInstanceRepository } from "@/lib/repositories/http-instance";

export class HttpDeploymentRepository implements DeploymentRepository {
  private summaries = new Map<string, Deployment>();
  private details = new Map<string, Deployment>();
  private inFlight = new Map<string, Promise<Deployment>>();
  private order: string[] = [];

  constructor(private readonly instances: Pick<HttpInstanceRepository, "listInstances">) {}

  seed(items: Deployment[]): void {
    this.summaries.clear();
    this.details.clear();
    this.order = [];
    for (const d of items) {
      this.details.set(d.id, d);
      this.order.push(d.id);
    }
    notifyStoreChanged();
  }

  listDeployments(): Deployment[] {
    return this.order
      .map((id) => this.details.get(id) ?? this.summaries.get(id)!)
      .filter(Boolean);
  }

  getDeployment(id: string): Deployment | undefined {
    return this.details.get(id) ?? this.summaries.get(id);
  }

  async ensureDeployment(id: string): Promise<Deployment> {
    const cached = this.details.get(id);
    if (cached) return cached;
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const p = customClient
      .get<Deployment>(`deployments/${id}`)
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

  activeInstanceCount(d: Deployment): number {
    // A deployment commonly bundles multiple process definitions - d.key/d.version alone
    // (a single pair) can't represent that, so match against every definition it contains
    // rather than just the deployment's own top-level key/version.
    const defKeys = new Set(d.definitions.map((def) => `${def.key}::${def.version}`));
    return this.instances
      .listInstances()
      .filter(
        (p: ProcessInstance) =>
          defKeys.has(`${p.definitionKey}::${p.version}`) && p.status === "active",
      ).length;
  }

  async hydrate(): Promise<void> {
    const list =
      await flowableClient.get<FlowableList<FlowableDeploymentDTO>>("repository/deployments");

    const nextOrder: string[] = list.data.map((d) => d.id);
    const nextSummaries = new Map<string, Deployment>();
    const needsFallback: string[] = [];
    for (const dto of list.data) {
      const summary = mapDeployment(dto);
      if (summary) nextSummaries.set(dto.id, summary);
      else needsFallback.push(dto.id);
    }

    if (needsFallback.length > 0) {
      const results = await Promise.all(
        needsFallback.map((id) =>
          customClient.get<Deployment>(`deployments/${id}`).catch(() => undefined),
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
    notifyStoreChanged();
  }
}
