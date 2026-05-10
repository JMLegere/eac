import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { runCheck, runInit } from "../src/core/runner";

const config = `export default {
  adapters: ["product/manifest", "cucumber/bdd"],
  product: {
    manifest: "eac.model.ts",
    requireBddForAllActions: true,
    requireUnitForMutations: true,
  },
  cucumber: {
    features: ["features/**/*.feature"],
    enforceFeatureInventory: true,
  },
};
`;

const superBddConfig = `export default {
  adapters: ["product/superbdd"],
  product: {
    manifest: "eac.model.ts",
    requireBddForAllActions: true,
    requireUnitForMutations: true,
  },
  cucumber: {
    features: ["features/**/*.feature"],
    enforceFeatureInventory: true,
  },
};
`;

const validManifest = `export const actionCapabilities = {
  runCheck: {
    id: "run-check",
    label: "Run strict check",
    kind: "verification",
    actor: "developer",
    surface: "CLI",
    risk: "medium",
    auth: "none",
    boundary: "eac check",
    workflow: null,
    verification: { required: ["bdd", "unit"] },
  },
  writeFiles: {
    id: "write-files",
    label: "Write repo files",
    kind: "mutation",
    actor: "developer",
    surface: "CLI",
    risk: "medium",
    auth: "none",
    boundary: "eac init",
    workflow: null,
    verification: { required: ["bdd", "unit"] },
  },
} as const;

export const productCapabilities = {
  repoContract: {
    id: "repo-contract",
    label: "Repository contract",
    tag: "@capability.repo-contract",
    cucumberFeatures: ["features/repo-contract.feature"],
    requiredActions: ["run-check", "write-files"],
    workflows: [],
  },
} as const;

export const userActionWorkflows = {} as const;
`;

const validFeature = `@capability.repo-contract
Feature: Repository contract
  The repo contract is enforced through EAC.

  @action.run-check
  Scenario: Run strict check
    When a developer runs eac check
    Then unwaived errors fail the command

  @action.write-files
  Scenario: Write missing files
    When a developer runs eac init
    Then missing artifacts are created safely
`;

describe("product/manifest and cucumber/bdd adapters", () => {
  test("valid product manifest and feature contract passes and contributes graph nodes", async () => {
    const root = await fixture({ manifest: validManifest, feature: validFeature });

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.nodes.map((node) => node.id)).toContain("capability:repo-contract");
    expect(result.graph.nodes.map((node) => node.id)).toContain("action:run-check");
    expect(result.graph.nodes.map((node) => node.id)).toContain("feature:features/repo-contract.feature");
    expect(result.graph.edges.some((edge) => edge.kind === "verifies" && edge.to === "action:write-files")).toBe(true);
  });

  test("product/superbdd compiles capability feature scenario step action spine", async () => {
    const root = await fixture({ manifest: validManifest, feature: validFeature, configContent: superBddConfig });

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.nodes.some((node) => node.kind === "step" && node.path === "features/repo-contract.feature")).toBe(
      true,
    );
    expect(result.graph.edges.some((edge) => edge.kind === "owns-feature" && edge.from === "capability:repo-contract")).toBe(
      true,
    );
    expect(result.graph.edges.some((edge) => edge.kind === "evidences-action" && edge.to === "action:run-check")).toBe(
      true,
    );
  });

  test("product/superbdd requires action scenarios to contain executable steps", async () => {
    const root = await fixture({
      manifest: validManifest,
      configContent: superBddConfig,
      feature: `@capability.repo-contract
Feature: Repository contract

  @action.run-check
  Scenario: Run strict check
`,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain(
      "product/superbdd-action-step-required",
    );
  });

  test("missing action tag fails BDD action coverage", async () => {
    const root = await fixture({
      manifest: validManifest,
      feature: `@capability.repo-contract
Feature: Repository contract

  @action.run-check
  Scenario: Run strict check
    Then the check is strict
`,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("cucumber/action-coverage");
    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("cucumber/capability-action-coverage");
  });

  test("high-risk mutation without model coverage or exemption fails product policy", async () => {
    const root = await fixture({
      manifest: validManifest.replace('risk: "medium",\n    auth: "none",\n    boundary: "eac init"', 'risk: "high",\n    auth: "none",\n    boundary: "eac init"'),
      feature: validFeature,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain(
      "product/high-risk-mutation-model-coverage",
    );
  });

  test("init scaffolds missing product and feature artifacts without overwriting", async () => {
    const root = tempRoot();
    write(join(root, "eac.config.ts"), config);

    const result = await runInit({ root });

    expect(result.actions.map((action) => `${action.action}:${action.path}`)).toContain("create:eac.model.ts");
    expect(result.actions.map((action) => `${action.action}:${action.path}`)).toContain(
      "create:features/repo-contract.feature",
    );

    const second = await runInit({ root });
    expect(second.actions.every((action) => action.action === "skip")).toBe(true);
  });
});

async function fixture({
  manifest,
  feature,
  configContent = config,
}: {
  manifest: string;
  feature: string;
  configContent?: string;
}): Promise<string> {
  const root = tempRoot();
  write(join(root, "eac.config.ts"), configContent);
  write(join(root, "eac.model.ts"), manifest);
  await mkdir(join(root, "features"), { recursive: true });
  write(join(root, "features", "repo-contract.feature"), feature);
  return root;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}
