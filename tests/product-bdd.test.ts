import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { runAdd, runCheck, runDoctor, runInit } from "../src/core/runner";

const config = `export default {
  adapters: ["product/manifest", "cucumber/bdd"],
  product: {
    manifest: "product/manifest.ts",
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
    manifest: "product/manifest.ts",
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

const uiManifest = `export const actionCapabilities = {
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
    verification: { required: ["bdd", "unit", "static-ui", "rendered-ui"] },
  },
} as const;

export const productCapabilities = {
  repoContract: {
    id: "repo-contract",
    label: "Repository contract",
    tag: "@capability.repo-contract",
    cucumberFeatures: ["features/repo-contract.feature"],
    requiredActions: ["run-check"],
    workflows: [],
  },
} as const;

export const userActionWorkflows = {} as const;
`;

const uiFeature = `@capability.repo-contract
Feature: Repository contract
  The repo contract is enforced through EAC.

  @action.run-check
  Scenario: Run strict check
    When a developer runs eac check
    Then unwaived errors fail the command
`;

const superBddUiConfig = `export default {
  adapters: ["product/superbdd"],
  product: {
    manifest: "product/manifest.ts",
    requireBddForAllActions: true,
    requireUnitForMutations: true,
  },
  cucumber: {
    features: ["features/**/*.feature"],
    enforceFeatureInventory: true,
  },
  uiActions: {
    actionAttribute: "data-user-action",
    collectors: [
      {
        kind: "react-static",
        sources: ["src/**/*.tsx"],
        interactiveComponents: ["Button", "ButtonLink", "NavLink", "form"],
      },
      {
        kind: "react-rendered",
        routes: ["/"],
        appModule: "src/router.js",
        appExport: "AppRouter",
      },
    ],
  },
};
`;

describe("product/manifest and cucumber/bdd adapters", () => {
  test("valid product manifest and feature contract passes and contributes graph nodes", async () => {
    const root = await fixture({
      manifest: validManifest,
      feature: validFeature,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.nodes.map((node) => node.id)).toContain(
      "capability:repo-contract",
    );
    expect(result.graph.nodes.map((node) => node.id)).toContain(
      "action:run-check",
    );
    expect(result.graph.nodes.map((node) => node.id)).toContain(
      "feature:features/repo-contract.feature",
    );
    expect(
      result.graph.edges.some(
        (edge) => edge.kind === "verifies" && edge.to === "action:write-files",
      ),
    ).toBe(true);
  });

  test("product/superbdd compiles capability feature scenario step action spine", async () => {
    const root = await fixture({
      manifest: validManifest,
      feature: validFeature,
      configContent: superBddConfig,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(
      result.graph.nodes.some(
        (node) =>
          node.kind === "step" &&
          node.path === "features/repo-contract.feature",
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "owns-feature" &&
          edge.from === "capability:repo-contract",
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "evidences-action" && edge.to === "action:run-check",
      ),
    ).toBe(true);
  });

  test("product/superbdd doctor explains the implementation model and check scripts", async () => {
    const root = await fixture({
      manifest: validManifest,
      feature: validFeature,
      configContent: superBddConfig,
    });

    const result = await runDoctor({ root });
    const guide = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.ruleId === "product/superbdd-implementation-guide",
    );
    const details = guide?.details?.join("\\n") ?? "";

    expect(guide?.severity).toBe("info");
    expect(guide?.message).toContain("SuperBDD is installed");
    expect(details).toContain(
      "Capability -> Feature -> Scenario -> Step -> Action",
    );
    expect(details).toContain("Workflow");
    expect(details).toContain("product/manifest.ts");
    expect(details).toContain("@capability.<id>");
    expect(details).toContain("@action.<id>");
    expect(details).toContain("eac doctor");
    expect(details).toContain("eac check");
    expect(details).toContain('"eac:check": "eac check"');
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

  test("product/superbdd accepts configured static and rendered UI action evidence", async () => {
    const root = await fixture({
      manifest: uiManifest,
      feature: uiFeature,
      configContent: superBddUiConfig,
    });
    await installReactRenderStubs(root);
    await mkdir(join(root, "src"), { recursive: true });
    write(
      join(root, "src", "Page.tsx"),
      `export function Page() {
  return <Button data-user-action=\"run-check\">Run check</Button>;
}
`,
    );
    write(
      join(root, "src", "router.js"),
      `import React from "react";

