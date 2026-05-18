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
import {
  collectUiActionEvidence,
  type UiActionEvidence,
} from "./product-ui-actions";

export const productSuperBddAdapter: Adapter = {
  id: "product/superbdd",
  description:
    "Product-as-code evidence compiler for Capability -> Feature -> Scenario -> Step -> Action.",

  async artifacts(ctx) {
    const productArtifacts = productManifestAdapter.artifacts
      ? await productManifestAdapter.artifacts(ctx)
      : [];
    const cucumberArtifacts = cucumberBddAdapter.artifacts
      ? await cucumberBddAdapter.artifacts(ctx)
      : [];
    return [...productArtifacts, ...cucumberArtifacts].map((artifact) => ({
      ...artifact,
      source: productSuperBddAdapter.id,
    }));
  },

  async init(ctx): Promise<InitAction[]> {
    const productActions = productManifestAdapter.init
      ? await productManifestAdapter.init(ctx)
      : [];
    const cucumberActions = cucumberBddAdapter.init
      ? await cucumberBddAdapter.init(ctx)
      : [];
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

  async doctor(ctx): Promise<Diagnostic[]> {
    return [
      superBddImplementationGuide(),
      ...(await collectSuperBddDiagnostics(ctx, "warning")),
    ];
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "product/superbdd-valid",
        description:
          "Product intent, executable examples, steps, and actions compile into one product-as-code spine.",
        source: productSuperBddAdapter.id,
        check(checkCtx) {
          return collectSuperBddDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

async function collectSuperBddDiagnostics(
  ctx: RepoContext,
  severity: Severity,
): Promise<Diagnostic[]> {
  const diagnostics = [
    ...(await collectProductDiagnostics(ctx, severity)),
    ...(await collectBddDiagnostics(ctx, severity)),
  ];
  const loaded = await loadBdd(ctx, severity);

  if (loaded.product) {
    diagnostics.push(
      ...validateStepActionEvidence(loaded.product, loaded.documents, severity),
    );

    const uiEvidence = await collectUiActionEvidence(
      ctx,
      loaded.product,
      severity,
    );
    diagnostics.push(...uiEvidence.diagnostics);
    diagnostics.push(
      ...validateUiActionEvidence(
        loaded.product,
        uiEvidence.evidence,
        severity,
      ),
    );
  }

  return diagnostics;
}

function superBddImplementationGuide(): Diagnostic {
  return diagnostic(
    "product/superbdd-implementation-guide",
    "info",
    "SuperBDD is installed. Implement it by authoring product truth first, then executable examples, then strict checks.",
    {
      details: [
        "Model: Capability -> Feature -> Scenario -> Step -> Action, with optional Workflow state machines tying actions into lifecycle rules.",
        "Capability: a user-visible product outcome in product/manifest.ts. It owns feature files and lists the actions that must be evidenced.",
        "Feature: a Gherkin .feature file tagged @capability.<id>. It explains the capability in behavior language and contains scenarios.",
        "Scenario: a concrete example tagged @action.<id> for each user-visible action that needs BDD evidence.",
        "Step: Given/When/Then lines under a scenario. SuperBDD links When steps, or the first step as fallback, to the referenced action as executable evidence.",
        "Action: a stable user/system operation in product/manifest.ts with actor, surface, risk, auth, boundary, workflow, and verification.required.",
        "Workflow: optional product state model exported from userActionWorkflows; high-risk mutations should use a workflow, MBT coverage, or a documented exemption.",
        "Interaction: productCapabilities declare requiredActions and cucumberFeatures; Cucumber tags prove those actions are covered by scenarios and steps.",
        "Implementation loop: run eac init for missing artifacts, replace starter placeholders, add real @capability/@action tags, then run eac doctor for guidance.",
        'Check scripts: wire a non-blocking doctor script for local guidance and a strict check script for CI, e.g. "eac:doctor": "eac doctor" and "eac:check": "eac check".',
        "CI rule: eac doctor is advisory and exits 0; eac check is strict and should fail builds on unwaived errors.",
      ],
      hint: "Open product/manifest.ts and features/**/*.feature, then run eac check until the SuperBDD spine is complete.",
    },
  );
}

function compileSuperBddGraph(
  product: ProductModel,
  documents: ParsedFeatureDocument[],
): GraphContribution {
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

function cucumberGraph(
  documents: ParsedFeatureDocument[],
): Required<GraphContribution> {
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
      const knownActionTags = [...scenario.actionTags].filter((actionId) =>
        actionIds.has(actionId),
      );
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

function validateUiActionEvidence(
  product: ProductModel,
  evidence: UiActionEvidence[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const evidenceByActionAndKind = new Set(
    evidence.map((item) => `${item.actionId}:${item.evidenceKind}`),
  );

  for (const action of product.actions) {
    const required = action.verification?.required ?? [];

    for (const evidenceKind of ["static-ui"] as const) {
      if (!required.includes(evidenceKind)) continue;
      if (evidenceByActionAndKind.has(`${action.id}:${evidenceKind}`)) continue;

      diagnostics.push(
        diagnostic(
          "product/superbdd-ui-evidence-required",
          severity,
          `action "${action.id}" requires ${evidenceKind} evidence but none was found`,
          {
            path: product.manifestPath,
            target: action.id,
            hint: "configure uiActions.collectors or add evidence-file records for this action",
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
  fields: Omit<
    Partial<Diagnostic>,
    "ruleId" | "severity" | "message" | "source"
  > = {},
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
