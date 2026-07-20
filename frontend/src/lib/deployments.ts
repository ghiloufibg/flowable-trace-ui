/**
 * Mock deployment repository — mirrors the shape of `store.ts` for instances.
 * A deployment is a bundle of resources (BPMN/DMN/form/image) that produced
 * one or more process/case/decision definitions.
 */

import { INSTANCES } from "@/lib/mock-data";

export type DefinitionKind = "bpmn" | "dmn" | "cmmn";
export type DeploymentSource = "upload" | "api" | "designer";

export interface DeploymentResource {
  name: string;
  kind: DefinitionKind | "form" | "image" | "other";
  sizeBytes: number;
  preview?: string; // small text snippet for BPMN/DMN/form
}

export interface DeploymentDefinition {
  id: string;
  kind: DefinitionKind;
  name: string;
  key: string;
  version: number;
}

export interface DeploymentActivity {
  at: string;
  kind: "created" | "superseded" | "instance-started" | "delete-attempted";
  detail: string;
}

export interface Deployment {
  id: string;
  name: string;
  key: string;
  version: number;
  tenantId: string;
  source: DeploymentSource;
  deployedAt: string;
  deployedBy: string;
  resources: DeploymentResource[];
  definitions: DeploymentDefinition[];
  activity: DeploymentActivity[];
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// Small illustrative BPMN preview snippet
const bpmnPreview = (procKey: string, procName: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://flowable.org/${procKey}">
  <process id="${procKey}" name="${procName}" isExecutable="true">
    <startEvent id="start" name="Started" />
    <!-- … full model omitted in preview … -->
    <endEvent id="end" name="Done" />
  </process>
</definitions>`;

/** Build the mock deployment list, deriving definitions from live instances. */
function buildDeployments(): Deployment[] {
  const byKey = new Map<string, { name: string; version: number; deployedAt: string }>();
  for (const p of INSTANCES) {
    const cur = byKey.get(p.definitionKey);
    if (!cur || p.version > cur.version) {
      byKey.set(p.definitionKey, {
        name: p.definitionName,
        version: p.version,
        deployedAt: p.deployedAt,
      });
    }
  }

  const seed: Deployment[] = Array.from(byKey.entries()).map(([key, meta], idx) => {
    const id = `DEP-${(0xa10000 + idx * 733).toString(16)}`;
    const preview = bpmnPreview(key, meta.name);
    const instances = INSTANCES.filter((p) => p.definitionKey === key);
    return {
      id,
      name: `${meta.name} deployment`,
      key,
      version: meta.version,
      tenantId: idx % 3 === 0 ? "acme" : "default",
      source: (idx % 3 === 0 ? "designer" : idx % 3 === 1 ? "upload" : "api") as DeploymentSource,
      deployedAt: meta.deployedAt,
      deployedBy: idx % 2 === 0 ? "ci-pipeline@svc" : "sarah.chen",
      resources: [
        { name: `${key}.bpmn20.xml`, kind: "bpmn", sizeBytes: 4200 + idx * 130, preview },
        { name: `${key}-form.form`, kind: "form", sizeBytes: 812, preview: `{ "key": "${key}-form", "fields": [] }` },
        { name: `${key}-icon.png`, kind: "image", sizeBytes: 3480 },
      ],
      definitions: [
        {
          id: `${key}:${meta.version}:${(idx + 1) * 17}`,
          kind: "bpmn",
          name: meta.name,
          key,
          version: meta.version,
        },
      ],
      activity: ([
        { at: meta.deployedAt, kind: "created" as const, detail: `Deployed by ${idx % 2 === 0 ? "ci-pipeline@svc" : "sarah.chen"}` },
        ...(meta.version > 1
          ? [{ at: iso(1000 * 60 * 60 * 24 * (30 + idx)), kind: "superseded" as const, detail: `Replaced v${meta.version - 1}` }]
          : []),
        ...instances.slice(0, 3).map((p) => ({
          at: p.startedAt,
          kind: "instance-started" as const,
          detail: `Instance ${p.businessKey} started`,
        })),
      ] as DeploymentActivity[]).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    };
  });

  // A couple of older superseded deployments for the same keys, to make version history real
  const older: Deployment[] = seed
    .filter((d) => d.version > 1)
    .slice(0, 2)
    .map((d, i) => ({
      ...d,
      id: `DEP-${(0xb20000 + i * 511).toString(16)}`,
      version: d.version - 1,
      deployedAt: iso(1000 * 60 * 60 * 24 * (45 + i * 10)),
      deployedBy: "release-bot@svc",
      activity: [
        {
          at: iso(1000 * 60 * 60 * 24 * (45 + i * 10)),
          kind: "created" as const,
          detail: "Deployed by release-bot@svc",
        },
        {
          at: iso(1000 * 60 * 60 * 24 * (10 + i * 3)),
          kind: "superseded" as const,
          detail: `Superseded by v${d.version}`,
        },
      ],
    }));

  return [...seed, ...older].sort(
    (a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
  );
}

const DEPLOYMENTS: Deployment[] = buildDeployments();

export function listDeployments(): Deployment[] {
  return DEPLOYMENTS;
}

export function getDeployment(id: string): Deployment | undefined {
  return DEPLOYMENTS.find((d) => d.id === id);
}

export function activeInstanceCount(d: Deployment): number {
  return INSTANCES.filter(
    (p) => p.definitionKey === d.key && p.version === d.version && p.status === "active",
  ).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
