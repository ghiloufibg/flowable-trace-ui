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

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DeploymentPageQuery } from "@/lib/repositories/http-deployment";
import type { DefinitionPageQuery } from "@/lib/repositories/http-definition";
import type { JobPageQuery } from "@/lib/repositories/http-job";
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
  ensureInstance?(id: string): Promise<ProcessInstance>;
}

export interface DeploymentRepository {
  listDeployments(): Deployment[];
  getDeployment(id: string): Deployment | undefined;
  activeInstanceCount(d: Deployment): number;
  ensureDeployment?(id: string): Promise<Deployment>;
  fetchPage?(q: DeploymentPageQuery): Promise<PagedResult<Deployment>>;
}

export interface DefinitionRepository {
  listDefinitions(): ProcessDefinition[];
  listDefinitionVersions(key: string): ProcessDefinition[];
  getDefinition(key: string, version: number): ProcessDefinition | undefined;
  instancesForDefinition(key: string, version?: number): ProcessInstance[];
  activeCountForDefinition(key: string, version?: number): number;
  versionCount(key: string): number;
  templateInstanceFor(key: string, version: number): ProcessInstance | undefined;
  ensureDefinition?(key: string, version: number): Promise<ProcessDefinition>;
  ensureTemplateInstance?(key: string, version: number): Promise<ProcessInstance | undefined>;
  fetchPage?(q: DefinitionPageQuery): Promise<PagedResult<ProcessDefinition>>;
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
  ensureJob?(id: string): Promise<EngineJob>;
  fetchPage?(q: JobPageQuery): Promise<PagedResult<EngineJob>>;
}

/** Result of a paged fetch - `total` is the server-reported count for the
 *  full (filtered) result set, used to drive the pagination UI. */