export function AppRouter() {
  return React.createElement("button", { "data-user-action": "run-check" }, "Run check");
}
`,
    );

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
  });

  test("product/superbdd fails unannotated static React affordances", async () => {
    const root = await fixture({
      manifest: uiManifest,
      feature: uiFeature,
      configContent: superBddUiConfig,
    });
    await installReactRenderStubs(root);
    await mkdir(join(root, "src"), { recursive: true });
    write(
      join(root, "src", "Page.tsx"),
      `export function Page() {
  return <Button>Run check</Button>;
}
`,
    );
    write(
      join(root, "src", "router.js"),
      `import React from "react";

export function AppRouter() {
  return React.createElement("button", { "data-user-action": "run-check" }, "Run check");
}
`,
    );

    const result = await runCheck({ root });
    const ruleIds = result.diagnostics.map((diagnostic) => diagnostic.ruleId);

    expect(ruleIds).toContain(
      "product/superbdd-static-action-annotation-required",
    );
    expect(ruleIds).toContain("product/superbdd-ui-evidence-required");
  });

  test("product/superbdd fails unannotated rendered React affordances", async () => {
    const root = await fixture({
      manifest: uiManifest,
      feature: uiFeature,
      configContent: superBddUiConfig,
    });
    await installReactRenderStubs(root);
    await mkdir(join(root, "src"), { recursive: true });
    write(
      join(root, "src", "Page.tsx"),
      `export function Page() {
  return <Button data-user-action=\"run-check\">Run check</Button>;
}
`,
    );
    write(
      join(root, "src", "router.js"),
      `import React from "react";

