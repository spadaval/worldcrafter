import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import type { Workspace } from "~/workspace/workspace";
import { DocumentPage, HomePage } from "./pages";
import { Shell } from "./shell";

interface RouterContext {
  readonly workspace: Workspace;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Shell,
});

/** With no document in the URL, return to the last active tab, if any. */
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    const active = context.workspace.tabs.get().active;
    if (active) {
      throw redirect({
        to: "/doc/$documentId",
        params: { documentId: active },
      });
    }
  },
  component: HomePage,
});

/** The active tab is the document in the URL. */
export const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/doc/$documentId",
  component: DocumentPage,
});

const routeTree = rootRoute.addChildren([homeRoute, documentRoute]);

export function createAppRouter(
  workspace: Workspace,
  history: RouterHistory = createHashHistory(),
) {
  return createRouter({ routeTree, history, context: { workspace } });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
