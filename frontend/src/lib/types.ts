/**
 * Domain types re-exported from the mock implementation modules.
 *
 * Components and routes should import types from here (via `@/lib/types` or
 * `@/lib/store`, which re-exports them) rather than from the mock modules
 * directly. When the backend integration lands, only the underlying
 * definitions move — call sites keep the same import path.
 */

export type {
  NodeState,
  BpmnNodeType,
  BpmnNode,
  BpmnEdge,
  VariableChange,
  Variable,
  TaskItem,
  TrailEntry,
  JobItem,
  ProcessInstance,
} from "@/lib/mock-data";

export type {
  DefinitionKind,
  DeploymentSource,
  DeploymentResource,
  DeploymentDefinition,
  DeploymentActivity,
  Deployment,
} from "@/lib/deployments";

export type { ProcessDefinition } from "@/lib/definitions";

export type { JobKind, JobAttempt, EngineJob } from "@/lib/jobs";
