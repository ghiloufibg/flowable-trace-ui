/**
 * Process definitions repository — derives definitions from deployments and
 * cross-references live instances. A definition is one executable process
 * inside a deployment; each (key, version) is unique.
 */

import { INSTANCES, type ProcessInstance } from "@/lib/mock-data";
import { listDeployments } from "@/lib/deployments";

export interface ProcessDefinition {
  id: string; // "<key>:<version>:<seq>"
  key: string;
  name: string;
  version: number;
  tenantId: string;
  deploymentId: string;
  deploymentName: string;
  deployedAt: string;
  deployedBy: string;
  isSuspended: boolean;
  isExecutable: boolean;
  hasStartForm: boolean;
  category?: string;
  resource: string;
}

const DEFINITIONS: ProcessDefinition[] = (() => {
  const out: ProcessDefinition[] = [];
  let seq = 0;
  for (const dep of listDeployments()) {
    for (const def of dep.definitions) {
      if (def.kind !== "bpmn") continue;
      seq += 1;
      out.push({
        id: `${def.key}:${def.version}:${seq * 17}`,
        key: def.key,
        name: def.name,
        version: def.version,
        tenantId: dep.tenantId,
        deploymentId: dep.id,
        deploymentName: dep.name,
        deployedAt: dep.deployedAt,
        deployedBy: dep.deployedBy,
        isSuspended: false,
        isExecutable: true,
        hasStartForm: seq % 3 === 0,
        category: dep.tenantId === "acme" ? "billing" : "core",
        resource: `${def.key}.bpmn20.xml`,
      });
    }
  }
  return out;
})();

export function listDefinitions(): ProcessDefinition[] {
  // Latest version per key
  const latest = new Map<string, ProcessDefinition>();
  for (const d of DEFINITIONS) {
    const cur = latest.get(d.key);
    if (!cur || d.version > cur.version) latest.set(d.key, d);
  }
  return Array.from(latest.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function listDefinitionVersions(key: string): ProcessDefinition[] {
  return DEFINITIONS.filter((d) => d.key === key).sort((a, b) => b.version - a.version);
}

export function getDefinition(key: string, version: number): ProcessDefinition | undefined {
  return DEFINITIONS.find((d) => d.key === key && d.version === version);
}

export function instancesForDefinition(key: string, version?: number): ProcessInstance[] {
  return INSTANCES.filter(
    (p) => p.definitionKey === key && (version === undefined || p.version === version),
  );
}

export function activeCountForDefinition(key: string, version?: number): number {
  return instancesForDefinition(key, version).filter((p) => p.status === "active").length;
}

/** Total versions available for a definition key. */
export function versionCount(key: string): number {
  return DEFINITIONS.filter((d) => d.key === key).length;
}

/**
 * Pick a representative ProcessInstance to render the diagram for a definition.
 * Falls back across versions if the requested one has none.
 */
export function templateInstanceFor(key: string, version: number): ProcessInstance | undefined {
  return (
    instancesForDefinition(key, version)[0] ??
    instancesForDefinition(key)[0]
  );
}