export interface PagedResult<T> {
  items: T[];
  total: number;
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

export function setInstanceRepository(r: InstanceRepository): void { instanceRepo = r; notifyStoreChanged(); }
export function setDeploymentRepository(r: DeploymentRepository): void { deploymentRepo = r; notifyStoreChanged(); }
export function setDefinitionRepository(r: DefinitionRepository): void { definitionRepo = r; notifyStoreChanged(); }
export function setJobRepository(r: JobRepository): void { jobRepo = r; notifyStoreChanged(); }

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

/**
 * Same referential-stability problem as cachedListSnapshot, but for hooks parameterized by a
 * key (useInstance(id), useDefinition(key, version), ...). Each distinct key gets its own
 * cached value, invalidated wholesale whenever storeVersion changes.
 */
function cachedByKey<T>(compute: (key: string) => T): (key: string) => T {
  let cachedAtVersion = -1;
  let cache = new Map<string, T>();
  return (key: string) => {
    if (cachedAtVersion !== storeVersion) {
      cache = new Map();
      cachedAtVersion = storeVersion;
    }
    if (!cache.has(key)) cache.set(key, compute(key));
    return cache.get(key) as T;
  };
}

const getInstancesSnapshot = cachedListSnapshot(() => instanceRepo.listInstances());
const getDeploymentsSnapshot = cachedListSnapshot(() => deploymentRepo.listDeployments());
const getDefinitionsSnapshot = cachedListSnapshot(() => definitionRepo.listDefinitions());
const getJobsSnapshot = cachedListSnapshot(() => jobRepo.listJobs());

const getInstanceByIdSnapshot = cachedByKey((id) => instanceRepo.getInstance(id));
const getDeploymentByIdSnapshot = cachedByKey((id) => deploymentRepo.getDeployment(id));
const getJobByIdSnapshot = cachedByKey((id) => jobRepo.getJob(id));
const getDefinitionVersionsSnapshot = cachedByKey((key) => definitionRepo.listDefinitionVersions(key));
const getDefinitionByKeyVersionSnapshot = cachedByKey((k) => {
  const [key, versionRaw] = k.split("@");
  return definitionRepo.getDefinition(key, Number(versionRaw));
});

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
/* Async ensure* — resolve full entity detail on demand, falling back to the  */
/* synchronous get* when a repository doesn't implement lazy loading (e.g.    */
/* the mock repositories, which are always fully eager).                     */
/* -------------------------------------------------------------------------- */

export async function ensureInstance(id: string): Promise<ProcessInstance | undefined> {
  if (instanceRepo.ensureInstance) return instanceRepo.ensureInstance(id);
  return instanceRepo.getInstance(id);
}
export async function ensureDeployment(id: string): Promise<Deployment | undefined> {
  if (deploymentRepo.ensureDeployment) return deploymentRepo.ensureDeployment(id);
  return deploymentRepo.getDeployment(id);
}
export async function ensureDefinition(key: string, version: number): Promise<ProcessDefinition | undefined> {
  if (definitionRepo.ensureDefinition) return definitionRepo.ensureDefinition(key, version);
  return definitionRepo.getDefinition(key, version);
}
export async function ensureTemplateInstance(key: string, version: number): Promise<ProcessInstance | undefined> {
  if (definitionRepo.ensureTemplateInstance) return definitionRepo.ensureTemplateInstance(key, version);
  return definitionRepo.templateInstanceFor(key, version);
}
export async function ensureJob(id: string): Promise<EngineJob | undefined> {
  if (jobRepo.ensureJob) return jobRepo.ensureJob(id);
  return jobRepo.getJob(id);
}

/* -------------------------------------------------------------------------- */
/* Derived helpers (pure, work off any ProcessInstance)                       */
/* -------------------------------------------------------------------------- */

export function failedJobCount(p: ProcessInstance): number {
  // Prefer the summary-derived count when present (list rows); fall back to
  // deriving it from the full jobs array on detail responses.
  return p.failedJobCount ?? p.jobs.filter((j) => j.type === "deadletter").length;
}

export function currentActivities(p: ProcessInstance): BpmnNode[] {
  // Prefer the summary-derived active-activity subset when present.
  return p.activeActivities ?? p.nodes.filter((n) => n.state === "active" || n.state === "failed");
}

/* -------------------------------------------------------------------------- */
/* React hooks — thin wrappers so components stay decoupled from the source.  */
/* Subscribed via useSyncExternalStore so a resolved hydrateStore()/ensure*() */
/* actually triggers a re-render, instead of only showing up on some         */
/* unrelated state change (e.g. a route navigation).                         */
/* -------------------------------------------------------------------------- */

export const useInstances = (): ProcessInstance[] =>
  useSyncExternalStore(subscribeToStore, getInstancesSnapshot);
export const useInstance = (id: string | undefined): ProcessInstance | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? getInstanceByIdSnapshot(id) : undefined));

export const useDeployments = (): Deployment[] =>
  useSyncExternalStore(subscribeToStore, getDeploymentsSnapshot);
export const useDeployment = (id: string | undefined): Deployment | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? getDeploymentByIdSnapshot(id) : undefined));

export const useDefinitions = (): ProcessDefinition[] =>
  useSyncExternalStore(subscribeToStore, getDefinitionsSnapshot);

export const useDefinitionVersions = (key: string): ProcessDefinition[] =>
  useSyncExternalStore(subscribeToStore, () => getDefinitionVersionsSnapshot(key));

export const useDefinition = (key: string, version: number): ProcessDefinition | undefined =>
  useSyncExternalStore(subscribeToStore, () => getDefinitionByKeyVersionSnapshot(`${key}@${version}`));

export const useJobs = (): EngineJob[] =>
  useSyncExternalStore(subscribeToStore, getJobsSnapshot);
export const useJob = (id: string | undefined): EngineJob | undefined =>
  useSyncExternalStore(subscribeToStore, () => (id ? getJobByIdSnapshot(id) : undefined));

/* -------------------------------------------------------------------------- */
/* Paged fetchers - one network call per (page, pageSize, filters) tuple      */
/* -------------------------------------------------------------------------- */

