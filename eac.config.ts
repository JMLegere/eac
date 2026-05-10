export default {
  project: {
    name: "eac",
  },
  adapters: ["agents/context", "product/manifest", "cucumber/bdd"],
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
  waivers: [],
};
