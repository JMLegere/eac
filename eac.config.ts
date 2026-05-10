export default {
  project: {
    name: "eac",
  },
  adapters: ["agents/context", "versioning/semver"],
  agents: {
    instructionFiles: [],
    minimumMeaningfulCharacters: 80,
  },
  versioning: {
    packageJson: "package.json",
    tagPrefix: "v",
  },
  waivers: [],
};
