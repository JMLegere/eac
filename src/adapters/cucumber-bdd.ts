import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type {
  Adapter,
  Artifact,
  Diagnostic,
  GraphContribution,
  InitAction,
  RepoContext,
  Rule,
  Severity,
} from "../core/types";
import {
  actionNodeId,
  artifactNodeId,
  capabilityNodeId,
  loadProductModel,
  productManifestAdapter,
  type ProductAction,
  type ProductCapability,
  type ProductModel,
} from "./product-manifest";

const FEATURE_PATTERN = "features/**/*.feature";
const TAG_PATTERN = /@([A-Za-z0-9_.:-]+)/g;
const CAPABILITY_TAG = /^capability\.([A-Za-z0-9-]+)$/;
const ACTION_TAG = /^action\.([A-Za-z0-9-]+)$/;

export type CucumberBddOptions = {
  features?: string[];
  enforceFeatureInventory?: boolean;
};

type ParsedFeatureDocument = {
  relativePath: string;
  featureName?: string;
  featureLine?: number;
  capabilityTags: Set<string>;
  actionTags: Set<string>;
  scenarios: ParsedScenario[];
  parseDiagnostics: Diagnostic[];
};

type ParsedScenario = {
  keyword: "Scenario" | "Scenario Outline";
  name: string;
  line: number;
  actionTags: Set<string>;
  tags: Set<string>;
};

type BddLoadResult = {
  product?: ProductModel;
  documents: ParsedFeatureDocument[];
  diagnostics: Diagnostic[];
};

