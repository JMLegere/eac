import type { Adapter, AdapterSelection } from "../core/types";
import { agentsContextAdapter } from "./agents-context";
import { versioningSemverAdapter } from "./versioning-semver";

const BUILT_IN_ADAPTERS = new Map<string, Adapter>([
  [agentsContextAdapter.id, agentsContextAdapter],
  [versioningSemverAdapter.id, versioningSemverAdapter],
]);

export function resolveAdapters(selections: AdapterSelection[] | undefined): Adapter[] {
  return (selections ?? ["agents/context"]).map((selection) => {
    const id = typeof selection === "string" ? selection : selection.use;
    const adapter = BUILT_IN_ADAPTERS.get(id);

    if (!adapter) {
      throw new Error(`Unknown EAC adapter: ${id}`);
    }

    return adapter;
  });
}

export { agentsContextAdapter, versioningSemverAdapter };
