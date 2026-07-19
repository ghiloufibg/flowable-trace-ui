/**
 * Centralized data store for the Flowable Console.
 *
 * All components and routes read data through the repositories exposed here,
 * never from the underlying mock modules. To connect to a real backend later,
 * implement the repository interfaces against your API and call the matching
 * `set*Repository()` once at app startup (e.g. in `src/router.tsx` or
 * `src/routes/__root.tsx`) — no UI code needs to change.
 *
 * Formatting helpers live in `@/lib/format`. Domain types live in
 * `@/lib/types`. Both are re-exported from this module for convenience so
 * consumers can `import { ..., type ProcessInstance, relativeTime } from
 * "@/lib/store"`.
 */

import { useSyncExternalStore } from "react";
import {
  INSTANCES as MOCK_INSTANCES,
  getInstance as mockGetInstance,
} from "@/lib/mock-data";
import {
  listDeployments as mockListDeployments,
  getDeployment as mockGetDeployment,
  activeInstanceCount as mockActiveInstanceCount,
} from "@/lib/deployments";
import {
  listDefinitions as mockListDefinitions,
  listDefinitionVersions as mockListDefinitionVersions,
  getDefinition as mockGetDefinition,
  instancesForDefinition as mockInstancesForDefinition,
  activeCountForDefinition as mockActiveCountForDefinition,
  versionCount as mockVersionCount,
  templateInstanceFor as mockTemplateInstanceFor,
} from "@/lib/definitions";
import {
  listJobs as mockListJobs,
  getJob as mockGetJob,
  jobsForInstance as mockJobsForInstance,
  deadLetterCount as mockDeadLetterCount,
  jobHealth as mockJobHealth,
} from "@/lib/jobs";
import type {
  BpmnNode,
  Deployment,
  EngineJob,
  ProcessDefinition,
  ProcessInstance,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Repository interfaces                                                      */
/* -------------------------------------------------------------------------- */

export interface InstanceRepository {
  listInstances(): ProcessInstance[];
  getInstance(id: string): ProcessInstance | undefined;
}

export interface DeploymentRepository {
  listDeployments(): Deployment[];
  getDeployment(id: string): Deployment | undefined;
  activeInstanceCount(d: Deployment): number;
}

export interface DefinitionRepository {
  listDefinitions(): ProcessDefinition[];
  listDefinitionVersions(key: string): ProcessDefinition[];
  getDefinition(key: string, version: number): ProcessDefinition | undefined;
  instancesForDefinition(key: string, version?: number): ProcessInstance[];
  activeCountForDefinition(key: string, version?: number): number;
  versionCount(key: string): number;
  templateInstanceFor(key: string, version: number): ProcessInstance | undefined;
}

export interface JobRepository {
  listJobs(): EngineJob[];
  getJob(id: string): EngineJob | undefined;
  jobsForInstance(instanceId: string): EngineJob[];
  deadLetterCount(): number;
  jobHealth(): {
    timers: number;
    async: number;
    dead: number;
    locked: number;
    nextTimerDue?: string;
    oldestAsyncCreated?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Default (mock) implementations                                             */
/* -------------------------------------------------------------------------- */

export const mockInstanceRepository: InstanceRepository = {
  listInstances: () => MOCK_INSTANCES,
  getInstance: (id) => mockGetInstance(id),
};

export const mockDeploymentRepository: DeploymentRepository = {
  listDeployments: mockListDeployments,
  getDeployment: mockGetDeployment,
  activeInstanceCount: mockActiveInstanceCount,
};

export const mockDefinitionRepository: DefinitionRepository = {
  listDefinitions: mockListDefinitions,
  listDefinitionVersions: mockListDefinitionVersions,
  getDefinition: mockGetDefinition,
  instancesForDefinition: mockInstancesForDefinition,
  activeCountForDefinition: mockActiveCountForDefinition,
  versionCount: mockVersionCount,
  templateInstanceFor: mockTemplateInstanceFor,
};

export const mockJobRepository: JobRepository = {
  listJobs: mockListJobs,
  getJob: mockGetJob,
  jobsForInstance: mockJobsForInstance,
  deadLetterCount: mockDeadLetterCount,
  jobHealth: mockJobHealth,
};

/* -------------------------------------------------------------------------- */
/* Active repository singletons + setters                                     */
/* -------------------------------------------------------------------------- */

let instanceRepo: InstanceRepository = mockInstanceRepository;
let deploymentRepo: DeploymentRepository = mockDeploymentRepository;
let definitionRepo: DefinitionRepository = mockDefinitionRepository;
let jobRepo: JobRepository = mockJobRepository;

export function setInstanceRepository(r: InstanceRepository): void { instanceRepo = r; }
export function setDeploymentRepository(r: DeploymentRepository): void { deploymentRepo = r; }
export function setDefinitionRepository(r: DefinitionRepository): void { definitionRepo = r; }
export function setJobRepository(r: JobRepository): void { jobRepo = r; }

export function getInstanceRepository(): InstanceRepository { return instanceRepo; }
export function getDeploymentRepository(): DeploymentRepository { return deploymentRepo; }
export function getDefinitionRepository(): DefinitionRepository { return definitionRepo; }
export function getJobRepository(): JobRepository { return jobRepo; }

/* -------------------------------------------------------------------------- */
/* Change notification                                                        */
/*                                                                             */
/* The repositories above are read synchronously by plain function calls with */
/* no built-in reactivity, so nothing previously told React to re-render once */
/* hydrateStore() resolved - components only picked up fresh data if some     */
/* unrelated state change happened to force a re-render anyway (e.g. a route  */
/* navigation, which coincidentally calls listInstances() etc. again). This   */
/* store version + subscribe/notify pair, combined with useSyncExternalStore  */
/* in the hooks below, closes that gap without changing any hook's name or    */
/* return type - no call site changes needed.                                 */
/* -------------------------------------------------------------------------- */

let storeVersion = 0;
const storeListeners = new Set<() => void>();

export function notifyStoreChanged(): void {
  storeVersion += 1;
  for (const listener of storeListeners) listener();
}

function subscribeToStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

/**
 * listInstances()/listDeployments()/etc. all allocate a new array on every call, so wiring
 * them into useSyncExternalStore directly would give React a different snapshot reference on
 * every render even when nothing changed - React then logs "The result of getSnapshot should
 * be cached" and can force extra re-renders. Caching by storeVersion (only recomputing when
 * notifyStoreChanged() actually fired) keeps the reference stable between renders that don't
 * cross a real data change.
 */
function cachedListSnapshot<T>(compute: () => T[]): () => T[] {
  let cachedAtVersion = -1;
  let cached: T[] = [];
  return () => {
    if (cachedAtVersion !== storeVersion) {
      cached = compute();
      cachedAtVersion = storeVersion;
    }
    return cached;
  };
}

const getInstancesSnapshot = cachedListSnapshot(() => instanceRepo.listInstances());
const getDeploymentsSnapshot = cachedListSnapshot(() => deploymentRepo.listDeployments());
const getDefinitionsSnapshot = cachedListSnapshot(() => definitionRepo.listDefinitions());
const getJobsSnapshot = cachedListSnapshot(() => jobRepo.listJobs());

/* -------------------------------------------------------------------------- */
/* Plain accessors — safe from route loaders and non-React code               */
/* -------------------------------------------------------------------------- */

// Instances
export const listInstances = (): ProcessInstance[] => instanceRepo.listInstances();
export const getInstance = (id: string): ProcessInstance | undefined => instanceRepo.getInstance(id);

// Deployments
export const listDeployments = (): Deployment[] => deploymentRepo.listDeployments();
export const getDeployment = (id: string): Deployment | undefined => deploymentRepo.getDeployment(id);
export const activeInstanceCount = (d: Deployment): number => deploymentRepo.activeInstanceCount(d);

// Definitions
export const listDefinitions = (): ProcessDefinition[] => definitionRepo.listDefinitions();
export const listDefinitionVersions = (key: string): ProcessDefinition[] => definitionRepo.listDefinitionVersions(key);
export const getDefinition = (key: string, version: number): ProcessDefinition | undefined => definitionRepo.getDefinition(key, version);
export const instancesForDefinition = (key: string, version?: number): ProcessInstance[] => definitionRepo.instancesForDefinition(key, version);
export const activeCountForDefinition = (key: string, version?: number): number => definitionRepo.activeCountForDefinition(key, version);
export const versionCount = (key: string): number => definitionRepo.versionCount(key);
export const templateInstanceFor = (key: string, version: number): ProcessInstance | undefined => definitionRepo.templateInstanceFor(key, version);

// Jobs
export const listJobs = (): EngineJob[] => jobRepo.listJobs();
export const getJob = (id: string): EngineJob | undefined => jobRepo.getJob(id);
export const jobsForInstance = (instanceId: string): EngineJob[] => jobRepo.jobsForInstance(instanceId);
export const deadLetterCount = (): number => jobRepo.deadLetterCount();
export const jobHealth = (): ReturnType<JobRepository["jobHealth"]> => jobRepo.jobHealth();

/* -------------------------------------------------------------------------- */
/* Derived helpers (pure, work off any ProcessInstance)                       */
/* -------------------------------------------------------------------------- */

export function failedJobCount(p: ProcessInstance): number {
  return p.jobs.filter((j) => j.type === "deadletter").length;
}

export function currentActivities(p: ProcessInstance): BpmnNode[] {
  return p.nodes.filter((n) => n.state === "active" || n.state === "failed");
}

/* -------------------------------------------------------------------------- */
/* React hooks — thin wrappers so components stay decoupled from the source.  */
/* Subscribed via useSyncExternalStore so a resolved hydrateStore() actually  */
/* triggers a re-render, instead of only showing up on some unrelated state   */
/* change (e.g. a route navigation).                                         */
/* -------------------------------------------------------------------------- */

export const useInstances = (): ProcessInstance[] =>
  useSyncExternalStore(subscribeToStore, getInstancesSnapshot);
export const useInstance = (id: string | undefined): ProcessInstance | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? instanceRepo.getInstance(id) : undefined));

export const useDeployments = (): Deployment[] =>
  useSyncExternalStore(subscribeToStore, getDeploymentsSnapshot);
export const useDeployment = (id: string | undefined): Deployment | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? deploymentRepo.getDeployment(id) : undefined));

export const useDefinitions = (): ProcessDefinition[] =>
  useSyncExternalStore(subscribeToStore, getDefinitionsSnapshot);

const definitionVersionsCache = new Map<string, { version: number; value: ProcessDefinition[] }>();
export const useDefinitionVersions = (key: string): ProcessDefinition[] =>
  useSyncExternalStore(subscribeToStore, () => {
    const entry = definitionVersionsCache.get(key);
    if (entry && entry.version === storeVersion) return entry.value;
    const value = definitionRepo.listDefinitionVersions(key);
    definitionVersionsCache.set(key, { version: storeVersion, value });
    return value;
  });

export const useDefinition = (key: string, version: number): ProcessDefinition | undefined =>
  useSyncExternalStore(subscribeToStore, () => definitionRepo.getDefinition(key, version));

export const useJobs = (): EngineJob[] =>
  useSyncExternalStore(subscribeToStore, getJobsSnapshot);
export const useJob = (id: string | undefined): EngineJob | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? jobRepo.getJob(id) : undefined));

/* -------------------------------------------------------------------------- */
/* Convenience re-exports                                                     */
/* -------------------------------------------------------------------------- */

export { relativeTime, formatDuration, formatBytes } from "@/lib/format";
export type * from "@/lib/types";
