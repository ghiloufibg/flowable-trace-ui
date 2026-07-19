import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout only - /definitions/$key (version history) and
// /definitions/$key/$version (single version detail) are two distinct pages,
// not a parent/child relationship in the UI. But this file's name is a
// prefix of definitions.$key.$version.tsx, so TanStack Router's file-based
// routing makes it the parent route regardless - it MUST render <Outlet />
// for the $version child to ever display, even though it owns no content of
// its own. The former content of this file (loader, version-history page)
// moved to definitions.$key.index.tsx, matching the same layout+index split
// already used one level up in definitions.tsx/definitions.index.tsx.
export const Route = createFileRoute("/definitions/$key")({
  component: () => <Outlet />,
});