/** Fallback for repositories that don't implement `fetchPage()` (e.g. the
 *  mock repositories) - slices the already-cached list so paged routes keep
 *  working without every repository needing the real implementation. */
function fallbackPage<T>(all: T[], start: number, size: number): PagedResult<T> {
  return { items: all.slice(start, start + size), total: all.length };
}

export function fetchDeploymentsPage(q: DeploymentPageQuery): Promise<PagedResult<Deployment>> {
  return deploymentRepo.fetchPage
    ? deploymentRepo.fetchPage(q)
    : Promise.resolve(fallbackPage(deploymentRepo.listDeployments(), q.start, q.size));
}

export function fetchDefinitionsPage(q: DefinitionPageQuery): Promise<PagedResult<ProcessDefinition>> {
  return definitionRepo.fetchPage
    ? definitionRepo.fetchPage(q)
    : Promise.resolve(fallbackPage(definitionRepo.listDefinitions(), q.start, q.size));
}

export function fetchJobsPage(q: JobPageQuery): Promise<PagedResult<EngineJob>> {
  return jobRepo.fetchPage
    ? jobRepo.fetchPage(q)
    : Promise.resolve(fallbackPage(jobRepo.listJobs(), q.start, q.size));
}

export type { DeploymentPageQuery, DefinitionPageQuery, JobPageQuery };

/* -------------------------------------------------------------------------- */
/* Paged React hooks - components pass page/pageSize/filters and get back     */
/* { items, total, loading, error }. Every param change fires one fetch;      */
/* stale responses are dropped.                                               */
/* -------------------------------------------------------------------------- */

export interface UsePagedState<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: Error | null;
}

const EMPTY_PAGED: UsePagedState<never> = { items: [], total: 0, loading: true, error: null };

function usePaged<Q, T>(
  fetcher: (q: Q) => Promise<PagedResult<T>>,
  query: Q,
  cacheKey: string,
): UsePagedState<T> {
  const [state, setState] = useState<UsePagedState<T>>(EMPTY_PAGED as UsePagedState<T>);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher(query)
      .then((res) => {
        if (cancelled) return;
        setState({ items: res.items, total: res.total, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, error: err }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  return state;
}

export function usePagedDeployments(params: {
  page: number;
  pageSize: number;
  nameLike?: string;
  tenantId?: string;
  sort?: string;
  order?: "asc" | "desc";
}): UsePagedState<Deployment> {
  const q: DeploymentPageQuery = {
    start: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    nameLike: params.nameLike,
    tenantId: params.tenantId,
    sort: params.sort,
    order: params.order,
  };
  return usePaged(fetchDeploymentsPage, q, JSON.stringify(q));
}

export function usePagedDefinitions(params: {
  page: number;
  pageSize: number;
  nameLike?: string;
  tenantId?: string;
  suspended?: boolean;
  latest?: boolean;
  sort?: string;
  order?: "asc" | "desc";
}): UsePagedState<ProcessDefinition> {
  const q: DefinitionPageQuery = {
    start: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    nameLike: params.nameLike,
    tenantId: params.tenantId,
    suspended: params.suspended,
    latest: params.latest,
    sort: params.sort,
    order: params.order,
  };
  return usePaged(fetchDefinitionsPage, q, JSON.stringify(q));
}

export function usePagedJobs(params: {
  page: number;
  pageSize: number;
  jobType?: import("@/lib/types").JobKind;
  sort?: string;
  order?: "asc" | "desc";
}): UsePagedState<EngineJob> {
  const q: JobPageQuery = {
    start: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    jobType: params.jobType,
    sort: params.sort,
    order: params.order,
  };
  return usePaged(fetchJobsPage, q, JSON.stringify(q));
}

/* -------------------------------------------------------------------------- */
/* Convenience re-exports                                                     */
/* -------------------------------------------------------------------------- */

export { relativeTime, formatDuration, formatBytes } from "@/lib/format";
export type * from "@/lib/types";