export function AppRouter() {
  return React.createElement("button", null, "Run check");
}
`,
    );

    const result = await runCheck({ root });
    const ruleIds = result.diagnostics.map((diagnostic) => diagnostic.ruleId);

    expect(ruleIds).toContain(
      "product/superbdd-rendered-action-annotation-required",
    );
    expect(ruleIds).not.toContain("product/superbdd-ui-evidence-required");
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

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain(
      "cucumber/action-coverage",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain(
      "cucumber/capability-action-coverage",
    );
  });

  test("high-risk mutation without model coverage or exemption fails product policy", async () => {
    const root = await fixture({
      manifest: validManifest.replace(
        'risk: "medium",\n    auth: "none",\n    boundary: "eac init"',
        'risk: "high",\n    auth: "none",\n    boundary: "eac init"',
      ),
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

    expect(
      result.actions.map((action) => `${action.action}:${action.path}`),
    ).toContain("create:product/manifest.ts");
    expect(
      result.actions.map((action) => `${action.action}:${action.path}`),
    ).toContain("create:features/repo-contract.feature");

    const second = await runInit({ root });
    expect(second.actions.every((action) => action.action === "skip")).toBe(
      true,
    );
  });

  test("add product/superbdd configures a clean repo, init scaffolds starters, and check fails until authored", async () => {
    const root = tempRoot();

    const add = await runAdd({ root, target: "product/superbdd" });

    expect(add.targets).toEqual(["product/superbdd"]);
    expect(
      add.actions.map((action) => `${action.action}:${action.path}`),
    ).toEqual(["create:eac.config.ts"]);
    expect(existsSync(join(root, "eac.config.ts"))).toBe(true);
    expect(existsSync(join(root, "product", "manifest.ts"))).toBe(false);
    expect(existsSync(join(root, "features", "repo-contract.feature"))).toBe(
      false,
    );

    const preInitCheck = await runCheck({ root });
    expect(
      preInitCheck.diagnostics.map((diagnostic) => diagnostic.ruleId),
    ).toContain("product/manifest-file-required");
    expect(
      preInitCheck.diagnostics.map((diagnostic) => diagnostic.ruleId),
    ).not.toContain("product/starter-placeholder");

    const init = await runInit({ root });
    expect(
      init.actions.map((action) => `${action.action}:${action.path}`),
    ).toContain("create:product/manifest.ts");
    expect(
      init.actions.map((action) => `${action.action}:${action.path}`),
    ).toContain("create:features/repo-contract.feature");

    const starterCheck = await runCheck({ root });
    expect(
      starterCheck.diagnostics.map((diagnostic) => diagnostic.ruleId),
    ).toContain("product/starter-placeholder");
  });

  test("add supports explicit multi-adapter selection", async () => {
    const root = tempRoot();

    const add = await runAdd({
      root,
      targets: [
        "product/superbdd",
        "architecture/mermaid",
        "design/react",
        "data/supabase",
        "infra/terraform",
        "deploy/cloudflare",
      ],
    });

    expect(add.targets).toEqual([
      "product/superbdd",
      "architecture/mermaid",
      "design/react",
      "data/supabase",
      "infra/terraform",
      "deploy/cloudflare",
    ]);
    expect(
      add.actions.map((action) => `${action.action}:${action.path}`),
    ).toEqual(["create:eac.config.ts"]);

    const configContent = readFileSync(join(root, "eac.config.ts"), "utf8");
    expect(configContent).toContain('"product/superbdd"');
    expect(configContent).toContain('"architecture/mermaid"');
    expect(configContent).toContain('"design/react"');
    expect(configContent).toContain('"data/supabase"');
    expect(configContent).toContain('"infra/terraform"');
    expect(configContent).toContain('"deploy/cloudflare"');
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
  await mkdir(join(root, "product"), { recursive: true });
  write(join(root, "product", "manifest.ts"), manifest);
  await mkdir(join(root, "features"), { recursive: true });
  write(join(root, "features", "repo-contract.feature"), feature);
  return root;
}

async function installReactRenderStubs(root: string): Promise<void> {
  write(join(root, "package.json"), `{"type":"module"}`);
  await mkdir(join(root, "node_modules", "react"), { recursive: true });
  await mkdir(join(root, "node_modules", "react-dom"), { recursive: true });
  await mkdir(join(root, "node_modules", "react-router-dom"), {
    recursive: true,
  });

  write(
    join(root, "node_modules", "react", "index.js"),
    `function createElement(type, props, ...children) {
  return { type, props: props || {}, children };
}

exports.createElement = createElement;
exports.default = { createElement };
`,
  );

  write(
    join(root, "node_modules", "react-router-dom", "index.js"),
    `exports.MemoryRouter = function MemoryRouter(props) {
  return Array.isArray(props.children) ? props.children[0] : props.children;
};
`,
  );

  write(
    join(root, "node_modules", "react-dom", "server.js"),
    `function renderToStaticMarkup(element) {
  return render(element);
}

function render(element) {
  if (element == null || element === false) return "";
  if (typeof element === "string" || typeof element === "number") return String(element);
  if (Array.isArray(element)) return element.map(render).join("");
  if (typeof element.type === "function") {
    return render(element.type({ ...element.props, children: element.children.length === 1 ? element.children[0] : element.children }));
  }

  const attrs = Object.entries(element.props || {})
    .filter(([key, value]) => key !== "children" && value != null && value !== false)
    .map(([key, value]) => value === true ? key : key + "=\\"" + String(value).replace(/"/g, "&quot;") + "\\"")
    .join(" ");
  const open = attrs ? "<" + element.type + " " + attrs + ">" : "<" + element.type + ">";
  return open + element.children.map(render).join("") + "</" + element.type + ">";
}

exports.renderToStaticMarkup = renderToStaticMarkup;
`,
  );
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}
