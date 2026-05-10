import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Artifact, Diagnostic, GraphContribution, RepoContext, Rule, Severity } from "../core/types";

const DEFAULT_WRANGLER_CONFIG = "wrangler.jsonc";
const DEFAULT_PACKAGE_JSON = "package.json";
const DEFAULT_ENV_EXAMPLE = ".env.example";
const DEFAULT_DEPLOY_SCRIPT = "scripts/deploy-cloudflare.sh";

export type CloudflareWorkflowCheck = {
  path: string;
  pattern: string;
  description?: string;
};

export type CloudflareDeployOptions = {
  wranglerConfig?: string;
  packageJson?: string;
  envExample?: string;
  deployScript?: string;
  workerSource?: string;
  requireWorkerSource?: boolean;
  requireAssets?: boolean;
  requireRoutes?: boolean;
  requireCustomDomains?: boolean;
  requireEnvExample?: boolean;
  requireWranglerDependency?: boolean;
  requiredEnvKeys?: string[];
  requiredScriptKeys?: string[];
  requiredDeployScriptPatterns?: string[];
  requiredWorkflowChecks?: CloudflareWorkflowCheck[];
};

type WranglerRoute = { pattern?: string; custom_domain?: boolean };
type WranglerAssets = { directory?: string; binding?: string; not_found_handling?: string };
type WranglerConfig = {
  name?: string;
  compatibility_date?: string;
  main?: string;
  workers_dev?: boolean;
  routes?: WranglerRoute[];
  assets?: WranglerAssets;
  vars?: Record<string, unknown>;
};

type ParsedWrangler = {
  config: WranglerConfig | null;
  error?: string;
};

