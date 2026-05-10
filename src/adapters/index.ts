import type { Adapter, AdapterSelection } from "../core/types";
import { agentsContextAdapter } from "./agents-context";
import { architectureMermaidAdapter } from "./architecture-mermaid";
import { cucumberBddAdapter } from "./cucumber-bdd";
import { designReactAdapter } from "./design-react";
import { dataSupabaseAdapter } from "./data-supabase";
import { deployCloudflareAdapter } from "./deploy-cloudflare";
import { infraTerraformAdapter } from "./infra-terraform";
import { productSuperBddAdapter } from "./product-superbdd";
import { productManifestAdapter } from "./product-manifest";

const BUILT_IN_ADAPTERS = new Map<string, Adapter>([
  [architectureMermaidAdapter.id, architectureMermaidAdapter],
  [agentsContextAdapter.id, agentsContextAdapter],
  [designReactAdapter.id, designReactAdapter],
  [dataSupabaseAdapter.id, dataSupabaseAdapter],
  [productManifestAdapter.id, productManifestAdapter],
  [infraTerraformAdapter.id, infraTerraformAdapter],
  [deployCloudflareAdapter.id, deployCloudflareAdapter],
  [cucumberBddAdapter.id, cucumberBddAdapter],
  [productSuperBddAdapter.id, productSuperBddAdapter],
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

export { agentsContextAdapter, architectureMermaidAdapter, cucumberBddAdapter, dataSupabaseAdapter, deployCloudflareAdapter, designReactAdapter, infraTerraformAdapter, productManifestAdapter, productSuperBddAdapter };
