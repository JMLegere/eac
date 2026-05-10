import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_MANIFEST_PATH = "eac.model.ts";
const DEFAULT_VERIFICATION_KINDS = [
  "bdd",
  "unit",
  "static-ui",
  "rendered-ui",
  "mbt",
  "contract",
  "smoke",
  "manual",
  "e2e",
] as const;

export type ProductManifestOptions = {
  manifest?: string;
  actionsExport?: string;
  capabilitiesExport?: string;
  workflowsExport?: string;
  knownVerificationKinds?: string[];
  requireBddForAllActions?: boolean;
  requireUnitForMutations?: boolean;
};

export type ProductAction = {
  id: string;
  label?: string;
  kind?: string;
  actor?: string;
  surface?: string;
  risk?: string;
  auth?: string;
  boundary?: string;
  workflow?: string | null;
  verification?: {
    required?: string[];
    mbtExempt?: {
      reason?: string;
    };
  };
  raw: Record<string, unknown>;
};

export type ProductCapability = {
  id: string;
  label?: string;
  tag?: string;
  cucumberFeatures: string[];
  requiredActions: string[];
  workflows: string[];
  raw: Record<string, unknown>;
};

export type ProductWorkflowTransition = {
  from?: string;
  action?: string;
  to?: string;
};

export type ProductWorkflowForbiddenTransition = {
  state?: string;
  action?: string;
  reason?: string;
};

export type ProductWorkflow = {
  id: string;
  label?: string;
  initialState?: string;
  states: string[];
  events: string[];
  transitions: ProductWorkflowTransition[];
  forbiddenTransitions: ProductWorkflowForbiddenTransition[];
  requiredCoverage: string[];
  evidence: string[];
  raw: Record<string, unknown>;
};

export type ProductModel = {
  manifestPath: string;
  actions: ProductAction[];
  capabilities: ProductCapability[];
  workflows: ProductWorkflow[];
};

export type ProductModelLoadResult = {
  model?: ProductModel;
  diagnostics: Diagnostic[];
};

