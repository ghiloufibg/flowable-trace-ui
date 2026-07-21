/**
 * HTTP-backed DefinitionRepository.
 *
 * ProcessDefinitions come from Flowable REST /repository/process-definitions,
 * which already carries key/version/name/tenantId/suspended directly - real
 * fields, not a summary-endpoint invention. `ensureDefinition` is a lazy
 * fallback for deep links to a version that wasn't part of the last
 * hydrated list.
 *
 * The "template instance" (used to render a diagram on the definition
 * detail page) is lazy too: it lives on the instance repository's detail
 * cache, fetched via `instances.ensureInstance` through
 * `ensureTemplateInstance`.
 */

import type { DefinitionRepository } from "@/lib/store";
import { notifyStoreChanged } from "@/lib/store";
import type { ProcessDefinition, ProcessInstance } from "@/lib/types";
import { customClient, flowableClient } from "@/lib/api/client";
import {
  mapProcessDefinition,
  type FlowableList,
  type FlowableProcessDefinitionDTO,
} from "@/lib/api/flowable-mappers";
import type { HttpInstanceRepository } from "@/lib/repositories/http-instance";

export class HttpDefinitionRepository implements DefinitionRepository {
  private all: ProcessDefinition[] = [];
  private detailInFlight = new Map<string, Promise<ProcessDefinition>>();
  private templateInFlight = new Map<string, Promise<ProcessInstance | undefined>>();

  constructor(
    private readonly instances: Pick<HttpInstanceRepository, "listInstances" | "getInstance" | "ensureInstance">,
  ) {}

  seed(items: ProcessDefinition[]): void {
    this.all = items;
    notifyStoreChanged();
  }

  listDefinitions(): ProcessDefinition[] {
    const latest = new Map<string, ProcessDefinition>();
    for (const d of this.all) {
      const cur = latest.get(d.key);
      if (!cur || d.version > cur.version) latest.set(d.key, d);
    }
    return Array.from(latest.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listDefinitionVersions(key: string): ProcessDefinition[] {
    return this.all.filter((d) => d.key === key).sort((a, b) => b.version - a.version);
  }

  getDefinition(key: string, version: number): ProcessDefinition | undefined {
    return this.all.find((d) => d.key === key && d.version === version);
  }

  async ensureDefinition(key: string, version: number): Promise<ProcessDefinition> {
    const cached = this.getDefinition(key, version);
    if (cached) return cached;
    const cacheKey = `${key}/${version}`;
    const existing = this.detailInFlight.get(cacheKey);
    if (existing) return existing;
    const p = customClient
      .get<ProcessDefinition>(`definitions/${key}/${version}`)
      .then((def) => {
        if (!this.getDefinition(def.key, def.version)) this.all.push(def);
        this.detailInFlight.delete(cacheKey);
        notifyStoreChanged();
        return def;
      })
      .catch((err) => {
        this.detailInFlight.delete(cacheKey);
        throw err;
      });
    this.detailInFlight.set(cacheKey, p);
    return p;
  }

  instancesForDefinition(key: string, version?: number): ProcessInstance[] {
    return this.instances
      .listInstances()
      .filter((p) => p.definitionKey === key && (version === undefined || p.version === version));
  }

  activeCountForDefinition(key: string, version?: number): number {
    return this.instancesForDefinition(key, version).filter((p) => p.status === "active").length;
  }

  versionCount(key: string): number {
    return this.all.filter((d) => d.key === key).length;
  }

  templateInstanceFor(key: string, version: number): ProcessInstance | undefined {
    const candidate =
      this.instancesForDefinition(key, version)[0] ?? this.instancesForDefinition(key)[0];
    if (!candidate) return undefined;
    // Prefer the full detail if it's already cached - a summary-only object
    // won't have nodes/edges, and the diagram needs them.
    const full = this.instances.getInstance(candidate.id);
    return full && full.nodes.length > 0 ? full : candidate;
  }

  async ensureTemplateInstance(key: string, version: number): Promise<ProcessInstance | undefined> {
    const candidate =
      this.instancesForDefinition(key, version)[0] ?? this.instancesForDefinition(key)[0];
    if (!candidate) return undefined;
    const cacheKey = `${key}/${version}/${candidate.id}`;
    const existing = this.templateInFlight.get(cacheKey);
    if (existing) return existing;
    const p = this.instances
      .ensureInstance(candidate.id)
      .then((full) => {
        this.templateInFlight.delete(cacheKey);
        return full;
      })
      .catch((err) => {
        this.templateInFlight.delete(cacheKey);
        throw err;
      });
    this.templateInFlight.set(cacheKey, p);
    return p;
  }

  async hydrate(): Promise<void> {
    const list = await flowableClient.get<FlowableList<FlowableProcessDefinitionDTO>>(
      "repository/process-definitions",
    );
    const next: ProcessDefinition[] = [];
    const needsFallback: FlowableProcessDefinitionDTO[] = [];
    for (const dto of list.data) {
      const domain = mapProcessDefinition(dto);
      if (domain) next.push(domain);
      else needsFallback.push(dto);
    }
    if (needsFallback.length > 0) {
      const results = await Promise.all(
        needsFallback.map((dto) =>
          customClient
            .get<ProcessDefinition>(`definitions/${dto.key}/${dto.version}`)
            .catch(() => undefined),
        ),
      );
      for (const def of results) if (def) next.push(def);
    }
    this.all = next;
    notifyStoreChanged();
  }
}
