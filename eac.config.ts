export default {
  project: {
    name: "eac",
  },
  adapters: ["agents/context", "product/superbdd", "architecture/mermaid"],
  agents: {
    instructionFiles: [],
    minimumMeaningfulCharacters: 80,
  },
  product: {
    manifest: "eac.model.ts",
    requireBddForAllActions: true,
    requireUnitForMutations: true,
  },
  cucumber: {
    features: ["features/**/*.feature"],
    enforceFeatureInventory: true,
  },
  architecture: {
    sources: ["architecture/**/*.mmd"],
    requireSources: true,
  },
  waivers: [],
};
