import type { Adapter, AdapterSelection } from "../core/types";
import { agentsContextAdapter } from "./agents-context";
import { cucumberBddAdapter } from "./cucumber-bdd";
import { productManifestAdapter } from "./product-manifest";

const BUILT_IN_ADAPTERS = new Map<string, Adapter>([
  [agentsContextAdapter.id, agentsContextAdapter],
  [productManifestAdapter.id, productManifestAdapter],
  [cucumberBddAdapter.id, cucumberBddAdapter],
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

export { agentsContextAdapter, cucumberBddAdapter, productManifestAdapter };
