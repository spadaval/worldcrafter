import { createContext, useContext, useSyncExternalStore } from "react";
import type { Store } from "~/workspace/store";
import type { Workspace } from "~/workspace/workspace";
import type { WorldStore } from "~/world/store";
import type { Environment } from "./environment";

export const WorkspaceContext = createContext<Workspace | null>(null);
export const EnvironmentContext = createContext<Environment | null>(null);
/** The world-facts store, wired to the workspace (see `createAppWorldStore`). */
export const WorldStoreContext = createContext<WorldStore | null>(null);

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace outside WorkspaceContext");
  return workspace;
}

export function useEnvironment(): Environment {
  const environment = useContext(EnvironmentContext);
  if (!environment)
    throw new Error("useEnvironment outside EnvironmentContext");
  return environment;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
