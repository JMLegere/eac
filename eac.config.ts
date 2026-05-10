export default {
  project: {
    name: "eac",
  },
  adapters: ["agents/context", "product/manifest", "cucumber/bdd", "versioning/semver"],
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
  versioning: {
    packageJson: "package.json",
    tagPrefix: "v",
  },
  waivers: [],
};
