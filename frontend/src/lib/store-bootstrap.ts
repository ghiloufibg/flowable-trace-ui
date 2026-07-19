/**
 * Store bootstrap — installs HTTP-backed repositories and drives hydration.
 *
 * Always points at the real backend (VITE_FLOWABLE_API_URL/VITE_CUSTOM_API_URL,
 * defaulting to /process-api and /custom - see @/lib/api/client.ts). The
 * synchronous local-mock seed below is gated to `import.meta.env.DEV` only:
 * it exists purely so the Lovable/`npm run dev` preview loop has something to
 * show before a real backend might be reachable. A production build never
 * seeds fabricated data - it starts empty and fills in once hydrateStore()
 * resolves, and store.ts's hooks now actually re-render when that happens
 * (see notifyStoreChanged()) instead of only updating on some unrelated
 * state change.
 */

import {
  notifyStoreChanged,
  setDefinitionRepository,
  setDeploymentRepository,
  setInstanceRepository,
  setJobRepository,
} from "@/lib/store";
import { HttpInstanceRepository } from "@/lib/repositories/http-instance";
import { HttpDeploymentRepository } from "@/lib/repositories/http-deployment";
import { HttpDefinitionRepository } from "@/lib/repositories/http-definition";
import { HttpJobRepository } from "@/lib/repositories/http-job";
// Local mock seed sources. Remove these imports and the seedFromLocalMocks()
// body when switching to a real backend.
import { INSTANCES as MOCK_INSTANCES } from "@/lib/mock-data";
import { listDeployments as mockListDeployments } from "@/lib/deployments";
import { listDefinitions as mockListDefinitions } from "@/lib/definitions";
import { listJobs as mockListJobs } from "@/lib/jobs";

let installed = false;
let instanceRepo: HttpInstanceRepository | null = null;
let deploymentRepo: HttpDeploymentRepository | null = null;
let definitionRepo: HttpDefinitionRepository | null = null;
let jobRepo: HttpJobRepository | null = null;

let hydratePromise: Promise<void> | null = null;

function installIfNeeded(): void {
  if (installed) return;
  installed = true;

  instanceRepo = new HttpInstanceRepository();
  deploymentRepo = new HttpDeploymentRepository(instanceRepo);
  definitionRepo = new HttpDefinitionRepository(instanceRepo);
  jobRepo = new HttpJobRepository();

  setInstanceRepository(instanceRepo);
  setDeploymentRepository(deploymentRepo);
  setDefinitionRepository(definitionRepo);
  setJobRepository(jobRepo);
}

/**
 * Synchronous seed from local mock modules — dev-preview only (see class
 * Javadoc-style comment above). No-op in a production build, so a real
 * consumer's deployment never shows fabricated demo data at any point.
 */
export function seedFromLocalMocks(): void {
  if (!import.meta.env.DEV) return;
  installIfNeeded();
  instanceRepo!.seed(MOCK_INSTANCES);
  deploymentRepo!.seed(mockListDeployments());
  definitionRepo!.seed(mockListDefinitions());
  jobRepo!.seed(mockListJobs());
  notifyStoreChanged();
}

/**
 * Install HTTP repositories (idempotent). Safe to call at module load or
 * before rendering.
 */
export function installHttpRepositories(): void {
  installIfNeeded();
}

/**
 * Fetch from the configured endpoints and refresh every cache. Called from
 * the client after mount; safe to call multiple times but returns the same
 * in-flight promise.
 */
export function hydrateStore(): Promise<void> {
  installIfNeeded();
  if (!hydratePromise) {
    hydratePromise = Promise.all([
      instanceRepo!.hydrate(),
      deploymentRepo!.hydrate(),
      definitionRepo!.hydrate(),
      jobRepo!.hydrate(),
    ])
      .then(() => {
        // The one line that was missing before: without this, every
        // repository's cache refreshes correctly but nothing tells React to
        // re-render, so components keep showing whatever they last rendered
        // (seed data, or nothing) until some unrelated state change forces
        // one anyway.
        notifyStoreChanged();
      })
      .catch((err) => {
        // Reset so a later retry re-fires the requests.
        hydratePromise = null;
        throw err;
      });
  }
  return hydratePromise;
}