export const cucumberBddAdapter: Adapter = {
  id: "cucumber/bdd",
  description: "Cucumber feature files linked to product capabilities and user-visible actions.",

  async artifacts(ctx): Promise<Artifact[]> {
    const result = await loadProductModel(ctx, "warning");
    const configuredFeatures = await collectFeaturePaths(ctx, options(ctx).features);
    const productFeatures = result.model ? productFeaturePaths(result.model.capabilities) : [];
    const featurePaths = unique([
      ...configuredFeatures,
      ...productFeatures,
      ...(configuredFeatures.length === 0 && productFeatures.length === 0 ? ["features/repo-contract.feature"] : []),
    ]);

    return unique(featurePaths).map((path) => ({
      id: `cucumber:${path}`,
      path,
      kind: "cucumber-feature",
      source: cucumberBddAdapter.id,
      required: true,
    }));
  },

  async init(ctx): Promise<InitAction[]> {
    const result = await loadProductModel(ctx, "warning");

    if (!result.model) {
      return [
        {
          path: "features/repo-contract.feature",
          content: defaultFeatureTemplate("repo-contract", "Repository contract", ["run-check"]),
          source: cucumberBddAdapter.id,
          description: "Baseline Cucumber feature linked to the default product manifest.",
        },
      ];
    }

    return result.model.capabilities.flatMap((capability) =>
      capability.cucumberFeatures.map((path) => ({
        path,
        content: defaultFeatureTemplate(capability.id, capability.label ?? capability.id, capability.requiredActions),
        source: cucumberBddAdapter.id,
        description: `Cucumber feature for product capability ${capability.id}.`,
      })),
    );
  },

  async graph(ctx): Promise<GraphContribution> {
    const loaded = await loadBdd(ctx, "warning");
    const nodes = loaded.documents.flatMap((document) => [
      {
        id: featureNodeId(document.relativePath),
        kind: "feature",
        label: document.featureName ?? document.relativePath,
        path: document.relativePath,
        source: cucumberBddAdapter.id,
        data: {
          capabilityTags: [...document.capabilityTags],
          actionTags: [...document.actionTags],
        },
      },
      ...document.scenarios.map((scenario) => ({
        id: scenarioNodeId(document.relativePath, scenario.line),
        kind: "scenario",
        label: scenario.name,
        path: document.relativePath,
        source: cucumberBddAdapter.id,
        data: {
          line: scenario.line,
          keyword: scenario.keyword,
          actionTags: [...scenario.actionTags],
          tags: [...scenario.tags],
        },
      })),
    ]);

    const edges = loaded.documents.flatMap((document) => [
      {
        from: artifactNodeId(document.relativePath),
        to: featureNodeId(document.relativePath),
        kind: "parses-to",
        source: cucumberBddAdapter.id,
      },
      ...[...document.capabilityTags].map((capabilityId) => ({
        from: featureNodeId(document.relativePath),
        to: capabilityNodeId(capabilityId),
        kind: "covers",
        source: cucumberBddAdapter.id,
      })),
      ...document.scenarios.flatMap((scenario) => [
        {
          from: featureNodeId(document.relativePath),
          to: scenarioNodeId(document.relativePath, scenario.line),
          kind: "owns",
          source: cucumberBddAdapter.id,
        },
        ...[...scenario.actionTags].map((actionId) => ({
          from: scenarioNodeId(document.relativePath, scenario.line),
          to: actionNodeId(actionId),
          kind: "verifies",
          source: cucumberBddAdapter.id,
        })),
      ]),
    ]);

    return { nodes, edges };
  },

  doctor(ctx): Promise<Diagnostic[]> {
    return collectBddDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "cucumber/bdd-valid",
        description: "Cucumber features are owned by product capabilities and cover required actions.",
        source: cucumberBddAdapter.id,
        check(checkCtx) {
          return collectBddDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

async function collectBddDiagnostics(ctx: RepoContext, severity: Severity): Promise<Diagnostic[]> {
  const loaded = await loadBdd(ctx, severity);
  const diagnostics = [...loaded.diagnostics];

  if (!loaded.product) return diagnostics;

  diagnostics.push(...validateBddContract(ctx, loaded.product, loaded.documents, severity));
  return diagnostics;
}

async function loadBdd(ctx: RepoContext, severity: Severity): Promise<BddLoadResult> {
  const product = await loadProductModel(ctx, severity);
  const diagnostics = product.model ? [] : product.diagnostics;
  const productPaths = product.model ? productFeaturePaths(product.model.capabilities) : [];
  const configuredPaths = await collectFeaturePaths(ctx, options(ctx).features);
  const allFeaturePaths = unique([...configuredPaths, ...productPaths]);
  const documents = allFeaturePaths
    .filter((path) => existsSync(join(ctx.root, path)))
    .map((path) => parseFeatureDocument(path, ctx.fs.readText(path), severity));

  diagnostics.push(...documents.flatMap((document) => document.parseDiagnostics));

  return {
    product: product.model,
    documents,
    diagnostics,
  };
}

function validateBddContract(
  ctx: RepoContext,
  product: ProductModel,
  documents: ParsedFeatureDocument[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const docsByPath = new Map(documents.map((document) => [document.relativePath, document]));
  const capabilityIds = new Set(product.capabilities.map((capability) => capability.id));
  const actionsById = new Map(product.actions.map((action) => [action.id, action]));
  const referencedFeaturePaths = new Set(productFeaturePaths(product.capabilities));
  const discoveredFeaturePaths = new Set(documents.map((document) => document.relativePath));
  const allActionTags = new Set(documents.flatMap((document) => [...document.actionTags]));

  for (const capability of product.capabilities) {
    diagnostics.push(...validateCapabilityFeatureCoverage(capability, docsByPath, actionsById, severity));
  }

  for (const document of documents) {
    if (options(ctx).enforceFeatureInventory && !referencedFeaturePaths.has(document.relativePath)) {
      diagnostics.push(
        diagnostic("cucumber/feature-owned", severity, `${document.relativePath} must be listed by a product capability`, {
          path: document.relativePath,
          target: document.relativePath,
          hint: "add the feature path to productCapabilities.<capability>.cucumberFeatures or disable cucumber.enforceFeatureInventory",
        }),
      );
    }

    if (document.capabilityTags.size === 0) {
      diagnostics.push(
        diagnostic("cucumber/capability-tag-required", severity, `${document.relativePath} must carry @capability.<id> on the Feature`, {
          path: document.relativePath,
          target: document.relativePath,
        }),
      );
    }

    for (const capabilityId of document.capabilityTags) {
      if (!capabilityIds.has(capabilityId)) {
        diagnostics.push(
          diagnostic(
            "cucumber/capability-tag-known",
            severity,
            `${document.relativePath} references unknown @capability.${capabilityId}`,
            {
              path: document.relativePath,
              target: capabilityId,
            },
          ),
        );
      }
    }

    for (const actionId of document.actionTags) {
      if (!actionsById.has(actionId)) {
        diagnostics.push(
          diagnostic("cucumber/action-tag-known", severity, `${document.relativePath} references unknown @action.${actionId}`, {
            path: document.relativePath,
            target: actionId,
          }),
        );
      }
    }
  }

  for (const featurePath of referencedFeaturePaths) {
    if (!discoveredFeaturePaths.has(featurePath)) {
      diagnostics.push(
        diagnostic("cucumber/feature-file-required", severity, `declared Cucumber feature is missing: ${featurePath}`, {
          path: featurePath,
          target: featurePath,
          hint: "run eac init to scaffold missing declared feature files",
        }),
      );
    }
  }

  for (const action of product.actions) {
    if (requiresBdd(action) && !allActionTags.has(action.id)) {
      diagnostics.push(
        diagnostic("cucumber/action-coverage", severity, `action "${action.id}" requires BDD but has no @action.${action.id} scenario`, {
          path: product.manifestPath,
          target: action.id,
          hint: `add @action.${action.id} to a Scenario or Scenario Outline`,
        }),
      );
    }
  }

  return diagnostics;
}

function validateCapabilityFeatureCoverage(
  capability: ProductCapability,
  docsByPath: Map<string, ParsedFeatureDocument>,
  actionsById: Map<string, ProductAction>,
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const actionTagsInOwnedFeatures = new Set<string>();

  for (const featurePath of capability.cucumberFeatures) {
    const document = docsByPath.get(featurePath);
    if (!document) continue;

    if (!document.capabilityTags.has(capability.id)) {
      diagnostics.push(
        diagnostic(
          "cucumber/capability-feature-tag",
          severity,
          `${featurePath} must carry @capability.${capability.id} to satisfy capability "${capability.id}"`,
          {
            path: featurePath,
            target: capability.id,
          },
        ),
      );
    }

    for (const actionId of document.actionTags) actionTagsInOwnedFeatures.add(actionId);
  }

  for (const actionId of capability.requiredActions) {
    if (!actionsById.has(actionId)) continue;
    if (actionTagsInOwnedFeatures.has(actionId)) continue;

    diagnostics.push(
      diagnostic(
        "cucumber/capability-action-coverage",
        severity,
        `capability "${capability.id}" requires @action.${actionId} in one of its Cucumber features`,
        {
          target: actionId,
          hint: `add @action.${actionId} under one of: ${capability.cucumberFeatures.join(", ")}`,
        },
      ),
    );
  }

  return diagnostics;
}

function parseFeatureDocument(relativePath: string, source: string, severity: Severity): ParsedFeatureDocument {
  const lines = source.split(/\r?\n/);
  const capabilityTags = new Set<string>();
  const actionTags = new Set<string>();
  const scenarios: ParsedScenario[] = [];
  const parseDiagnostics: Diagnostic[] = [];
  let pendingTags = new Set<string>();
  let featureName: string | undefined;
  let featureLine: number | undefined;

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      pendingTags = collectTags(line);
      for (const tag of pendingTags) {
        const actionMatch = ACTION_TAG.exec(tag);
        if (actionMatch) actionTags.add(actionMatch[1]);
      }
      continue;
    }

    const featureMatch = /^Feature:\s*(.+)$/.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      featureLine = lineNumber;
      for (const tag of pendingTags) {
        const capabilityMatch = CAPABILITY_TAG.exec(tag);
        if (capabilityMatch) capabilityTags.add(capabilityMatch[1]);
      }
      pendingTags = new Set();
      continue;
    }

    const scenarioMatch = /^(Scenario|Scenario Outline):\s*(.+)$/.exec(line);
    if (scenarioMatch) {
      const scenarioActionTags = new Set<string>();
      for (const tag of pendingTags) {
        const actionMatch = ACTION_TAG.exec(tag);
        if (actionMatch) scenarioActionTags.add(actionMatch[1]);
      }
      scenarios.push({
        keyword: scenarioMatch[1] as "Scenario" | "Scenario Outline",
        name: scenarioMatch[2].trim(),
        line: lineNumber,
        actionTags: scenarioActionTags,
        tags: pendingTags,
      });
      pendingTags = new Set();
    }
  }

  if (!featureName) {
    parseDiagnostics.push(
      diagnostic("cucumber/feature-parse", severity, `${relativePath} does not contain a Feature declaration`, {
        path: relativePath,
        target: relativePath,
        hint: "add a Feature: line and tag it with @capability.<id>",
      }),
    );
  }

  return {
    relativePath,
    featureName,
    featureLine,
    capabilityTags,
    actionTags,
    scenarios,
    parseDiagnostics,
  };
}

function collectTags(line: string): Set<string> {
  const tags = new Set<string>();
  for (const match of line.matchAll(TAG_PATTERN)) tags.add(match[1]);
  return tags;
}

async function collectFeaturePaths(ctx: RepoContext, patterns: string[]): Promise<string[]> {
  return unique(patterns.flatMap((pattern) => expandFeaturePattern(ctx.root, pattern)));
}

function expandFeaturePattern(root: string, pattern: string): string[] {
  if (pattern.endsWith("/**/*.feature")) {
    const directory = pattern.slice(0, -"/**/*.feature".length);
    return walkFeatureFiles(root, directory);
  }

  if (pattern.endsWith("/*.feature")) {
    const directory = pattern.slice(0, -"/*.feature".length);
    return listImmediateFeatureFiles(root, directory);
  }

  const absolute = join(root, pattern);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isDirectory()) return walkFeatureFiles(root, pattern);
  return pattern.endsWith(".feature") ? [normalizePath(pattern)] : [];
}

