import { join } from "node:path";
import { resolveAdapters } from "../adapters";
import { adapterOptions, loadConfig } from "./config";
import { createFileSystem } from "./fs";
import { applyWaivers, validateWaivers } from "./waivers";
import type {
  Adapter,
  CommandMode,
  Diagnostic,
  InitAction,
  LoadedConfig,
  RepoContext,
  ResolvedInitAction,
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
  return { configPath: loadedConfig.path, diagnostics };
}

export async function runCheck(options: RunOptions = {}): Promise<DiagnosticsResult> {
  const { loadedConfig, adapters, ctx } = await createRuntime(options.root, "check");
  const diagnostics = await collectDiagnostics(adapters, ctx);
  const waiverDiagnostics = validateWaivers(ctx.config.waivers ?? []);
  const effectiveDiagnostics = applyWaivers(diagnostics, ctx.config.waivers ?? []);
  return { configPath: loadedConfig.path, diagnostics: [...effectiveDiagnostics, ...waiverDiagnostics] };
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
    adapterOptions<T = unknown>(adapterId: string): T | undefined {
      return adapterOptions<T>(loadedConfig.config, adapterId);
    },
    resolve(path: string): string {
      return join(root, path);
    },
    fs,
  };

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

  for (const adapter of adapters) {
    if (ctx.mode === "doctor" && adapter.doctor) {
      diagnostics.push(...(await adapter.doctor(ctx)));
    }

    if (!adapter.rules) continue;
    const rules = await adapter.rules(ctx);
    for (const rule of rules) {
      diagnostics.push(...(await rule.check(ctx)));
    }
  }

  return diagnostics;
}
