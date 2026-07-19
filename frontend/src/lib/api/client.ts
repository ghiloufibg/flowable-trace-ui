/**
 * Minimal fetch wrapper used by the HTTP repositories.
 *
 * Base URLs come from env vars so pointing at a different deployment is
 * configuration-only:
 *   - VITE_FLOWABLE_API_URL — the flow-trace-ui-backend library's embedded
 *                             Flowable REST API (flowable-spring-boot-starter-
 *                             process-rest, default servlet path /process-api)
 *   - VITE_CUSTOM_API_URL   — the library's own /custom/* enrichment API
 *                             (full graph, aggregated KPIs, resource
 *                             previews, …) - Flowable REST can't return these
 *                             directly.
 *
 * Defaults assume the frontend is served by the same backend that exposes
 * these APIs (see claudedocs/backend-library-design.md). No auth headers are
 * added: the real Flowable REST starter has no security of its own (verified
 * in Phase 2's spike), and this library's endpoints inherit whatever the
 * consumer app protects them with, if anything.
 */

const DEFAULT_FLOWABLE = "/process-api";
const DEFAULT_CUSTOM = "/custom";

function env(name: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  return v && v.length > 0 ? v : undefined;
}

export const FLOWABLE_BASE_URL = env("VITE_FLOWABLE_API_URL") ?? DEFAULT_FLOWABLE;
export const CUSTOM_BASE_URL = env("VITE_CUSTOM_API_URL") ?? DEFAULT_CUSTOM;

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function makeClient(base: string): ApiClient {
  return {
    async get<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await fetch(joinUrl(base, path), {
        ...init,
        headers: { accept: "application/json", ...(init?.headers ?? {}) },
      });
      if (!res.ok) {
        throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    },
  };
}

export const flowableClient: ApiClient = makeClient(FLOWABLE_BASE_URL);
export const customClient: ApiClient = makeClient(CUSTOM_BASE_URL);
