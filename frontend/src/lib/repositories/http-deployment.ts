/**
 * HTTP-backed DeploymentRepository — synchronous reads against an in-memory
 * cache, async hydrate() against Flowable REST + custom enrichment.
 */

import type { DeploymentRepository } from "@/lib/store";
import type { Deployment, ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import {
  mapDeployment,
  type FlowableList,
  type FlowableDeploymentDTO,
} from "@/lib/api/flowable-mappers";
import type { HttpInstanceRepository } from "@/lib/repositories/http-instance";

export class HttpDeploymentRepository implements DeploymentRepository {
  private byId = new Map<string, Deployment>();
  private order: string[] = [];

  constructor(private readonly instances: Pick<HttpInstanceRepository, "listInstances">) {}

  seed(items: Deployment[]): void {
    this.byId.clear();
    this.order = [];
    for (const d of items) {
      this.byId.set(d.id, d);
      this.order.push(d.id);
    }
  }

  listDeployments(): Deployment[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  getDeployment(id: string): Deployment | undefined {
    return this.byId.get(id);
  }

  activeInstanceCount(d: Deployment): number {
    return this.instances
      .listInstances()
      .filter((p: ProcessInstance) => p.definitionKey === d.key && p.version === d.version && p.status === "active")
      .length;
  }

  async hydrate(): Promise<void> {
    const list = await flowableClient.get<FlowableList<FlowableDeploymentDTO>>(
      "repository/deployments",
    );

    const nextOrder: string[] = [];
    const nextMap = new Map<string, Deployment>();

    await Promise.all(
      list.data.map(async (dto) => {
        nextOrder.push(dto.id);
        const domain =
          mapDeployment(dto) ??
          (await customClient.get<Deployment>(`deployments/${dto.id}`));
        nextMap.set(dto.id, domain);
      }),
    );

    this.byId = nextMap;
    this.order = nextOrder;
  }
}
