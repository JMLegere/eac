import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Artifact, Diagnostic, GraphContribution, RepoContext, Rule, Severity } from "../core/types";

const DEFAULT_TERRAFORM_DIR = "infra/terraform";
const DEFAULT_TFVARS_EXAMPLE = "infra/terraform/terraform.tfvars.example";
const DEFAULT_PACKAGE_JSON = "package.json";

export type TerraformOwnershipBoundaryCheck = {
  path: string;
  pattern: string;
  description?: string;
};

export type InfraTerraformOptions = {
  terraformDir?: string;
  tfvarsExample?: string;
  packageJson?: string;
  requireTfvarsExample?: boolean;
  requiredScriptKeys?: string[];
  ownershipBoundaryChecks?: TerraformOwnershipBoundaryCheck[];
};

type TerraformProvider = { name: string };

type TerraformVariable = { name: string };

type TerraformResource = { kind: "resource" | "data"; type: string; name: string };

export const infraTerraformAdapter: Adapter = {
  id: "infra/terraform",
  description: "Terraform infrastructure-as-code checks for static source truth and ownership boundaries.",

  artifacts(ctx): Artifact[] {
    const opts = options(ctx);
    return artifactPaths(ctx, opts).map((path) => ({
      id: `infra:terraform:${path}`,
      path,
      kind: path === opts.tfvarsExample ? "terraform-tfvars-example" : "terraform-source",
      source: infraTerraformAdapter.id,
      required: path.endsWith(".tf") || (opts.requireTfvarsExample && path === opts.tfvarsExample),
    }));
  },

  graph(ctx): GraphContribution {
    const opts = options(ctx);
    const parsed = parseTerraformSources(ctx, opts);

    return {
      nodes: [
        {
          id: "infra-provider:terraform",
          kind: "infra-provider",
          label: "Terraform",
          path: opts.terraformDir,
          source: infraTerraformAdapter.id,
        },
        ...parsed.providers.map((provider) => ({
          id: terraformProviderNodeId(provider.name),
          kind: "terraform-provider",
          label: provider.name,
          path: opts.terraformDir,
          source: infraTerraformAdapter.id,
        })),
        ...parsed.variables.map((variable) => ({
          id: terraformVariableNodeId(variable.name),
          kind: "terraform-variable",
          label: variable.name,
          path: opts.terraformDir,
          source: infraTerraformAdapter.id,
        })),
        ...parsed.resources.map((resource) => ({
          id: terraformResourceNodeId(resource.kind, resource.type, resource.name),
          kind: resource.kind === "data" ? "terraform-data-source" : "terraform-resource",
          label: `${resource.type}.${resource.name}`,
          path: opts.terraformDir,
          source: infraTerraformAdapter.id,
        })),
      ],
      edges: [
        ...parsed.providers.map((provider) => ({
          from: "infra-provider:terraform",
          to: terraformProviderNodeId(provider.name),
          kind: "declares-provider",
          source: infraTerraformAdapter.id,
        })),
        ...parsed.variables.map((variable) => ({
          from: "infra-provider:terraform",
          to: terraformVariableNodeId(variable.name),
          kind: "declares-variable",
          source: infraTerraformAdapter.id,
        })),
        ...parsed.resources.map((resource) => ({
          from: "infra-provider:terraform",
          to: terraformResourceNodeId(resource.kind, resource.type, resource.name),
          kind: resource.kind === "data" ? "declares-data-source" : "declares-resource",
          source: infraTerraformAdapter.id,
        })),
      ],
    };
  },

  doctor(ctx): Diagnostic[] {
    return collectTerraformDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "infra/terraform-valid",
        description: "Terraform source, variables, providers, scripts, and ownership boundaries satisfy the infrastructure contract.",
        source: infraTerraformAdapter.id,
        check(checkCtx) {
          return collectTerraformDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function collectTerraformDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);
  const parsed = parseTerraformSources(ctx, opts);

  return [
    ...validateTerraformDirectory(ctx, opts, parsed, severity),
    ...validateTfvarsExample(ctx, opts, parsed.variables, severity),
    ...validatePackageScripts(ctx, opts, severity),
    ...validateOwnershipBoundaries(ctx, opts, severity),
  ];
}

function validateTerraformDirectory(
  ctx: RepoContext,
  opts: Required<InfraTerraformOptions>,
  parsed: ReturnType<typeof parseTerraformSources>,
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!pathExists(ctx.root, opts.terraformDir)) {
    diagnostics.push(
      diagnostic("infra/terraform-dir-required", severity, `${opts.terraformDir}: Terraform directory is missing`, {
        path: opts.terraformDir,
        target: opts.terraformDir,
      }),
    );
    return diagnostics;
  }

  if (parsed.files.length === 0) {
    diagnostics.push(
      diagnostic("infra/terraform-source-required", severity, `${opts.terraformDir}: no .tf sources were found`, {
        path: opts.terraformDir,
        target: opts.terraformDir,
      }),
    );
    return diagnostics;
  }

  if (!parsed.hasTerraformBlock) {
    diagnostics.push(
      diagnostic("infra/terraform-block", severity, `${opts.terraformDir}: Terraform sources must define a terraform block`, {
        path: opts.terraformDir,
        target: "terraform",
      }),
    );
  }

  if (!parsed.hasRequiredProviders) {
    diagnostics.push(
      diagnostic("infra/terraform-required-providers", severity, `${opts.terraformDir}: Terraform sources must define required_providers`, {
        path: opts.terraformDir,
        target: "required_providers",
      }),
    );
  }

  if (parsed.providers.length === 0) {
    diagnostics.push(
      diagnostic("infra/terraform-provider-block", severity, `${opts.terraformDir}: Terraform sources must define at least one provider block`, {
        path: opts.terraformDir,
        target: "provider",
      }),
    );
  }

  if (parsed.variables.length === 0) {
    diagnostics.push(
      diagnostic("infra/terraform-variable-required", severity, `${opts.terraformDir}: Terraform sources must declare at least one variable`, {
        path: opts.terraformDir,
        target: "variable",
      }),
    );
  }


  return diagnostics;
}

