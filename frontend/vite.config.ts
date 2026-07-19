import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain client-side-rendered SPA config (no TanStack Start / Nitro / SSR).
// tanstackRouter() must run before viteReact() so generated route code is
// transformed by the React plugin too.
//
// `base` is only set for the production build, not `vite dev`: the built
// dist/ is embedded by flow-trace-ui-backend and served at its
// flowtrace.mount-path (default "/flow-trace", see FlowTraceProperties) -
// without a matching `base`, every asset URL in the built index.html is
// absolute from site root and 404s under that backend. Left unset for dev
// so the Lovable/`npm run dev` workflow keeps serving from root unchanged.
// Matches the basepath condition in src/router.tsx - keep both in sync.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/flow-trace/" : "/",
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
  ],
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
  },
  server: {
    host: "::",
    port: 8080,
  },
}));
