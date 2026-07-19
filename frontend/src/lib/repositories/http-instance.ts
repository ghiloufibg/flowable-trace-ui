/**
 * HTTP-backed InstanceRepository.
 *
 * Reads are synchronous against an in-memory cache. Callers (routes,
 * components) never change shape. The cache is filled two ways:
 *   1. `seed(instances)` — synchronous seed used by store-bootstrap to
 *      guarantee first paint has data.
 *   2. `hydrate()` — async refresh: list ids from the real Flowable REST
 *      endpoint(s), then a /custom/instances/:id fetch per instance for the
 *      full BPMN graph (nodes/edges/variables/trail/tasks/jobs) that
 *      Flowable REST doesn't return directly.
 *
 * `runtime/process-instances` alone only returns currently-active instances
 * (standard Flowable REST behavior) - hydrate() also calls
 * `history/historic-process-instances`, which covers both running and ended
 * instances, so ended ones are no longer silently absent from every list and
 * every direct link.
 */

import type { InstanceRepository } from "@/lib/store";
import type { ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import type { FlowableList, FlowableProcessInstanceDTO } from "@/lib/api/flowable-mappers";

// Only the `id` field is read from this response - the rest of
// HistoricProcessInstanceResponse's real shape isn't needed here since the
// full domain object always comes from the /custom/instances/:id follow-up
// fetch below, same as the active-instance list.
interface FlowableHistoricProcessInstanceDTO {
  id: string;
}

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
    const [active, historic] = await Promise.all([
      flowableClient.get<FlowableList<FlowableProcessInstanceDTO>>("runtime/process-instances"),
      flowableClient.get<FlowableList<FlowableHistoricProcessInstanceDTO>>(
        "history/historic-process-instances",
      ),
    ]);

    const ids = new Set<string>();
    for (const dto of active.data) ids.add(dto.id);
    for (const dto of historic.data) ids.add(dto.id);

    const nextOrder: string[] = [];
    const nextMap = new Map<string, ProcessInstance>();

    await Promise.all(
      Array.from(ids).map(async (id) => {
        nextOrder.push(id);
        const domain = await customClient.get<ProcessInstance>(`instances/${id}`);
        nextMap.set(id, domain);
      }),
    );

    this.byId = nextMap;
    this.order = nextOrder;
  }
}
