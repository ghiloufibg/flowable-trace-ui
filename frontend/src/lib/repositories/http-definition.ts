/**
 * HTTP-backed DefinitionRepository.
 *
 * Definitions come from Flowable REST /repository/process-definitions. The
 * grouping/aggregation helpers (versions, active counts, template instance)
 * are backed by /custom/* endpoints since Flowable REST doesn't expose them
 * directly.
 */

import type { DefinitionRepository } from "@/lib/store";
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

  constructor(private readonly instances: Pick<HttpInstanceRepository, "listInstances" | "getInstance">) {}

  seed(items: ProcessDefinition[]): void {
    this.all = items;
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
    return this.instancesForDefinition(key, version)[0] ?? this.instancesForDefinition(key)[0];
  }

  async hydrate(): Promise<void> {
    const list = await flowableClient.get<FlowableList<FlowableProcessDefinitionDTO>>(
      "repository/process-definitions",
    );
    const next: ProcessDefinition[] = [];
    await Promise.all(
      list.data.map(async (dto) => {
        const domain =
          mapProcessDefinition(dto) ??
          (await customClient.get<ProcessDefinition>(`definitions/${dto.key}/${dto.version}`));
        next.push(domain);
      }),
    );
    this.all = next;
  }
}