function validateTfvarsExample(
  ctx: RepoContext,
  opts: Required<InfraTerraformOptions>,
  variables: TerraformVariable[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!pathExists(ctx.root, opts.tfvarsExample)) {
    if (opts.requireTfvarsExample) {
      diagnostics.push(
        diagnostic("infra/terraform-tfvars-example", severity, `${opts.tfvarsExample}: Terraform example variables file is missing`, {
          path: opts.tfvarsExample,
          target: opts.tfvarsExample,
        }),
      );
    }
    return diagnostics;
  }

  const source = ctx.fs.readText(opts.tfvarsExample);
  const assignments = parseTfvarsAssignments(source);
  if (assignments.length === 0) {
    diagnostics.push(
      diagnostic("infra/terraform-tfvars-example", severity, `${opts.tfvarsExample}: example variables file should contain assignments`, {
        path: opts.tfvarsExample,
        target: opts.tfvarsExample,
      }),
    );
    return diagnostics;
  }

  const variableNames = new Set(variables.map((variable) => variable.name));
  for (const assignment of assignments) {
    if (variableNames.has(assignment)) continue;
    diagnostics.push(
      diagnostic("infra/terraform-tfvars-assignment-known", severity, `${opts.tfvarsExample}: ${assignment} is not declared by Terraform variables`, {
        path: opts.tfvarsExample,
        target: assignment,
      }),
    );
  }

  return diagnostics;
}

function validatePackageScripts(ctx: RepoContext, opts: Required<InfraTerraformOptions>, severity: Severity): Diagnostic[] {
  if (opts.requiredScriptKeys.length === 0) return [];
  if (!ctx.fs.exists(opts.packageJson)) {
    return [
      diagnostic("infra/terraform-package-json", severity, `${opts.packageJson}: package.json is required for configured Terraform script checks`, {
        path: opts.packageJson,
        target: opts.packageJson,
      }),
    ];
  }

  try {
    const pkg = ctx.fs.readJson<{ scripts?: Record<string, string> }>(opts.packageJson);
    const scripts = pkg.scripts ?? {};
    return opts.requiredScriptKeys
      .filter((script) => !(script in scripts))
      .map((script) =>
        diagnostic("infra/terraform-script-required", severity, `${opts.packageJson}: missing Terraform script ${script}`, {
          path: opts.packageJson,
          target: script,
        }),
      );
  } catch {
    return [];
  }
}

