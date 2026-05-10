import type {
  Adapter,
  Diagnostic,
  GraphContribution,
  GraphEdge,
  GraphNode,
  InitAction,
  RepoContext,
  Rule,
  Severity,
} from "../core/types";
import {
  actionNodeId,
  artifactNodeId,
  capabilityNodeId,
  collectProductDiagnostics,
  loadProductModel,
  productManifestAdapter,
  productManifestNodeId,
  type ProductModel,
} from "./product-manifest";
import {
  collectBddDiagnostics,
  cucumberBddAdapter,
  featureNodeId,
  loadBdd,
  scenarioNodeId,
  stepNodeId,
  type ParsedFeatureDocument,
  type ParsedScenario,
  type ParsedStep,
} from "./cucumber-bdd";

export const productSuperBddAdapter: Adapter = {
  id: "product/superbdd",
  description: "Product-as-code evidence compiler for Capability -> Feature -> Scenario -> Step -> Action.",

  async artifacts(ctx) {
    const productArtifacts = productManifestAdapter.artifacts ? await productManifestAdapter.artifacts(ctx) : [];
    const cucumberArtifacts = cucumberBddAdapter.artifacts ? await cucumberBddAdapter.artifacts(ctx) : [];
    return [...productArtifacts, ...cucumberArtifacts].map((artifact) => ({
      ...artifact,
      source: productSuperBddAdapter.id,
    }));
  },

  async init(ctx): Promise<InitAction[]> {
    const productActions = productManifestAdapter.init ? await productManifestAdapter.init(ctx) : [];
    const cucumberActions = cucumberBddAdapter.init ? await cucumberBddAdapter.init(ctx) : [];
    return [...productActions, ...cucumberActions].map((action) => ({
      ...action,
      source: productSuperBddAdapter.id,
    }));
  },

  async graph(ctx): Promise<GraphContribution> {
    const loaded = await loadBdd(ctx, "warning");
    if (!loaded.product) return cucumberGraph(loaded.documents);

    return compileSuperBddGraph(loaded.product, loaded.documents);
  },

  doctor(ctx): Promise<Diagnostic[]> {
    return collectSuperBddDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "product/superbdd-valid",
        description: "Product intent, executable examples, steps, and actions compile into one product-as-code spine.",
        source: productSuperBddAdapter.id,
        check(checkCtx) {
          return collectSuperBddDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

async function collectSuperBddDiagnostics(ctx: RepoContext, severity: Severity): Promise<Diagnostic[]> {
  const diagnostics = [
    ...(await collectProductDiagnostics(ctx, severity)),
    ...(await collectBddDiagnostics(ctx, severity)),
  ];
  const loaded = await loadBdd(ctx, severity);

  if (loaded.product) {
    diagnostics.push(...validateStepActionEvidence(loaded.product, loaded.documents, severity));
  }

  return diagnostics;
}

function compileSuperBddGraph(product: ProductModel, documents: ParsedFeatureDocument[]): GraphContribution {
  const nodes: GraphNode[] = [
    {
      id: productManifestNodeId(product.manifestPath),
      kind: "product-manifest",
      label: product.manifestPath,
      path: product.manifestPath,
      source: productSuperBddAdapter.id,
    },
    ...product.capabilities.map((capability) => ({
      id: capabilityNodeId(capability.id),
      kind: "capability",
      label: capability.label ?? capability.id,
      source: productSuperBddAdapter.id,
      data: { tag: capability.tag },
    })),
    ...product.actions.map((action) => ({
      id: actionNodeId(action.id),
      kind: "action",
      label: action.label ?? action.id,
      source: productSuperBddAdapter.id,
      data: {
        kind: action.kind,
        actor: action.actor,
        surface: action.surface,
        risk: action.risk,
        auth: action.auth,
        boundary: action.boundary,
        verification: action.verification?.required ?? [],
      },
    })),
    ...cucumberGraph(documents).nodes,
  ];

  const edges: GraphEdge[] = [
    ...product.capabilities.flatMap((capability) => [
      {
        from: productManifestNodeId(product.manifestPath),
        to: capabilityNodeId(capability.id),
        kind: "declares",
        source: productSuperBddAdapter.id,
      },
      ...capability.requiredActions.map((actionId) => ({
        from: capabilityNodeId(capability.id),
        to: actionNodeId(actionId),
        kind: "requires-action",
        source: productSuperBddAdapter.id,
      })),
    ]),
    ...documents.flatMap((document) => superBddDocumentEdges(document)),
  ];

  return { nodes, edges };
}

function cucumberGraph(documents: ParsedFeatureDocument[]): Required<GraphContribution> {
  const nodes = documents.flatMap((document) => [
    {
      id: featureNodeId(document.relativePath),
      kind: "feature",
      label: document.featureName ?? document.relativePath,
      path: document.relativePath,
      source: productSuperBddAdapter.id,
      data: {
        capabilityTags: [...document.capabilityTags],
        actionTags: [...document.actionTags],
      },
    },
    ...document.scenarios.flatMap((scenario) => [
      {
        id: scenarioNodeId(document.relativePath, scenario.line),
        kind: "scenario",
        label: scenario.name,
        path: document.relativePath,
        source: productSuperBddAdapter.id,
        data: {
          line: scenario.line,
          keyword: scenario.keyword,
          actionTags: [...scenario.actionTags],
          tags: [...scenario.tags],
        },
      },
      ...scenario.steps.map((step) => ({
        id: stepNodeId(document.relativePath, step.line),
        kind: "step",
        label: step.text,
        path: document.relativePath,
        source: productSuperBddAdapter.id,
        data: {
          line: step.line,
          keyword: step.keyword,
        },
      })),
    ]),
  ]);

  const edges = documents.flatMap((document) => [
    {
      from: artifactNodeId(document.relativePath),
      to: featureNodeId(document.relativePath),
      kind: "parses-to",
      source: productSuperBddAdapter.id,
    },
    ...document.scenarios.flatMap((scenario) => [
      {
        from: featureNodeId(document.relativePath),
        to: scenarioNodeId(document.relativePath, scenario.line),
        kind: "owns-scenario",
        source: productSuperBddAdapter.id,
      },
      ...scenario.steps.map((step) => ({
        from: scenarioNodeId(document.relativePath, scenario.line),
        to: stepNodeId(document.relativePath, step.line),
        kind: "owns-step",
        source: productSuperBddAdapter.id,
      })),
    ]),
  ]);

  return { nodes, edges };
}

function superBddDocumentEdges(document: ParsedFeatureDocument): GraphEdge[] {
  return [
    ...[...document.capabilityTags].map((capabilityId) => ({
      from: capabilityNodeId(capabilityId),
      to: featureNodeId(document.relativePath),
      kind: "owns-feature",
      source: productSuperBddAdapter.id,
    })),
    ...document.scenarios.flatMap((scenario) =>
      actionEvidenceSteps(scenario).flatMap((step) =>
        [...scenario.actionTags].map((actionId) => ({
          from: stepNodeId(document.relativePath, step.line),
          to: actionNodeId(actionId),
          kind: "evidences-action",
          source: productSuperBddAdapter.id,
        })),
      ),
    ),
  ];
}

function validateStepActionEvidence(
  product: ProductModel,
  documents: ParsedFeatureDocument[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const actionIds = new Set(product.actions.map((action) => action.id));

  for (const document of documents) {
    for (const scenario of document.scenarios) {
      const knownActionTags = [...scenario.actionTags].filter((actionId) => actionIds.has(actionId));
      if (knownActionTags.length === 0) continue;
      if (actionEvidenceSteps(scenario).length > 0) continue;

      diagnostics.push(
        diagnostic(
          "product/superbdd-action-step-required",
          severity,
          `scenario "${scenario.name}" references product actions but has no executable step evidence`,
          {
            path: document.relativePath,
            location: { line: scenario.line },
            target: scenario.name,
            hint: "add Given/When/Then steps so SuperBDD can connect Scenario -> Step -> Action",
          },
        ),
      );
    }
  }

  return diagnostics;
}

function actionEvidenceSteps(scenario: ParsedScenario): ParsedStep[] {
  const whenSteps = scenario.steps.filter((step) => step.keyword === "When");
  if (whenSteps.length > 0) return whenSteps;
  return scenario.steps.slice(0, 1);
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
    source: productSuperBddAdapter.id,
    ...fields,
  };
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}
