/**
 * Flowable REST v7.x → domain-type mappers.
 *
 * The mock server returns Flowable-shaped payloads that also carry the full
 * domain object under a `_domain` extension key for local convenience. Real
 * Flowable REST responses will NOT carry `_domain` — the repositories are
 * responsible for calling the matching /custom/* endpoint to fetch the
 * enriched detail (BPMN graph, activity trail, variables …). Mappers stay
 * pure so that switching to the real backend is a one-line change per repo.
 */

import type {
  Deployment,
  EngineJob,
  ProcessDefinition,
  ProcessInstance,
} from "@/lib/types";

export interface FlowableList<T> {
  data: T[];
  total: number;
}

export interface FlowableProcessInstanceDTO {
  id: string;
  businessKey?: string;
  processDefinitionKey: string;
  processDefinitionName?: string;
  processDefinitionVersion: number;
  startTime: string;
  endTime?: string;
  startUserId?: string;
  ended: boolean;
  suspended: boolean;
  _domain?: ProcessInstance;
}

export interface FlowableDeploymentDTO {
  id: string;
  name?: string;
  category?: string;
  deploymentTime: string;
  tenantId?: string;
  _domain?: Deployment;
}

export interface FlowableProcessDefinitionDTO {
  id: string;
  key: string;
  name?: string;
  version: number;
  deploymentId: string;
  tenantId?: string;
  suspended: boolean;
  _domain?: ProcessDefinition;
}

export interface FlowableJobDTO {
  id: string;
  jobType: string;
  processInstanceId: string;
  processDefinitionId: string;
  elementId: string;
  elementName?: string;
  createTime: string;
  dueDate?: string;
  retries: number;
  exceptionMessage?: string;
  _domain?: EngineJob;
}

/**
 * These "map*" helpers pass through the mock's `_domain` extension when
 * present. When wiring the real backend, replace each function body with a
 * call to the corresponding /custom/* enrichment endpoint that returns the
 * full domain object (or build it from separate Flowable REST calls to
 * /runtime/variables, /history/historic-activity-instances, etc.).
 */

export function mapProcessInstance(dto: FlowableProcessInstanceDTO): ProcessInstance | undefined {
  return dto._domain;
}

export function mapDeployment(dto: FlowableDeploymentDTO): Deployment | undefined {
  return dto._domain;
}

export function mapProcessDefinition(dto: FlowableProcessDefinitionDTO): ProcessDefinition | undefined {
  return dto._domain;
}

export function mapJob(dto: FlowableJobDTO): EngineJob | undefined {
  return dto._domain;
}
