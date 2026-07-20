/**
 * Minimal fetch wrapper used by the HTTP repositories.
 *
 * Base URLs come from env vars so switching to a real backend is
 * configuration-only:
 *   - VITE_FLOWABLE_API_URL — Flowable REST API v7.x root
 *                             (e.g. https://engine.example.com/flowable-rest/service)
 *   - VITE_CUSTOM_API_URL   — Custom backend for things Flowable REST can't
 *                             return out of the box (full graph, aggregated
 *                             KPIs, resource previews, …)
 *
 * Defaults point at the local mock server at /api/mock/{flowable|custom}.
 */

const DEFAULT_FLOWABLE = "/api/mock/flowable";
const DEFAULT_CUSTOM = "/api/mock/custom";

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