function walkFeatureFiles(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = join(absoluteDirectory, entry.name);
    const relativePath = normalizePath(relative(root, absolutePath));
    if (entry.isDirectory()) {
      files.push(...walkFeatureFiles(root, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".feature")) {
      files.push(relativePath);
    }
  }
  return files;
}

function listImmediateFeatureFiles(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".feature"))
    .map((entry) => normalizePath(join(directory, entry.name)));
}

function defaultFeatureTemplate(capabilityId: string, label: string, actionIds: string[]): string {
  const scenarios = actionIds.length > 0 ? actionIds : ["run-check"];
  return `@capability.${capabilityId}
Feature: ${label}
  ${label} stays aligned with the repo-owned product contract.

${scenarios
  .map(
    (actionId) => `  @action.${actionId}
  Scenario: ${sentenceCase(actionId)}
    Given the repository contract is available
    When ${actionId} is exercised
    Then the behavior satisfies the product contract`,
  )
  .join("\n\n")}
`;
}

function productFeaturePaths(capabilities: ProductCapability[]): string[] {
  return unique(capabilities.flatMap((capability) => capability.cucumberFeatures));
}

function requiresBdd(action: ProductAction): boolean {
  return Boolean(action.verification?.required?.includes("bdd"));
}

function options(ctx: RepoContext): Required<CucumberBddOptions> {
  const configured = ctx.adapterOptions<CucumberBddOptions>(cucumberBddAdapter.id) ?? {};
  return {
    features: configured.features ?? [FEATURE_PATTERN],
    enforceFeatureInventory: configured.enforceFeatureInventory ?? true,
  };
}

function diagnostic(
  ruleId: string,
  severity: Severity,
  message: string,
  fields: Omit<Partial<Diagnostic>, "ruleId" | "severity" | "message" | "source"> = {},
): Diagnostic {
  return {
    ruleId,
    severity,
    message,
    source: cucumberBddAdapter.id,
    ...fields,
  };
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function sentenceCase(value: string): string {
  return value.replace(/-/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function featureNodeId(path: string): string {
  return `feature:${path}`;
}

function scenarioNodeId(path: string, line: number): string {
  return `scenario:${path}:${line}`;
}
