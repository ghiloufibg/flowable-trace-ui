import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installHttpRepositories, seedFromLocalMocks } from "@/lib/store-bootstrap";

// Route store reads through HTTP-backed repositories. A synchronous seed
// keeps first paint populated; the client fires hydrateStore() after mount
// to refresh from the (mock) HTTP endpoints.
installHttpRepositories();
seedFromLocalMocks();

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Matches vite.config.ts's `base` condition: the production build is
    // embedded and served at flowtrace.mount-path (default "/flow-trace"),
    // but `vite dev` still serves from root. import.meta.env.DEV is Vite's
    // own dev-vs-build flag, so this stays in sync automatically.
    basepath: import.meta.env.DEV ? "/" : "/flow-trace",
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
