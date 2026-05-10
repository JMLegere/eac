import { join } from "node:path";
import { resolveAdapters } from "../adapters";
import { adapterOptions, loadConfig } from "./config";
import { createFileSystem } from "./fs";
import { applyWaivers, validateWaivers } from "./waivers";
import type {
  Adapter,
  Artifact,
  CommandMode,
  Diagnostic,
  GraphContribution,
  GraphEdge,
  GraphNode,
  InitAction,
  LoadedConfig,
  RepoContext,
  RepoGraph,
  ResolvedInitAction,
  Rule,
  Severity,
} from "./types";

export type RunOptions = {
  root?: string;
  json?: boolean;
};

export type InitOptions = RunOptions & {
  dryRun?: boolean;
  force?: boolean;
};

export type InitResult = {
  configPath?: string;
  dryRun: boolean;
  force: boolean;
  actions: ResolvedInitAction[];
};

export type DiagnosticsResult = {
  configPath?: string;
  diagnostics: Diagnostic[];
  graph: RepoGraph;
};

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const { loadedConfig, adapters, ctx } = await createRuntime(options.root, "init");
  const planned = await collectInitActions(adapters, ctx);
  const actions = resolveInitActions(planned, ctx, Boolean(options.force));

  if (!options.dryRun) {
    for (const action of actions) {
      if (action.action === "skip") continue;
      ctx.fs.writeText(action.path, action.content);
    }
  }

  return {
    configPath: loadedConfig.path,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    actions,
  };
}

export async function runDoctor(options: RunOptions = {}): Promise<DiagnosticsResult> {
  const { loadedConfig, adapters, ctx } = await createRuntime(options.root, "doctor");
  const diagnostics = await collectDiagnostics(adapters, ctx);
  return { configPath: loadedConfig.path, diagnostics, graph: ctx.graph };
}

export async function runCheck(options: RunOptions = {}): Promise<DiagnosticsResult> {
  const { loadedConfig, adapters, ctx } = await createRuntime(options.root, "check");
  const diagnostics = await collectDiagnostics(adapters, ctx);
  const waiverDiagnostics = validateWaivers(ctx.config.waivers ?? []);
  const effectiveDiagnostics = applyWaivers(diagnostics, ctx.config.waivers ?? []);
  return { configPath: loadedConfig.path, diagnostics: [...effectiveDiagnostics, ...waiverDiagnostics], graph: ctx.graph };
}

async function createRuntime(root = process.cwd(), mode: CommandMode): Promise<{
  loadedConfig: LoadedConfig;
  adapters: Adapter[];
  ctx: RepoContext;
}> {
  const loadedConfig = await loadConfig(root);
  const adapters = resolveAdapters(loadedConfig.config.adapters);
  const fs = createFileSystem(root);

  const ctx: RepoContext = {
    root,
    mode,
    configPath: loadedConfig.path,
    config: loadedConfig.config,
    graph: emptyGraph(),
    adapterOptions<T = unknown>(adapterId: string): T | undefined {
      return adapterOptions<T>(loadedConfig.config, adapterId);
    },
    resolve(path: string): string {
      return join(root, path);
    },
    fs,
  };

  ctx.graph = await collectGraph(adapters, ctx);

  return { loadedConfig, adapters, ctx };
}

async function collectInitActions(adapters: Adapter[], ctx: RepoContext): Promise<InitAction[]> {
  const actions: InitAction[] = [];

  for (const adapter of adapters) {
    if (!adapter.init) continue;
    actions.push(...(await adapter.init(ctx)));
  }

  return actions;
}

function resolveInitActions(actions: InitAction[], ctx: RepoContext, force: boolean): ResolvedInitAction[] {
  return actions.map((action) => {
    if (!ctx.fs.exists(action.path)) return { ...action, action: "create" };
    if (force) return { ...action, action: "overwrite" };
    return { ...action, action: "skip" };
  });
}

async function collectDiagnostics(adapters: Adapter[], ctx: RepoContext): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const rulesByAdapter: Array<{ adapter: Adapter; rule: Rule }> = [];

  for (const adapter of adapters) {
    if (ctx.mode === "doctor" && adapter.doctor) {
      diagnostics.push(...(await adapter.doctor(ctx)));
    }

    if (!adapter.rules) continue;
    const rules = await adapter.rules(ctx);
    for (const rule of rules) rulesByAdapter.push({ adapter, rule });
  }

  diagnostics.push(...validateKernelContracts(ctx, rulesByAdapter.map(({ rule }) => rule)));

  for (const { rule } of rulesByAdapter) {
    diagnostics.push(...(await rule.check(ctx)));
  }

  return diagnostics;
}

