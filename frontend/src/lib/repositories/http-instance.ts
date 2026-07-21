/**
 * HTTP-backed InstanceRepository.
 *
 * Two caches:
 *   - `summaries` — filled by hydrate() from the backend's bulk summary
 *     endpoint (`GET custom/instances` — see
 *     claudedocs/design-instance-summary-endpoint.md), one request covering
 *     every instance's list-row fields (including `activeActivities`/
 *     `failedJobCount`) with no BPMN parsing or per-id enrichment.
 *   - `details`   — filled lazily by `ensureInstance(id)` from
 *     /custom/instances/:id, and preserved across hydrate() calls so
 *     previously-opened pages stay warm.
 *
 * `getInstance(id)` returns whichever cache has the entity (detail wins).
 *
 * Fallback: if the summary endpoint call fails outright (e.g. an older
 * backend build that predates it, surfaced as a 404), hydrate() falls back
 * to the original approach — merge Flowable's own runtime + historic list
 * endpoints, then fully enrich every instance via /custom/instances/:id.
 * Correct either way, just slower on the fallback path. This is a whole-
 * request fallback (endpoint exists or it doesn't), not a per-item one —
 * the summary endpoint answers in one response, so there's no scenario
 * where only some instances in it are missing summary data.
 */

import type { InstanceRepository } from "@/lib/store";
import { notifyStoreChanged } from "@/lib/store";
import type { BpmnNode, ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import type { FlowableList, FlowableProcessInstanceDTO } from "@/lib/api/flowable-mappers";

// Only the `id` field is read from this response - the rest of
// HistoricProcessInstanceResponse's real shape isn't needed here since the
// full domain object always comes from the /custom/instances/:id follow-up
// fetch, same as the active-instance list.
interface FlowableHistoricProcessInstanceDTO {
  id: string;
}

// Mirrors the backend's ProcessInstanceSummaryDto (see
// io.ghiloufi.flowable.rest.dto.ProcessInstanceSummaryDto) field-for-field.
interface ProcessInstanceSummaryDto {
  id: string;
  definitionKey: string;
  definitionName: string;
  version: number;
  businessKey: string;
  status: ProcessInstance["status"];
  startedAt: string;
  endedAt?: string;
  startedBy: string;
  deployedAt?: string;
  parentInstanceId?: string;
  activeActivities: BpmnNode[];
  failedJobCount: number;
}

function toProcessInstance(s: ProcessInstanceSummaryDto): ProcessInstance {
  return {
    id: s.id,
    definitionKey: s.definitionKey,
    definitionName: s.definitionName,
    version: s.version,
    businessKey: s.businessKey,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    startedBy: s.startedBy,
    deployedAt: s.deployedAt ?? "",
    parentInstanceId: s.parentInstanceId,
    nodes: [],
    edges: [],
    variables: [],
    tasks: [],
    trail: [],
    jobs: [],
    activeActivities: s.activeActivities,
    failedJobCount: s.failedJobCount,
  };
}

export class HttpInstanceRepository implements InstanceRepository {
  private summaries = new Map<string, ProcessInstance>();
  private details = new Map<string, ProcessInstance>();
  private inFlight = new Map<string, Promise<ProcessInstance>>();
  private order: string[] = [];

  seed(items: ProcessInstance[]): void {
    this.summaries.clear();
    this.details.clear();
    this.order = [];
    for (const p of items) {
      this.details.set(p.id, p);
      this.order.push(p.id);
    }
    notifyStoreChanged();
  }

  listInstances(): ProcessInstance[] {
    return this.order
      .map((id) => this.details.get(id) ?? this.summaries.get(id)!)
      .filter(Boolean);
  }

  getInstance(id: string): ProcessInstance | undefined {
    return this.details.get(id) ?? this.summaries.get(id);
  }

  async ensureInstance(id: string): Promise<ProcessInstance> {
    const cached = this.details.get(id);
    if (cached) return cached;
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const p = customClient
      .get<ProcessInstance>(`instances/${id}`)
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

  async hydrate(): Promise<void> {
    let summaries: ProcessInstanceSummaryDto[];
    try {
      summaries = await customClient.get<ProcessInstanceSummaryDto[]>("instances");
    } catch {
      await this.hydrateViaLegacyFallback();
      return;
    }

    const nextOrder = summaries.map((s) => s.id);
    const nextSummaries = new Map<string, ProcessInstance>();
    for (const s of summaries) nextSummaries.set(s.id, toProcessInstance(s));

    this.summaries = nextSummaries;
    this.order = nextOrder;
    // Details cache is preserved so previously-opened pages stay warm.
    notifyStoreChanged();
  }

  /**
   * Pre-summary-endpoint behavior: merge Flowable's own runtime + historic
   * list endpoints (so ended/failed instances aren't silently absent), then
   * fully enrich every instance via /custom/instances/:id. Only reached when
   * the summary endpoint request itself fails (e.g. an older backend build).
   */
  private async hydrateViaLegacyFallback(): Promise<void> {
    const [active, historic] = await Promise.all([
      flowableClient.get<FlowableList<FlowableProcessInstanceDTO>>("runtime/process-instances"),
      flowableClient.get<FlowableList<FlowableHistoricProcessInstanceDTO>>(
        "history/historic-process-instances",
      ),
    ]);

    const nextOrder = Array.from(
      new Set([...active.data.map((d) => d.id), ...historic.data.map((d) => d.id)]),
    );

    const results = await Promise.all(
      nextOrder.map((id) => customClient.get<ProcessInstance>(`instances/${id}`).catch(() => undefined)),
    );
    const nextSummaries = new Map<string, ProcessInstance>();
    results.forEach((full, i) => {
      if (!full) return;
      const id = nextOrder[i];
      nextSummaries.set(id, full);
      this.details.set(id, full);
    });

    this.summaries = nextSummaries;
    this.order = nextOrder;
    notifyStoreChanged();
  }
}