export const deployCloudflareAdapter: Adapter = {
  id: "deploy/cloudflare",
  description: "Cloudflare/Wrangler deployment checks for static runtime deployment contract evidence.",

  artifacts(ctx): Artifact[] {
    const opts = options(ctx);
    const parsed = parseWranglerConfig(ctx, opts);
    return artifactPaths(ctx, opts, parsed.config).map((path) => ({
      id: `deploy:cloudflare:${path}`,
      path,
      kind: artifactKind(path, opts, parsed.config),
      source: deployCloudflareAdapter.id,
      required: isRequiredArtifact(path, opts),
    }));
  },

  graph(ctx): GraphContribution {
    const opts = options(ctx);
    const parsed = parseWranglerConfig(ctx, opts);
    const config = parsed.config;
    if (!config) return { nodes: [], edges: [] };

    const targetId = cloudflareTargetNodeId(config.name ?? "worker");
    const routes = normalizeRoutes(config.routes);
    const vars = config.vars && typeof config.vars === "object" ? Object.keys(config.vars).sort() : [];
    const assets = normalizeAssets(config.assets);

    return {
      nodes: [
        {
          id: targetId,
          kind: "cloudflare-deployment",
          label: config.name ?? "Cloudflare deployment",
          path: opts.wranglerConfig,
          source: deployCloudflareAdapter.id,
          data: {
            compatibilityDate: config.compatibility_date,
            main: config.main,
            workersDev: config.workers_dev,
          },
        },
        ...routes.map((route) => ({
          id: cloudflareRouteNodeId(route.pattern ?? "unknown"),
          kind: "cloudflare-route",
          label: route.pattern,
          path: opts.wranglerConfig,
          source: deployCloudflareAdapter.id,
          data: { customDomain: route.custom_domain ?? false },
        })),
        ...(assets
          ? [
              {
                id: cloudflareAssetsNodeId(assets.binding ?? assets.directory ?? "assets"),
                kind: "cloudflare-assets-binding",
                label: assets.binding ?? assets.directory ?? "assets",
                path: opts.wranglerConfig,
                source: deployCloudflareAdapter.id,
                data: {
                  directory: assets.directory,
                  binding: assets.binding,
                  notFoundHandling: assets.not_found_handling,
                },
              },
            ]
          : []),
        ...vars.map((key) => ({
          id: cloudflareVarNodeId(key),
          kind: "cloudflare-runtime-var",
          label: key,
          path: opts.wranglerConfig,
          source: deployCloudflareAdapter.id,
        })),
      ],
      edges: [
        ...routes.map((route) => ({
          from: targetId,
          to: cloudflareRouteNodeId(route.pattern ?? "unknown"),
          kind: "owns-route",
          source: deployCloudflareAdapter.id,
        })),
        ...(assets
          ? [
              {
                from: targetId,
                to: cloudflareAssetsNodeId(assets.binding ?? assets.directory ?? "assets"),
                kind: "binds-assets",
                source: deployCloudflareAdapter.id,
              },
            ]
          : []),
        ...vars.map((key) => ({
          from: targetId,
          to: cloudflareVarNodeId(key),
          kind: "defines-runtime-var",
          source: deployCloudflareAdapter.id,
        })),
      ],
    };
  },

  doctor(ctx): Diagnostic[] {
    return collectCloudflareDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "deploy/cloudflare-valid",
        description: "Cloudflare Wrangler config, deploy scripts, environment prerequisites, and optional CI wiring satisfy the deployment contract.",
        source: deployCloudflareAdapter.id,
        check(checkCtx) {
          return collectCloudflareDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function collectCloudflareDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);
  const parsed = parseWranglerConfig(ctx, opts);

  return [
    ...validateWranglerConfig(ctx, opts, parsed, severity),
    ...validateEnvExample(ctx, opts, severity),
    ...validatePackageJson(ctx, opts, severity),
    ...validateDeployScript(ctx, opts, severity),
    ...validateWorkflowChecks(ctx, opts, severity),
  ];
}

function validateWranglerConfig(
  ctx: RepoContext,
  opts: Required<CloudflareDeployOptions>,
  parsed: ParsedWrangler,
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!ctx.fs.exists(opts.wranglerConfig)) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-wrangler-required", severity, `${opts.wranglerConfig}: Wrangler config is missing`, {
        path: opts.wranglerConfig,
        target: opts.wranglerConfig,
      }),
    );
    return diagnostics;
  }

  if (!parsed.config) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-wrangler-parse", severity, `${opts.wranglerConfig}: Wrangler config is not parseable JSONC${parsed.error ? ` (${parsed.error})` : ""}`, {
        path: opts.wranglerConfig,
        target: opts.wranglerConfig,
      }),
    );
    return diagnostics;
  }

  const config = parsed.config;

  if (!hasText(config.name)) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-worker-name", severity, `${opts.wranglerConfig}: Wrangler config must define a worker name`, {
        path: opts.wranglerConfig,
        target: "name",
      }),
    );
  }

  if (!hasText(config.compatibility_date)) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-compatibility-date", severity, `${opts.wranglerConfig}: Wrangler config must define compatibility_date`, {
        path: opts.wranglerConfig,
        target: "compatibility_date",
      }),
    );
  }

  const workerSource = opts.workerSource || config.main;
  if (opts.requireWorkerSource || hasText(workerSource)) {
    if (!hasText(workerSource)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-worker-main", severity, `${opts.wranglerConfig}: Wrangler config must define main`, {
          path: opts.wranglerConfig,
          target: "main",
        }),
      );
    } else if (!ctx.fs.exists(workerSource)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-worker-source", severity, `${workerSource}: Worker entrypoint is missing`, {
          path: workerSource,
          target: workerSource,
        }),
      );
    }
  }

  const assets = normalizeAssets(config.assets);
  if (opts.requireAssets && !assets) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-assets-required", severity, `${opts.wranglerConfig}: assets binding is required for this deployment contract`, {
        path: opts.wranglerConfig,
        target: "assets",
      }),
    );
  }
  if (assets) {
    if (!hasText(assets.directory)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-assets-directory", severity, `${opts.wranglerConfig}: assets.directory is required when assets are configured`, {
          path: opts.wranglerConfig,
          target: "assets.directory",
        }),
      );
    }
    if (!hasText(assets.binding)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-assets-binding", severity, `${opts.wranglerConfig}: assets.binding is required when assets are configured`, {
          path: opts.wranglerConfig,
          target: "assets.binding",
        }),
      );
    }
  }

  const routes = normalizeRoutes(config.routes);
  if (opts.requireRoutes && routes.length === 0) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-routes-required", severity, `${opts.wranglerConfig}: at least one Cloudflare route is required`, {
        path: opts.wranglerConfig,
        target: "routes",
      }),
    );
  }
  for (const route of routes) {
    if (!hasText(route.pattern)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-route-pattern", severity, `${opts.wranglerConfig}: every route must define a pattern`, {
          path: opts.wranglerConfig,
          target: "routes.pattern",
        }),
      );
    }
    if (opts.requireCustomDomains && route.custom_domain !== true) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-custom-domain", severity, `${opts.wranglerConfig}: route ${route.pattern ?? "<missing>"} must set custom_domain: true`, {
          path: opts.wranglerConfig,
          target: route.pattern ?? "routes.custom_domain",
        }),
      );
    }
  }

  return diagnostics;
}

