import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain client-side-rendered SPA config (no TanStack Start / Nitro / SSR).
// tanstackRouter() must run before viteReact() so generated route code is
// transformed by the React plugin too.
export default defineConfig({
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
});
