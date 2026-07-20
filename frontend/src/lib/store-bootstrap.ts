/**
 * Store bootstrap — installs HTTP-backed repositories and drives hydration.
 *
 * This is the ONE file that changes when you switch to a real backend:
 *   1. Set VITE_FLOWABLE_API_URL and VITE_CUSTOM_API_URL to your servers.
 *   2. Delete the synchronous mock-seed block below (or gate it on
 *      `import.meta.env.DEV`). The rest of the app never imports mock data
 *      directly — it reads through the store, which reads through these
 *      repositories.
 *
 * The synchronous seed exists so SSR and the first client paint have data
 * before the HTTP hydrate() resolves. Removing it just means the initial
 * render is empty until hydrateStore() finishes; no component change needed.
 */

import {
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
 * Synchronous seed from local mock modules. Guarantees SSR + first paint
 * render with realistic data even before hydrateStore() runs. Delete when
 * pointing at a real backend.
 */
export function seedFromLocalMocks(): void {
  installIfNeeded();
  instanceRepo!.seed(MOCK_INSTANCES);
  deploymentRepo!.seed(mockListDeployments());
  definitionRepo!.seed(mockListDefinitions());
  jobRepo!.seed(mockListJobs());
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
      .then(() => undefined)
      .catch((err) => {
        // Reset so a later retry re-fires the requests.
        hydratePromise = null;
        throw err;
      });
  }
  return hydratePromise;
}