function validateEnvExample(ctx: RepoContext, opts: Required<CloudflareDeployOptions>, severity: Severity): Diagnostic[] {
  if (!opts.requireEnvExample && !ctx.fs.exists(opts.envExample)) return [];
  if (!ctx.fs.exists(opts.envExample)) {
    return [
      diagnostic("deploy/cloudflare-env-example", severity, `${opts.envExample}: environment example is missing`, {
        path: opts.envExample,
        target: opts.envExample,
      }),
    ];
  }

  const env = parseEnv(ctx.fs.readText(opts.envExample));
  return opts.requiredEnvKeys
    .filter((key) => !(key in env))
    .map((key) =>
      diagnostic("deploy/cloudflare-env-key", severity, `${opts.envExample}: missing Cloudflare deploy key ${key}`, {
        path: opts.envExample,
        target: key,
      }),
    );
}

function validatePackageJson(ctx: RepoContext, opts: Required<CloudflareDeployOptions>, severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const shouldCheckPackage = opts.requiredScriptKeys.length > 0 || opts.requireWranglerDependency;
  if (!shouldCheckPackage && !ctx.fs.exists(opts.packageJson)) return diagnostics;
  if (!ctx.fs.exists(opts.packageJson)) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-package-json", severity, `${opts.packageJson}: package manifest is required for configured Cloudflare checks`, {
        path: opts.packageJson,
        target: opts.packageJson,
      }),
    );
    return diagnostics;
  }

  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = ctx.fs.readJson(opts.packageJson);
  } catch {
    diagnostics.push(
      diagnostic("deploy/cloudflare-package-json-parse", severity, `${opts.packageJson}: package manifest is not parseable JSON`, {
        path: opts.packageJson,
        target: opts.packageJson,
      }),
    );
    return diagnostics;
  }

  const scripts = pkg.scripts ?? {};
  for (const script of opts.requiredScriptKeys) {
    if (script in scripts) continue;
    diagnostics.push(
      diagnostic("deploy/cloudflare-script-required", severity, `${opts.packageJson}: missing Cloudflare deploy script ${script}`, {
        path: opts.packageJson,
        target: script,
      }),
    );
  }

  if (opts.requireWranglerDependency && !("wrangler" in (pkg.dependencies ?? {})) && !("wrangler" in (pkg.devDependencies ?? {}))) {
    diagnostics.push(
      diagnostic("deploy/cloudflare-wrangler-dependency", severity, `${opts.packageJson}: missing wrangler dependency`, {
        path: opts.packageJson,
        target: "wrangler",
      }),
    );
  }

  return diagnostics;
}

function validateDeployScript(ctx: RepoContext, opts: Required<CloudflareDeployOptions>, severity: Severity): Diagnostic[] {
  if (opts.requiredDeployScriptPatterns.length === 0 && !ctx.fs.exists(opts.deployScript)) return [];
  if (!ctx.fs.exists(opts.deployScript)) {
    return [
      diagnostic("deploy/cloudflare-deploy-script", severity, `${opts.deployScript}: deploy script is missing`, {
        path: opts.deployScript,
        target: opts.deployScript,
      }),
    ];
  }

  const source = ctx.fs.readText(opts.deployScript);
  return opts.requiredDeployScriptPatterns
    .filter((pattern) => !source.includes(pattern))
    .map((pattern) =>
      diagnostic("deploy/cloudflare-deploy-script-pattern", severity, `${opts.deployScript}: missing deploy script evidence ${pattern}`, {
        path: opts.deployScript,
        target: pattern,
      }),
    );
}

function validateWorkflowChecks(ctx: RepoContext, opts: Required<CloudflareDeployOptions>, severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const check of opts.requiredWorkflowChecks) {
    if (!ctx.fs.exists(check.path)) {
      diagnostics.push(
        diagnostic("deploy/cloudflare-workflow-file", severity, `${check.path}: workflow file is missing`, {
          path: check.path,
          target: check.path,
        }),
      );
      continue;
    }

    const source = ctx.fs.readText(check.path);
    if (source.includes(check.pattern)) continue;
    diagnostics.push(
      diagnostic(
        "deploy/cloudflare-workflow-evidence",
        severity,
        `${check.path}: missing Cloudflare workflow evidence${check.description ? ` (${check.description})` : ""}`,
        {
          path: check.path,
          target: check.pattern,
        },
      ),
    );
  }
  return diagnostics;
}

