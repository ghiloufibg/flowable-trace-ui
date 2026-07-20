/**
 * Local mock backend for the Flowable Console.
 *
 * Splits into two namespaces:
 *   - /api/mock/flowable/*  → shapes matching Flowable REST API v7.x
 *   - /api/mock/custom/*    → domain-shaped payloads for things Flowable
 *                             cannot return out of the box (full BPMN graph,
 *                             enriched trail, aggregated KPIs, …)
 *
 * Repositories in src/lib/repositories/http-* consume these endpoints. To
 * switch to a real backend, point VITE_FLOWABLE_API_URL / VITE_CUSTOM_API_URL
 * at your services; endpoint paths and JSON shapes below are the contract.
 */

import { createFileRoute } from "@tanstack/react-router";

import { INSTANCES } from "@/lib/mock-data";
import { listDeployments, getDeployment } from "@/lib/deployments";
import {
  listDefinitions,
  listDefinitionVersions,
  getDefinition,
  instancesForDefinition,
  activeCountForDefinition,
  versionCount,
  templateInstanceFor,
} from "@/lib/definitions";
import {
  listJobs,
  getJob,
  jobsForInstance,
  deadLetterCount,
  jobHealth,
} from "@/lib/jobs";

/* -------------------------------------------------------------------------- */
/* Flowable REST shape mappers (mock server side)                             */
/* -------------------------------------------------------------------------- */

function toFlowableProcessInstance(p: (typeof INSTANCES)[number]) {
  return {
    id: p.id,
    businessKey: p.businessKey,
    processDefinitionId: `${p.definitionKey}:${p.version}:${p.id}`,
    processDefinitionKey: p.definitionKey,
    processDefinitionName: p.definitionName,
    processDefinitionVersion: p.version,
    startTime: p.startedAt,
    endTime: p.endedAt,
    startUserId: p.startedBy,
    ended: p.status === "ended",
    suspended: false,
    // Custom extension: not part of Flowable REST — signals to mapper that a
    // richer detail endpoint is available under /custom/instances/:id.
    _customDetailUrl: `/instances/${p.id}`,
    // Retained so a mock consumer can rebuild the domain object without a
    // second round-trip. Real backend would omit this.
    _domain: p,
  };
}

function toFlowableDeployment(d: ReturnType<typeof listDeployments>[number]) {
  return {
    id: d.id,
    name: d.name,
    category: d.key,
    deploymentTime: d.deployedAt,
    tenantId: d.tenantId,
    _domain: d,
  };
}

function toFlowableProcessDefinition(d: ReturnType<typeof listDefinitions>[number]) {
  return {
    id: d.id,
    name: d.name,
    key: d.key,
    version: d.version,
    deploymentId: d.deploymentId,
    tenantId: d.tenantId,
    suspended: d.isSuspended,
    _domain: d,
  };
}

function toFlowableJob(j: ReturnType<typeof listJobs>[number]) {
  const flowableType =
    j.type === "timer" ? "timer-job"
    : j.type === "deadletter" ? "deadletter-job"
    : "job";
  return {
    id: j.id,
    jobType: flowableType,
    processInstanceId: j.instanceId,
    processDefinitionId: `${j.definitionKey}:${j.version}`,
    elementId: j.activityId,
    elementName: j.activityName,
    createTime: j.createdAt,
    dueDate: j.dueDate,
    retries: j.retries,
    exceptionMessage: j.exceptionMessage,
    _domain: j,
  };
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

const JSON_HEADERS = { "content-type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function notFound(): Response {
  return json({ message: "not found" }, 404);
}

function handle(path: string, url: URL): Response {
  // ---- Flowable REST shape -------------------------------------------------
  if (path === "flowable/runtime/process-instances") {
    return json({ data: INSTANCES.map(toFlowableProcessInstance), total: INSTANCES.length });
  }
  {
    const m = /^flowable\/runtime\/process-instances\/([^/]+)$/.exec(path);
    if (m) {
      const p = INSTANCES.find((x) => x.id === m[1]);
      return p ? json(toFlowableProcessInstance(p)) : notFound();
    }
  }
  if (path === "flowable/repository/deployments") {
    const all = listDeployments();
    return json({ data: all.map(toFlowableDeployment), total: all.length });
  }
  {
    const m = /^flowable\/repository\/deployments\/([^/]+)$/.exec(path);
    if (m) {
      const d = getDeployment(m[1]);
      return d ? json(toFlowableDeployment(d)) : notFound();
    }
  }
  if (path === "flowable/repository/process-definitions") {
    const all = listDefinitions();
    return json({ data: all.map(toFlowableProcessDefinition), total: all.length });
  }
  if (path === "flowable/management/jobs") {
    const all = listJobs();
    return json({ data: all.map(toFlowableJob), total: all.length });
  }
  {
    const m = /^flowable\/management\/jobs\/([^/]+)$/.exec(path);
    if (m) {
      const j = getJob(m[1]);
      return j ? json(toFlowableJob(j)) : notFound();
    }
  }
  if (path === "flowable/management/deadletter-jobs") {
    const dl = listJobs().filter((j) => j.type === "deadletter");
    return json({ data: dl.map(toFlowableJob), total: dl.length });
  }

  // ---- Custom endpoints (return domain-shape payloads) --------------------
  if (path === "custom/instances") {
    return json(INSTANCES);
  }
  {
    const m = /^custom\/instances\/([^/]+)$/.exec(path);
    if (m) {
      const p = INSTANCES.find((x) => x.id === m[1]);
      return p ? json(p) : notFound();
    }
  }
  if (path === "custom/deployments") {
    return json(listDeployments());
  }
  {
    const m = /^custom\/deployments\/([^/]+)$/.exec(path);
    if (m) {
      const d = getDeployment(m[1]);
      return d ? json(d) : notFound();
    }
  }
  if (path === "custom/definitions") {
    return json(listDefinitions());
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/versions$/.exec(path);
    if (m) return json(listDefinitionVersions(m[1]));
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/([0-9]+)$/.exec(path);
    if (m) {
      const def = getDefinition(m[1], Number(m[2]));
      return def ? json(def) : notFound();
    }
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/([0-9]+)\/template-instance$/.exec(path);
    if (m) {
      const t = templateInstanceFor(m[1], Number(m[2]));
      return json(t ?? null);
    }
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/instances$/.exec(path);
    if (m) {
      const v = url.searchParams.get("version");
      return json(instancesForDefinition(m[1], v ? Number(v) : undefined));
    }
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/active-count$/.exec(path);
    if (m) {
      const v = url.searchParams.get("version");
      return json({ count: activeCountForDefinition(m[1], v ? Number(v) : undefined) });
    }
  }
  {
    const m = /^custom\/definitions\/([^/]+)\/version-count$/.exec(path);
    if (m) return json({ count: versionCount(m[1]) });
  }
  if (path === "custom/jobs") {
    return json(listJobs());
  }
  if (path === "custom/jobs/health") {
    return json({ ...jobHealth(), deadLetterCount: deadLetterCount() });
  }
  {
    const m = /^custom\/jobs\/([^/]+)$/.exec(path);
    if (m) {
      const j = getJob(m[1]);
      return j ? json(j) : notFound();
    }
  }
  {
    const m = /^custom\/jobs\/for-instance\/([^/]+)$/.exec(path);
    if (m) return json(jobsForInstance(m[1]));
  }

  return notFound();
}

export const Route = createFileRoute("/api/mock/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const path = (params._splat ?? "").replace(/^\/+|\/+$/g, "");
        return handle(path, url);
      },
    },
  },
});
