import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import type { LayerStore } from "~/layers/state";
import type { Store } from "~/workspace/store";
import type { Workspace } from "~/workspace/workspace";
import type { WorldStore } from "~/world/store";
import type { Environment } from "./environment";
import type { Generation } from "./generation";
import type { LayerSource } from "./layers";
import type { Manuscript } from "./manuscript";
import type { WorldIndex } from "./world";

/** Everything the app's views use, created once at startup. */
export interface AppServices {
  readonly workspace: Workspace;
  /** The world-facts store, wired to the workspace (see `createAppWorldStore`). */
  readonly world: WorldStore;
  readonly worldIndex: WorldIndex;
  readonly manuscript: Manuscript;
  readonly layers: LayerStore;
  readonly layerSource: LayerSource;
  readonly environment: Environment;
  readonly generation: Generation;
}

const ServicesContext = createContext<AppServices | null>(null);

export function AppProviders({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices outside AppProviders");
  return services;
}

export const useWorkspace = (): Workspace => useServices().workspace;
export const useEnvironment = (): Environment => useServices().environment;

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
