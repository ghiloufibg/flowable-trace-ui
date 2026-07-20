import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/definitions")({
  component: () => <Outlet />,
});