async function collectGraph(adapters: Adapter[], ctx: RepoContext): Promise<RepoGraph> {
  const artifacts = await collectArtifacts(adapters, ctx);
  const artifactNodes = artifacts.map(artifactToNode);
  const graph: RepoGraph = { artifacts, nodes: artifactNodes, edges: [] };
  ctx.graph = graph;

  const contributions: GraphContribution[] = [];
  for (const adapter of adapters) {
    if (!adapter.graph) continue;
    contributions.push(await adapter.graph(ctx));
  }

  return {
    artifacts,
    nodes: [...artifactNodes, ...contributions.flatMap((contribution) => contribution.nodes ?? [])],
    edges: contributions.flatMap((contribution) => contribution.edges ?? []),
  };
}

async function collectArtifacts(adapters: Adapter[], ctx: RepoContext): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];

  for (const adapter of adapters) {
    if (!adapter.artifacts) continue;
    artifacts.push(...(await adapter.artifacts(ctx)));
  }

  return artifacts;
}

function artifactToNode(artifact: Artifact): GraphNode {
  return {
    id: artifactNodeId(artifact.path),
    kind: "artifact",
    label: artifact.path,
    path: artifact.path,
    source: artifact.source,
    data: {
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      required: Boolean(artifact.required),
    },
  };
}

function validateKernelContracts(ctx: RepoContext, rules: Rule[]): Diagnostic[] {
  const severity = severityFor(ctx);
  return [
    ...validateUniqueRuleIds(rules, severity),
    ...validateUniqueArtifactIds(ctx.graph.artifacts, severity),
    ...validateUniqueGraphNodeIds(ctx.graph.nodes, severity),
    ...validateGraphEdges(ctx.graph.nodes, ctx.graph.edges, severity),
  ];
}

function validateUniqueRuleIds(rules: Rule[], severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Rule>();

  for (const rule of rules) {
    const previous = seen.get(rule.id);
    if (!previous) {
      seen.set(rule.id, rule);
      continue;
    }

    diagnostics.push({
      ruleId: "eac/rule-id-unique",
      severity,
      message: `duplicate rule id "${rule.id}" from ${previous.source} and ${rule.source}`,
      target: rule.id,
      hint: "rule ids must be globally unique across enabled adapters",
      source: "eac/kernel",
    });
  }

  return diagnostics;
}

function validateUniqueArtifactIds(artifacts: Artifact[], severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Artifact>();

  for (const artifact of artifacts) {
    const previous = seen.get(artifact.id);
    if (!previous) {
      seen.set(artifact.id, artifact);
      continue;
    }

    diagnostics.push({
      ruleId: "eac/artifact-id-unique",
      severity,
      message: `duplicate artifact id "${artifact.id}" from ${previous.source} and ${artifact.source}`,
      path: artifact.path,
      target: artifact.id,
      source: "eac/kernel",
    });
  }

  return diagnostics;
}

function validateUniqueGraphNodeIds(nodes: GraphNode[], severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, GraphNode>();

  for (const node of nodes) {
    const previous = seen.get(node.id);
    if (!previous) {
      seen.set(node.id, node);
      continue;
    }

    diagnostics.push({
      ruleId: "eac/graph-node-id-unique",
      severity,
      message: `duplicate graph node id "${node.id}" from ${previous.source} and ${node.source}`,
      path: node.path,
      target: node.id,
      source: "eac/kernel",
    });
  }

  return diagnostics;
}

function validateGraphEdges(nodes: GraphNode[], edges: GraphEdge[], severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      diagnostics.push({
        ruleId: "eac/graph-edge-endpoint",
        severity,
        message: `graph edge references missing from-node "${edge.from}"`,
        target: edge.from,
        source: "eac/kernel",
      });
    }

    if (!nodeIds.has(edge.to)) {
      diagnostics.push({
        ruleId: "eac/graph-edge-endpoint",
        severity,
        message: `graph edge references missing to-node "${edge.to}"`,
        target: edge.to,
        source: "eac/kernel",
      });
    }
  }

  return diagnostics;
}

function emptyGraph(): RepoGraph {
  return { artifacts: [], nodes: [], edges: [] };
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

function artifactNodeId(path: string): string {
  return `artifact:${path}`;
}