function artifactPaths(ctx: RepoContext, opts: Required<CloudflareDeployOptions>, config: WranglerConfig | null): string[] {
  return unique(
    [
      opts.wranglerConfig,
      opts.packageJson,
      opts.envExample,
      opts.deployScript,
      opts.workerSource || config?.main,
      ...opts.requiredWorkflowChecks.map((check) => check.path),
    ].filter((path): path is string => typeof path === "string" && path.length > 0 && (isRequiredArtifact(path, opts) || pathExists(ctx.root, path))),
  );
}

function artifactKind(path: string, opts: Required<CloudflareDeployOptions>, config: WranglerConfig | null): string {
  if (path === opts.wranglerConfig) return "cloudflare-wrangler-config";
  if (path === opts.packageJson) return "package-manifest";
  if (path === opts.envExample) return "cloudflare-env-example";
  if (path === opts.deployScript) return "cloudflare-deploy-script";
  if (path === opts.workerSource || path === config?.main) return "cloudflare-worker-source";
  return "cloudflare-workflow";
}

function isRequiredArtifact(path: string, opts: Required<CloudflareDeployOptions>): boolean {
  if (path === opts.wranglerConfig) return true;
  if (path === opts.packageJson) return opts.requiredScriptKeys.length > 0 || opts.requireWranglerDependency;
  if (path === opts.envExample) return opts.requireEnvExample || opts.requiredEnvKeys.length > 0;
  if (path === opts.deployScript) return opts.requiredDeployScriptPatterns.length > 0;
  if (path === opts.workerSource) return opts.requireWorkerSource;
  return opts.requiredWorkflowChecks.some((check) => check.path === path);
}

function parseWranglerConfig(ctx: RepoContext, opts: Required<CloudflareDeployOptions>): ParsedWrangler {
  if (!ctx.fs.exists(opts.wranglerConfig)) return { config: null };
  try {
    const source = ctx.fs.readText(opts.wranglerConfig);
    return { config: JSON.parse(stripJsonc(source)) as WranglerConfig };
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function stripJsonc(source: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1");
}

function normalizeRoutes(routes: WranglerConfig["routes"]): WranglerRoute[] {
  return Array.isArray(routes) ? routes.filter((route) => route && typeof route === "object") : [];
}

function normalizeAssets(assets: WranglerConfig["assets"]): WranglerAssets | undefined {
  return assets && typeof assets === "object" ? assets : undefined;
}

function options(ctx: RepoContext): Required<CloudflareDeployOptions> {
  const configured = rawOptions(ctx);
  return {
    wranglerConfig: configured.wranglerConfig ?? DEFAULT_WRANGLER_CONFIG,
    packageJson: configured.packageJson ?? DEFAULT_PACKAGE_JSON,
    envExample: configured.envExample ?? DEFAULT_ENV_EXAMPLE,
    deployScript: configured.deployScript ?? DEFAULT_DEPLOY_SCRIPT,
    workerSource: configured.workerSource ?? "",
    requireWorkerSource: configured.requireWorkerSource ?? false,
    requireAssets: configured.requireAssets ?? false,
    requireRoutes: configured.requireRoutes ?? false,
    requireCustomDomains: configured.requireCustomDomains ?? false,
    requireEnvExample: configured.requireEnvExample ?? false,
    requireWranglerDependency: configured.requireWranglerDependency ?? false,
    requiredEnvKeys: configured.requiredEnvKeys ?? [],
    requiredScriptKeys: configured.requiredScriptKeys ?? [],
    requiredDeployScriptPatterns: configured.requiredDeployScriptPatterns ?? [],
    requiredWorkflowChecks: configured.requiredWorkflowChecks ?? [],
  };
}

function rawOptions(ctx: RepoContext): CloudflareDeployOptions {
  const configured = ctx.adapterOptions<CloudflareDeployOptions & { cloudflare?: CloudflareDeployOptions }>(deployCloudflareAdapter.id) ?? {};
  return configured.cloudflare ?? configured;
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
    source: deployCloudflareAdapter.id,
    ...fields,
  };
}

function parseEnv(source: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    parsed[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

function cloudflareTargetNodeId(name: string): string {
  return `cloudflare-deployment:${slug(name)}`;
}

function cloudflareRouteNodeId(pattern: string): string {
  return `cloudflare-route:${slug(pattern)}`;
}

function cloudflareAssetsNodeId(binding: string): string {
  return `cloudflare-assets:${slug(binding)}`;
}

function cloudflareVarNodeId(key: string): string {
  return `cloudflare-var:${slug(key)}`;
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}
