/**
 * HTTP-backed InstanceRepository.
 *
 * Two caches:
 *   - `summaries` — filled by hydrate() from Flowable REST's list endpoints
 *     (active runtime + historic, merged so ended/failed instances aren't
 *     silently absent). Fast path: if a list DTO carries `_domain` (a future
 *     backend summary endpoint), it's used directly with no extra fetch.
 *   - `details`   — filled lazily by `ensureInstance(id)` from
 *     /custom/instances/:id, and preserved across hydrate() calls so
 *     previously-opened pages stay warm.
 *
 * `getInstance(id)` returns whichever cache has the entity (detail wins).
 *
 * Fallback: today's real backend never sets `_domain` (no summary endpoint
 * exists yet - see claudedocs/known-limitations.md), so every id currently
 * takes the fallback path: a per-id fetch to /custom/instances/:id, same
 * request this repository always made before this restructuring. Behavior
 * is unchanged until a summary endpoint exists; this only adds a warm-detail
 * cache across repeated hydrate() calls and gives ensureInstance(id) a place
 * to fetch entities that weren't part of the last hydrate.
 */

import type { InstanceRepository } from "@/lib/store";
import { notifyStoreChanged } from "@/lib/store";
import type { ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import {
  mapProcessInstance,
  type FlowableList,
  type FlowableProcessInstanceDTO,
} from "@/lib/api/flowable-mappers";

// Only the `id` field is read from this response - the rest of
// HistoricProcessInstanceResponse's real shape isn't needed here since the
// full domain object always comes from the /custom/instances/:id follow-up
// fetch, same as the active-instance list.
interface FlowableHistoricProcessInstanceDTO {
  id: string;
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
    // Merge active runtime + historic so ended/failed instances still
    // appear (runtime/process-instances alone only returns active ones).
    const [active, historic] = await Promise.all([
      flowableClient.get<FlowableList<FlowableProcessInstanceDTO>>("runtime/process-instances"),
      flowableClient.get<FlowableList<FlowableHistoricProcessInstanceDTO>>(
        "history/historic-process-instances",
      ),
    ]);

    const dtoById = new Map<string, FlowableProcessInstanceDTO>();
    for (const dto of active.data) dtoById.set(dto.id, dto);
    const nextOrder = Array.from(new Set([...active.data.map((d) => d.id), ...historic.data.map((d) => d.id)]));

    const nextSummaries = new Map<string, ProcessInstance>();
    const needsFallback: string[] = [];
    for (const id of nextOrder) {
      const dto = dtoById.get(id);
      const summary = dto ? mapProcessInstance(dto) : undefined;
      if (summary) nextSummaries.set(id, summary);
      else needsFallback.push(id);
    }

    if (needsFallback.length > 0) {
      const results = await Promise.all(
        needsFallback.map((id) =>
          customClient.get<ProcessInstance>(`instances/${id}`).catch(() => undefined),
        ),
      );
      results.forEach((full, i) => {
        if (!full) return;
        const id = needsFallback[i];
        nextSummaries.set(id, full);
        // Full object serves as a warm detail cache entry too.
        this.details.set(id, full);
      });
    }

    this.summaries = nextSummaries;
    this.order = nextOrder;
    notifyStoreChanged();
  }
}
