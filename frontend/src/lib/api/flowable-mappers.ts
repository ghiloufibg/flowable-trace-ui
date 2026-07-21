/**
 * Real Flowable REST v7.1 response shapes (flowable-spring-boot-starter-process-rest).
 *
 * Field names here were extracted directly from the deployed backend's actual DTO classes
 * (org.flowable.rest.service.api.*), not guessed - see
 * claudedocs/backend-library-design.md §12. Every repository always calls the matching
 * /custom/* enrichment endpoint for the full domain object; these interfaces only carry the
 * fields repositories need to construct that follow-up request (id, or key+version), plus the
 * rest of the real shape for documentation.
 *
 * `_domain` is an optional escape hatch: if a future backend summary endpoint embeds the full
 * mapped domain object directly on the list DTO, repositories pick it up for free and skip the
 * per-id enrichment call. No real Flowable REST response sets this today - every `map*` below
 * returns `undefined` against the real backend, which is the correct, intentional behavior
 * until that summary endpoint exists (see claudedocs/known-limitations.md).
 */

import type { Deployment, EngineJob, ProcessDefinition, ProcessInstance } from "@/lib/types";

export interface FlowableList<T> {
  data: T[];
  total: number;
  start: number;
  sort: string;
  order: string;
  size: number;
}

export interface FlowableProcessInstanceDTO {
  id: string;
  url: string;
  name?: string;
  businessKey?: string;
  businessStatus?: string;
  suspended: boolean;
  ended: boolean;
  processDefinitionId: string;
  processDefinitionUrl: string;
  processDefinitionName?: string;
  processDefinitionDescription?: string;
  activityId?: string;
  startUserId?: string;
  startTime: string;
  superProcessInstanceId?: string;
  tenantId?: string;
  completed: boolean;
  _domain?: ProcessInstance;
}

export interface FlowableDeploymentDTO {
  id: string;
  name?: string;
  deploymentTime: string;
  category?: string;
  parentDeploymentId?: string;
  url: string;
  tenantId?: string;
  _domain?: Deployment;
}

export interface FlowableProcessDefinitionDTO {
  id: string;
  url: string;
  key: string;
  version: number;
  name?: string;
  tenantId?: string;
  deploymentId: string;
  deploymentUrl: string;
  category?: string;
  resource: string;
  description?: string;
  diagramResource?: string;
  graphicalNotationDefined: boolean;
  suspended: boolean;
  startFormDefined: boolean;
  _domain?: ProcessDefinition;
}

export interface FlowableJobDTO {
  id: string;
  url: string;
  correlationId?: string;
  processInstanceId?: string;
  processInstanceUrl?: string;
  processDefinitionId?: string;
  processDefinitionUrl?: string;
  executionId?: string;
  executionUrl?: string;
  elementId?: string;
  elementName?: string;
  handlerType?: string;
  retries: number;
  exceptionMessage?: string;
  dueDate?: string;
  createTime: string;
  lockOwner?: string;
  lockExpirationTime?: string;
  tenantId?: string;
  _domain?: EngineJob;
}

/**
 * Pass through `_domain` when a list DTO carries it (a future summary endpoint), otherwise
 * `undefined` so the caller falls back to per-id enrichment. See the module doc comment.
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
