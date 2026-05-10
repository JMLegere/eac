export const actionCapabilities = {
  runInit: {
    id: "run-init",
    label: "Initialize repo-owned EAC artifacts",
    kind: "mutation",
    actor: "developer",
    surface: "CLI",
    risk: "medium",
    auth: "none",
    boundary: "eac init writes missing safe artifacts and skips existing files unless --force is used",
    workflow: null,
    verification: { required: ["bdd", "unit"] },
  },
  runDoctor: {
    id: "run-doctor",
    label: "Inspect EAC adoption status without failing",
    kind: "verification",
    actor: "developer",
    surface: "CLI",
    risk: "low",
    auth: "none",
    boundary: "eac doctor emits advisory diagnostics and exits successfully",
    workflow: null,
    verification: { required: ["bdd", "unit"] },
  },
  runCheck: {
    id: "run-check",
    label: "Run strict repo contract checks",
    kind: "verification",
    actor: "developer",
    surface: "CLI/CI",
    risk: "high",
    auth: "none",
    boundary: "eac check loads enabled adapters, builds the repo graph, validates waivers, and fails on unwaived errors",
    workflow: null,
    verification: { required: ["bdd", "unit"] },
  },
} as const;

export const productCapabilities = {
  eacKernel: {
    id: "eac-kernel",
    label: "EAC kernel command loop",
    tag: "@capability.eac-kernel",
    cucumberFeatures: ["features/eac-kernel.feature"],
    requiredActions: ["run-init", "run-doctor", "run-check"],
    workflows: [],
  },
} as const;

export const userActionWorkflows = {} as const;