export const productManifestAdapter: Adapter = {
  id: "product/manifest",
  description: "Product capabilities, user-visible actions, workflows, and verification obligations.",

  artifacts(ctx): Artifact[] {
    return [
      {
        id: "product:manifest",
        path: options(ctx).manifest,
        kind: "product-manifest",
        source: productManifestAdapter.id,
        required: true,
      },
    ];
  },

  init(ctx): InitAction[] {
    return [
      {
        path: options(ctx).manifest,
        content: defaultManifestTemplate(),
        source: productManifestAdapter.id,
        description: "Product capabilities and user-visible action contract.",
      },
    ];
  },

  async graph(ctx): Promise<GraphContribution> {
    const result = await loadProductModel(ctx, "warning");
    const model = result.model;
    if (!model) return { nodes: [], edges: [] };

    const nodes = [
      {
        id: productManifestNodeId(model.manifestPath),
        kind: "product-manifest",
        label: model.manifestPath,
        path: model.manifestPath,
        source: productManifestAdapter.id,
      },
      ...model.capabilities.map((capability) => ({
        id: capabilityNodeId(capability.id),
        kind: "capability",
        label: capability.label ?? capability.id,
        source: productManifestAdapter.id,
        data: { tag: capability.tag },
      })),
      ...model.actions.map((action) => ({
        id: actionNodeId(action.id),
        kind: "action",
        label: action.label ?? action.id,
        source: productManifestAdapter.id,
        data: {
          kind: action.kind,
          actor: action.actor,
          surface: action.surface,
          risk: action.risk,
          auth: action.auth,
          boundary: action.boundary,
          workflow: action.workflow,
          verification: action.verification?.required ?? [],
        },
      })),
      ...model.workflows.map((workflow) => ({
        id: workflowNodeId(workflow.id),
        kind: "workflow",
        label: workflow.label ?? workflow.id,
        source: productManifestAdapter.id,
        data: {
          initialState: workflow.initialState,
          states: workflow.states,
          events: workflow.events,
        },
      })),
    ];

    const edges = [
      ...model.capabilities.flatMap((capability) => [
        {
          from: productManifestNodeId(model.manifestPath),
          to: capabilityNodeId(capability.id),
          kind: "declares",
          source: productManifestAdapter.id,
        },
        ...capability.requiredActions.map((actionId) => ({
          from: capabilityNodeId(capability.id),
          to: actionNodeId(actionId),
          kind: "requires",
          source: productManifestAdapter.id,
        })),
        ...capability.workflows.map((workflowId) => ({
          from: capabilityNodeId(capability.id),
          to: workflowNodeId(workflowId),
          kind: "uses-workflow",
          source: productManifestAdapter.id,
        })),
      ]),
      ...model.actions.flatMap((action) =>
        action.workflow
          ? [
              {
                from: actionNodeId(action.id),
                to: workflowNodeId(action.workflow),
                kind: "participates-in",
                source: productManifestAdapter.id,
              },
            ]
          : [],
      ),
      ...model.workflows.flatMap((workflow) =>
        workflow.events.map((actionId) => ({
          from: workflowNodeId(workflow.id),
          to: actionNodeId(actionId),
          kind: "has-event",
          source: productManifestAdapter.id,
        })),
      ),
    ];

    return { nodes, edges };
  },

  doctor(ctx): Promise<Diagnostic[]> {
    return collectProductDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "product/manifest-valid",
        description: "The product manifest exists, loads, and exports product contract collections.",
        source: productManifestAdapter.id,
        check(checkCtx) {
          return collectProductDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

export function productOptions(ctx: RepoContext): Required<ProductManifestOptions> {
  const configured = ctx.adapterOptions<ProductManifestOptions>(productManifestAdapter.id) ?? {};
  return {
    manifest: configured.manifest ?? DEFAULT_MANIFEST_PATH,
    actionsExport: configured.actionsExport ?? "actionCapabilities",
    capabilitiesExport: configured.capabilitiesExport ?? "productCapabilities",
    workflowsExport: configured.workflowsExport ?? "userActionWorkflows",
    knownVerificationKinds: configured.knownVerificationKinds ?? [...DEFAULT_VERIFICATION_KINDS],
    requireBddForAllActions: configured.requireBddForAllActions ?? false,
    requireUnitForMutations: configured.requireUnitForMutations ?? false,
  };
}

export async function loadProductModel(
  ctx: RepoContext,
  severity: Severity = severityFor(ctx),
): Promise<ProductModelLoadResult> {
  const opts = options(ctx);
  const manifestPath = opts.manifest;
  const diagnostics: Diagnostic[] = [];

  if (!ctx.fs.exists(manifestPath)) {
    return {
      diagnostics: [
        diagnostic("product/manifest-file-required", severity, `product manifest is missing: ${manifestPath}`, {
          path: manifestPath,
          target: manifestPath,
          hint: "run eac init or configure product.manifest to point at the manifest module",
        }),
      ],
    };
  }

  const loaded = await importManifest(ctx, manifestPath, severity);
  diagnostics.push(...loaded.diagnostics);
  if (!loaded.module) return { diagnostics };

  const actionsRaw = exportedCollection(loaded.module, opts.actionsExport, "actions", manifestPath, severity);
  const capabilitiesRaw = exportedCollection(
    loaded.module,
    opts.capabilitiesExport,
    "capabilities",
    manifestPath,
    severity,
  );
  const workflowsRaw = exportedCollection(loaded.module, opts.workflowsExport, "workflows", manifestPath, severity, {
    optional: true,
  });

  diagnostics.push(...actionsRaw.diagnostics, ...capabilitiesRaw.diagnostics, ...workflowsRaw.diagnostics);
  if (!actionsRaw.values || !capabilitiesRaw.values || !workflowsRaw.values) return { diagnostics };

  return {
    model: {
      manifestPath,
      actions: actionsRaw.values.map(normalizeAction).filter(isDefined),
      capabilities: capabilitiesRaw.values.map(normalizeCapability).filter(isDefined),
      workflows: workflowsRaw.values.map(normalizeWorkflow).filter(isDefined),
    },
    diagnostics,
  };
}

async function collectProductDiagnostics(ctx: RepoContext, severity: Severity): Promise<Diagnostic[]> {
  const result = await loadProductModel(ctx, severity);
  const diagnostics = [...result.diagnostics];
  if (!result.model) return diagnostics;

  diagnostics.push(...validateProductModel(ctx, result.model, severity));
  return diagnostics;
}

function validateProductModel(ctx: RepoContext, model: ProductModel, severity: Severity): Diagnostic[] {
  const opts = options(ctx);
  const diagnostics: Diagnostic[] = [];
  const actionIds = new Set(model.actions.map((action) => action.id));
  const capabilityIds = new Set(model.capabilities.map((capability) => capability.id));
  const workflowIds = new Set(model.workflows.map((workflow) => workflow.id));
  const knownVerificationKinds = new Set(opts.knownVerificationKinds);
  const referencedActions = new Set<string>();
  const referencedWorkflows = new Set<string>();

  diagnostics.push(...validateUniqueIds(model.actions, "action", model.manifestPath, severity));
  diagnostics.push(...validateUniqueIds(model.capabilities, "capability", model.manifestPath, severity));
  diagnostics.push(...validateUniqueIds(model.workflows, "workflow", model.manifestPath, severity));

  for (const action of model.actions) {
    if (!KEBAB_CASE.test(action.id)) {
      diagnostics.push(
        diagnostic("product/id-format", severity, `action id must be kebab-case: ${action.id}`, {
          path: model.manifestPath,
          target: action.id,
        }),
      );
    }

    if (!action.label || !action.surface || !action.boundary) {
      diagnostics.push(
        diagnostic(
          "product/action-shape",
          severity,
          `action "${action.id}" must define label, surface, and boundary`,
          {
            path: model.manifestPath,
            target: action.id,
          },
        ),
      );
    }

    const required = action.verification?.required ?? [];
    if (required.length === 0) {
      diagnostics.push(
        diagnostic("product/verification-required", severity, `action "${action.id}" must declare verification.required`, {
          path: model.manifestPath,
          target: action.id,
        }),
      );
    }

    for (const verificationKind of required) {
      if (!knownVerificationKinds.has(verificationKind)) {
        diagnostics.push(
          diagnostic(
            "product/verification-kind-known",
            severity,
            `action "${action.id}" uses unknown verification kind "${verificationKind}"`,
            {
              path: model.manifestPath,
              target: action.id,
              hint: "add the kind to product.knownVerificationKinds or use a standard verification kind",
            },
          ),
        );
      }
    }

    if (opts.requireBddForAllActions && !required.includes("bdd")) {
      diagnostics.push(
        diagnostic("product/action-requires-bdd", severity, `action "${action.id}" must require BDD`, {
          path: model.manifestPath,
          target: action.id,
        }),
      );
    }

    if (opts.requireUnitForMutations && action.kind === "mutation" && !required.includes("unit")) {
      diagnostics.push(
        diagnostic("product/mutation-requires-unit", severity, `mutation "${action.id}" must require unit coverage`, {
          path: model.manifestPath,
          target: action.id,
        }),
      );
    }

    if (action.workflow) {
      referencedWorkflows.add(action.workflow);
      if (!workflowIds.has(action.workflow)) {
        diagnostics.push(
          diagnostic(
            "product/action-workflow-known",
            severity,
            `action "${action.id}" references missing workflow "${action.workflow}"`,
            {
              path: model.manifestPath,
              target: action.id,
            },
          ),
        );
      }
    }

    if (action.kind === "mutation" && action.risk === "high") {
      const hasModelCoverage = required.includes("mbt") || Boolean(action.workflow);
      const hasExemption = Boolean(action.verification?.mbtExempt?.reason);
      if (!hasModelCoverage && !hasExemption) {
        diagnostics.push(
          diagnostic(
            "product/high-risk-mutation-model-coverage",
            severity,
            `high-risk mutation "${action.id}" must require model coverage or declare verification.mbtExempt.reason`,
            {
              path: model.manifestPath,
              target: action.id,
              hint: "add mbt to verification.required, attach a workflow, or add a specific exemption reason",
            },
          ),
        );
      }
    }
  }

  for (const capability of model.capabilities) {
    if (!KEBAB_CASE.test(capability.id)) {
      diagnostics.push(
        diagnostic("product/id-format", severity, `capability id must be kebab-case: ${capability.id}`, {
          path: model.manifestPath,
          target: capability.id,
        }),
      );
    }

    if (!capability.label) {
      diagnostics.push(
        diagnostic("product/capability-shape", severity, `capability "${capability.id}" must define label`, {
          path: model.manifestPath,
          target: capability.id,
        }),
      );
    }

    if (capability.tag && capability.tag !== `@capability.${capability.id}`) {
      diagnostics.push(
        diagnostic(
          "product/capability-tag",
          severity,
          `capability "${capability.id}" tag must be @capability.${capability.id}`,
          {
            path: model.manifestPath,
            target: capability.id,
          },
        ),
      );
    }

    if (capability.cucumberFeatures.length === 0) {
      diagnostics.push(
        diagnostic(
          "product/capability-feature-required",
          severity,
          `capability "${capability.id}" must list at least one Cucumber feature`,
          {
            path: model.manifestPath,
            target: capability.id,
          },
        ),
      );
    }

    for (const actionId of capability.requiredActions) {
      referencedActions.add(actionId);
      if (!actionIds.has(actionId)) {
        diagnostics.push(
          diagnostic(
            "product/capability-action-known",
            severity,
            `capability "${capability.id}" references missing action "${actionId}"`,
            {
              path: model.manifestPath,
              target: capability.id,
            },
          ),
        );
      }
    }

    for (const workflowId of capability.workflows) {
      referencedWorkflows.add(workflowId);
      if (!workflowIds.has(workflowId)) {
        diagnostics.push(
          diagnostic(
            "product/capability-workflow-known",
            severity,
            `capability "${capability.id}" references missing workflow "${workflowId}"`,
            {
              path: model.manifestPath,
              target: capability.id,
            },
          ),
        );
      }
    }
  }

  for (const action of model.actions) {
    if (!referencedActions.has(action.id)) {
      diagnostics.push(
        diagnostic(
          "product/action-owned",
          severity,
          `action "${action.id}" must belong to at least one capability requiredActions list`,
          {
            path: model.manifestPath,
            target: action.id,
          },
        ),
      );
    }
  }

  for (const workflow of model.workflows) {
    if (!KEBAB_CASE.test(workflow.id)) {
      diagnostics.push(
        diagnostic("product/id-format", severity, `workflow id must be kebab-case: ${workflow.id}`, {
          path: model.manifestPath,
          target: workflow.id,
        }),
      );
    }

    if (!referencedWorkflows.has(workflow.id)) {
      diagnostics.push(
        diagnostic("product/workflow-owned", severity, `workflow "${workflow.id}" must be referenced by an action or capability`, {
          path: model.manifestPath,
          target: workflow.id,
        }),
      );
    }

    const states = new Set(workflow.states);
    const events = new Set(workflow.events);

    if (workflow.initialState && !states.has(workflow.initialState)) {
      diagnostics.push(
        diagnostic(
          "product/workflow-state-known",
          severity,
          `workflow "${workflow.id}" initial state "${workflow.initialState}" is not listed in states`,
          {
            path: model.manifestPath,
            target: workflow.id,
          },
        ),
      );
    }

    for (const event of workflow.events) {
      if (!actionIds.has(event)) {
        diagnostics.push(
          diagnostic("product/workflow-event-known", severity, `workflow "${workflow.id}" references missing action "${event}"`, {
            path: model.manifestPath,
            target: workflow.id,
          }),
        );
      }
    }

    for (const transition of workflow.transitions) {
      if (transition.from && !states.has(transition.from)) {
        diagnostics.push(
          diagnostic(
            "product/workflow-state-known",
            severity,
            `workflow "${workflow.id}" transition uses unknown from-state "${transition.from}"`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
      if (transition.to && !states.has(transition.to)) {
        diagnostics.push(
          diagnostic(
            "product/workflow-state-known",
            severity,
            `workflow "${workflow.id}" transition uses unknown to-state "${transition.to}"`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
      if (transition.action && !events.has(transition.action)) {
        diagnostics.push(
          diagnostic(
            "product/workflow-event-known",
            severity,
            `workflow "${workflow.id}" transition uses action "${transition.action}" not listed in events`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
    }

    for (const forbidden of workflow.forbiddenTransitions) {
      if (forbidden.state && !states.has(forbidden.state)) {
        diagnostics.push(
          diagnostic(
            "product/workflow-state-known",
            severity,
            `workflow "${workflow.id}" forbidden transition uses unknown state "${forbidden.state}"`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
      if (forbidden.action && !events.has(forbidden.action)) {
        diagnostics.push(
          diagnostic(
            "product/workflow-event-known",
            severity,
            `workflow "${workflow.id}" forbidden transition uses action "${forbidden.action}" not listed in events`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
      if (!forbidden.reason) {
        diagnostics.push(
          diagnostic(
            "product/workflow-forbidden-reason",
            severity,
            `workflow "${workflow.id}" forbidden transition must explain why it is forbidden`,
            { path: model.manifestPath, target: workflow.id },
          ),
        );
      }
    }
  }

  return diagnostics;
}

function validateUniqueIds(
  items: Array<{ id: string }>,
  kind: string,
  manifestPath: string,
  severity: Severity,
): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      continue;
    }

    diagnostics.push(
      diagnostic("product/id-unique", severity, `duplicate ${kind} id "${item.id}"`, {
        path: manifestPath,
        target: item.id,
      }),
    );
  }

  return diagnostics;
}

async function importManifest(
  ctx: RepoContext,
  manifestPath: string,
  severity: Severity,
): Promise<{ module?: Record<string, unknown>; diagnostics: Diagnostic[] }> {
  const absolutePath = join(ctx.root, manifestPath);

  try {
    const mtime = statSync(absolutePath).mtimeMs;
    const moduleUrl = `${pathToFileURL(absolutePath).href}?mtime=${mtime}`;
    const loaded = (await import(moduleUrl)) as Record<string, unknown>;
    return { module: loaded, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("product/manifest-load", severity, `product manifest could not be loaded: ${messageFor(error)}`, {
          path: manifestPath,
          target: manifestPath,
          hint: "export plain runtime values from the manifest module",
        }),
      ],
    };
  }
}

function exportedCollection(
  moduleExports: Record<string, unknown>,
  exportName: string,
  label: string,
  manifestPath: string,
  severity: Severity,
  options: { optional?: boolean } = {},
): { values?: unknown[]; diagnostics: Diagnostic[] } {
  const value = moduleExports[exportName];
  if (value == null && options.optional) return { values: [], diagnostics: [] };

  if (value == null) {
    return {
      diagnostics: [
        diagnostic("product/manifest-exports-required", severity, `product manifest must export ${exportName}`, {
          path: manifestPath,
          target: exportName,
        }),
      ],
    };
  }

  const values = collectionValues(value);
  if (!values) {
    return {
      diagnostics: [
        diagnostic("product/manifest-exports-required", severity, `${exportName} must be an array or object map of ${label}`, {
          path: manifestPath,
          target: exportName,
        }),
      ],
    };
  }

  return { values, diagnostics: [] };
}

function collectionValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return undefined;
}

function normalizeAction(value: unknown): ProductAction | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const verification = isRecord(value.verification) ? value.verification : undefined;
  const mbtExempt = isRecord(verification?.mbtExempt) ? verification.mbtExempt : undefined;

  return {
    id: value.id,
    label: stringValue(value.label),
    kind: stringValue(value.kind),
    actor: stringValue(value.actor),
    surface: stringValue(value.surface),
    risk: stringValue(value.risk),
    auth: stringValue(value.auth),
    boundary: stringValue(value.boundary),
    workflow: value.workflow === null ? null : stringValue(value.workflow),
    verification: {
      required: stringArray(verification?.required),
      mbtExempt: mbtExempt ? { reason: stringValue(mbtExempt.reason) } : undefined,
    },
    raw: value,
  };
}

function normalizeCapability(value: unknown): ProductCapability | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    label: stringValue(value.label),
    tag: stringValue(value.tag),
    cucumberFeatures: stringArray(value.cucumberFeatures),
    requiredActions: stringArray(value.requiredActions),
    workflows: stringArray(value.workflows),
    raw: value,
  };
}

function normalizeWorkflow(value: unknown): ProductWorkflow | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    label: stringValue(value.label),
    initialState: stringValue(value.initialState),
    states: stringArray(value.states),
    events: stringArray(value.events),
    transitions: objectArray(value.transitions).map((transition) => ({
      from: stringValue(transition.from),
      action: stringValue(transition.action),
      to: stringValue(transition.to),
    })),
    forbiddenTransitions: objectArray(value.forbiddenTransitions).map((transition) => ({
      state: stringValue(transition.state),
      action: stringValue(transition.action),
      reason: stringValue(transition.reason),
    })),
    requiredCoverage: stringArray(value.requiredCoverage),
    evidence: stringArray(value.evidence),
    raw: value,
  };
}

function defaultManifestTemplate(): string {
  return `export const actionCapabilities = {
  runCheck: {
    id: "run-check",
    label: "Run strict EAC check",
    kind: "verification",
    actor: "developer",
    surface: "CLI",
    risk: "medium",
    auth: "none",
    boundary: "eac check",
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
    requiredActions: ["run-check"],
    workflows: [],
  },
} as const;

export const userActionWorkflows = {} as const;
`;
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
    source: productManifestAdapter.id,
    ...fields,
  };
}

function options(ctx: RepoContext): Required<ProductManifestOptions> {
  return productOptions(ctx);
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function productManifestNodeId(path: string): string {
  return `product-manifest:${path}`;
}

export function capabilityNodeId(id: string): string {
  return `capability:${id}`;
}

export function actionNodeId(id: string): string {
  return `action:${id}`;
}

export function workflowNodeId(id: string): string {
  return `workflow:${id}`;
}

export function artifactNodeId(path: string): string {
  return `artifact:${path}`;
}

export function fileExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}