function validateOwnershipBoundaries(
  ctx: RepoContext,
  opts: Required<InfraTerraformOptions>,
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const check of opts.ownershipBoundaryChecks) {
    if (!ctx.fs.exists(check.path)) {
      diagnostics.push(
        diagnostic("infra/terraform-ownership-boundary-file", severity, `${check.path}: ownership boundary file is missing`, {
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
        "infra/terraform-ownership-boundary",
        severity,
        `${check.path}: missing ownership boundary evidence${check.description ? ` (${check.description})` : ""}`,
        {
          path: check.path,
          target: check.pattern,
        },
      ),
    );
  }
  return diagnostics;
}

function artifactPaths(ctx: RepoContext, opts: Required<InfraTerraformOptions>): string[] {
  const tfSources = walkTerraformSources(ctx.root, opts.terraformDir);
  return unique([
    ...tfSources,
    ...[opts.tfvarsExample].filter((path) => pathExists(ctx.root, path)),
  ]);
}

function parseTerraformSources(ctx: RepoContext, opts: Required<InfraTerraformOptions>) {
  const files = walkTerraformSources(ctx.root, opts.terraformDir);
  const providers: TerraformProvider[] = [];
  const variables: TerraformVariable[] = [];
  const resources: TerraformResource[] = [];
  let hasTerraformBlock = false;
  let hasRequiredProviders = false;

  for (const path of files) {
    const source = ctx.fs.readText(path);
    if (/\bterraform\s*\{/.test(source)) hasTerraformBlock = true;
    if (/\brequired_providers\s*=|\brequired_providers\s*\{/.test(source)) hasRequiredProviders = true;

    for (const match of source.matchAll(/\bprovider\s+"([^"]+)"\s*\{/g)) {
      providers.push({ name: match[1] });
    }
    for (const match of source.matchAll(/\bvariable\s+"([^"]+)"\s*\{/g)) {
      variables.push({ name: match[1] });
    }
    for (const match of source.matchAll(/\bresource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g)) {
      resources.push({ kind: "resource", type: match[1], name: match[2] });
    }
    for (const match of source.matchAll(/\bdata\s+"([^"]+)"\s+"([^"]+)"\s*\{/g)) {
      resources.push({ kind: "data", type: match[1], name: match[2] });
    }
  }

  return {
    files,
    providers: dedupeBy(providers, (provider) => provider.name),
    variables: dedupeBy(variables, (variable) => variable.name),
    resources: dedupeBy(resources, (resource) => `${resource.kind}:${resource.type}.${resource.name}`),
    hasTerraformBlock,
    hasRequiredProviders,
  };
}

function walkTerraformSources(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = join(absoluteDirectory, entry.name);
    const relativePath = normalizePath(join(directory, entry.name));
    if (entry.isDirectory()) continue;
    if (entry.isFile() && entry.name.endsWith(".tf")) files.push(relativePath);
  }
  return files.sort();
}

function parseTfvarsAssignments(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

function options(ctx: RepoContext): Required<InfraTerraformOptions> {
  const configured = rawOptions(ctx);
  return {
    terraformDir: configured.terraformDir ?? DEFAULT_TERRAFORM_DIR,
    tfvarsExample: configured.tfvarsExample ?? DEFAULT_TFVARS_EXAMPLE,
    packageJson: configured.packageJson ?? DEFAULT_PACKAGE_JSON,
    requireTfvarsExample: configured.requireTfvarsExample ?? false,
    requiredScriptKeys: configured.requiredScriptKeys ?? [],
    ownershipBoundaryChecks: configured.ownershipBoundaryChecks ?? [],
  };
}

function rawOptions(ctx: RepoContext): InfraTerraformOptions {
  const configured = ctx.adapterOptions<InfraTerraformOptions & { terraform?: InfraTerraformOptions }>(infraTerraformAdapter.id) ?? {};
  return configured.terraform ?? configured;
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
    source: infraTerraformAdapter.id,
    ...fields,
  };
}

function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function terraformProviderNodeId(name: string): string {
  return `terraform-provider:${name}`;
}

function terraformVariableNodeId(name: string): string {
  return `terraform-variable:${name}`;
}

function terraformResourceNodeId(kind: "resource" | "data", type: string, name: string): string {
  return `${kind === "data" ? "terraform-data" : "terraform-resource"}:${type}.${name}`;
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}
