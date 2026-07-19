/**
 * HTTP-backed InstanceRepository.
 *
 * Reads are synchronous against an in-memory cache. Callers (routes,
 * components) never change shape. The cache is filled two ways:
 *   1. `seed(instances)` — synchronous seed used by store-bootstrap to
 *      guarantee first paint has data.
 *   2. `hydrate()` — async refresh: list ids from the real Flowable REST
 *      endpoint, then a /custom/instances/:id fetch per instance for the
 *      full BPMN graph (nodes/edges/variables/trail/tasks/jobs) that
 *      Flowable REST doesn't return directly.
 */

import type { InstanceRepository } from "@/lib/store";
import type { ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import type { FlowableList, FlowableProcessInstanceDTO } from "@/lib/api/flowable-mappers";

export class HttpInstanceRepository implements InstanceRepository {
  private byId = new Map<string, ProcessInstance>();
  private order: string[] = [];

  seed(items: ProcessInstance[]): void {
    this.byId.clear();
    this.order = [];
    for (const p of items) {
      this.byId.set(p.id, p);
      this.order.push(p.id);
    }
  }

  listInstances(): ProcessInstance[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  getInstance(id: string): ProcessInstance | undefined {
    return this.byId.get(id);
  }

  async hydrate(): Promise<void> {
    const list = await flowableClient.get<FlowableList<FlowableProcessInstanceDTO>>(
      "runtime/process-instances",
    );

    const nextOrder: string[] = [];
    const nextMap = new Map<string, ProcessInstance>();

    await Promise.all(
      list.data.map(async (dto) => {
        nextOrder.push(dto.id);
        const domain = await customClient.get<ProcessInstance>(`instances/${dto.id}`);
        nextMap.set(dto.id, domain);
      }),
    );

    this.byId = nextMap;
    this.order = nextOrder;
  }
}
