import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Artifact, Diagnostic, GraphContribution, RepoContext, Rule, Severity } from "../core/types";

const DEFAULT_ENV_EXAMPLE = ".env.example";
const DEFAULT_RUNTIME_ENV_SOURCE = "src/env.ts";
const DEFAULT_ADAPTER_DIR = "src/adapters/supabase";
const DEFAULT_ADAPTER_INDEX = "src/adapters/supabase/index.ts";
const DEFAULT_CLIENT_SOURCE = "src/adapters/supabase/client.ts";
const DEFAULT_DATABASE_TYPES = "src/adapters/supabase/database.types.ts";
const DEFAULT_CONTAINER_SOURCE = "src/application/container.ts";
const DEFAULT_SERVER_RUNTIME_SOURCE = "src/worker.ts";
const DEFAULT_SUPABASE_CONFIG = "supabase/config.toml";
const DEFAULT_MIGRATIONS_DIR = "supabase/migrations";
const DEFAULT_PACKAGE_JSON = "package.json";
const DEFAULT_ENV_KEYS = [
  "VITE_DATA_SOURCE",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ORGANIZATION_ID",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_REGION",
];

export type DataSupabaseOptions = {
  envExample?: string;
  runtimeEnvSource?: string;
  adapterDir?: string;
  adapterIndex?: string;
  clientSource?: string;
  databaseTypes?: string;
  containerSource?: string;
  serverRuntimeSource?: string;
  supabaseConfig?: string;
  migrationsDir?: string;
  packageJson?: string;
  requiredEnvKeys?: string[];
  requireAppIntegration?: boolean;
  requireServerRuntime?: boolean;
  requireTypesScript?: boolean;
};

type SupabaseTable = {
  name: string;
};

type SupabaseMigration = {
  path: string;
  prefix?: string;
};

export const dataSupabaseAdapter: Adapter = {
  id: "data/supabase",
  description: "Supabase data-as-code checks for env, generated types, migrations, and application integration.",

  artifacts(ctx): Artifact[] {
    const opts = options(ctx);
    return artifactPaths(ctx, opts).map((path) => ({
      id: `data:supabase:${path}`,
      path,
      kind: supabaseArtifactKind(path, opts),
      source: dataSupabaseAdapter.id,
      required: coreRequiredArtifact(path, opts),
    }));
  },

  graph(ctx): GraphContribution {
    const opts = options(ctx);
    const tables = parseDatabaseTables(ctx, opts);
    const migrations = collectMigrations(ctx, opts);

    return {
      nodes: [
        {
          id: "data-provider:supabase",
          kind: "data-provider",
          label: "Supabase",
          source: dataSupabaseAdapter.id,
        },
        ...tables.map((table) => ({
          id: supabaseTableNodeId(table.name),
          kind: "data-table",
          label: table.name,
          path: opts.databaseTypes,
          source: dataSupabaseAdapter.id,
        })),
        ...migrations.map((migration) => ({
          id: supabaseMigrationNodeId(migration.path),
          kind: "data-migration",
          label: migration.path,
          path: migration.path,
          source: dataSupabaseAdapter.id,
          data: { prefix: migration.prefix },
        })),
      ],
      edges: [
        ...tables.map((table) => ({
          from: "data-provider:supabase",
          to: supabaseTableNodeId(table.name),
          kind: "defines-table",
          source: dataSupabaseAdapter.id,
        })),
        ...migrations.map((migration) => ({
          from: supabaseMigrationNodeId(migration.path),
          to: "data-provider:supabase",
          kind: "migrates",
          source: dataSupabaseAdapter.id,
        })),
      ],
    };
  },

  doctor(ctx): Diagnostic[] {
    return collectSupabaseDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "data/supabase-valid",
        description: "Supabase env, generated types, migrations, and integration artifacts satisfy the data contract.",
        source: dataSupabaseAdapter.id,
        check(checkCtx) {
          return collectSupabaseDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function collectSupabaseDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);
  return [
    ...validateRequiredArtifacts(ctx, opts, severity),
    ...validateEnvExample(ctx, opts, severity),
    ...validateRuntimeEnvSource(ctx, opts, severity),
    ...validateDatabaseTypes(ctx, opts, severity),
    ...validateTypedClient(ctx, opts, severity),
    ...validateAdapterIntegration(ctx, opts, severity),
    ...validateMigrations(ctx, opts, severity),
    ...validatePackageScripts(ctx, opts, severity),
  ];
}

function validateRequiredArtifacts(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const required = [opts.envExample, opts.databaseTypes, opts.supabaseConfig, opts.migrationsDir];
  if (opts.requireAppIntegration) required.push(opts.runtimeEnvSource, opts.adapterIndex, opts.clientSource, opts.containerSource);
  if (opts.requireServerRuntime) required.push(opts.serverRuntimeSource);

  for (const path of required) {
    if (pathExists(ctx.root, path)) continue;
    diagnostics.push(
      diagnostic("data/supabase-artifact-required", severity, `${path}: required Supabase contract artifact is missing`, {
        path,
        target: path,
        hint: "add the artifact or configure data.supabase/data options for this project",
      }),
    );
  }

  return diagnostics;
}

function validateEnvExample(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  if (!ctx.fs.exists(opts.envExample)) return [];
  const parsed = parseEnv(ctx.fs.readText(opts.envExample));
  const diagnostics: Diagnostic[] = [];

  for (const key of opts.requiredEnvKeys) {
    if (key in parsed) continue;
    diagnostics.push(
      diagnostic("data/supabase-env-key", severity, `${opts.envExample}: missing ${key}`, {
        path: opts.envExample,
        target: key,
      }),
    );
  }

  const dataSource = parsed.VITE_DATA_SOURCE || "auto";
  if (dataSource && !["auto", "memory", "supabase"].includes(dataSource)) {
    diagnostics.push(
      diagnostic("data/supabase-data-source-mode", severity, `${opts.envExample}: VITE_DATA_SOURCE must be auto, memory, or supabase`, {
        path: opts.envExample,
        target: "VITE_DATA_SOURCE",
      }),
    );
  }

  if (hasValue(parsed.VITE_SUPABASE_URL)) {
    try {
      const url = new URL(parsed.VITE_SUPABASE_URL);
      if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        diagnostics.push(
          diagnostic("data/supabase-url", severity, `${opts.envExample}: VITE_SUPABASE_URL must use https unless local`, {
            path: opts.envExample,
            target: "VITE_SUPABASE_URL",
          }),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic("data/supabase-url", severity, `${opts.envExample}: VITE_SUPABASE_URL must be a valid URL`, {
          path: opts.envExample,
          target: "VITE_SUPABASE_URL",
        }),
      );
    }
  }

  if (hasValue(parsed.SUPABASE_PROJECT_REF) && !/^[a-z0-9]{20}$/i.test(parsed.SUPABASE_PROJECT_REF)) {
    diagnostics.push(
      diagnostic("data/supabase-project-ref", severity, `${opts.envExample}: SUPABASE_PROJECT_REF should be a 20-character project ref`, {
        path: opts.envExample,
        target: "SUPABASE_PROJECT_REF",
      }),
    );
  }

  if (hasValue(parsed.SUPABASE_REGION) && !/^[a-z]+-[a-z]+-\d+$/.test(parsed.SUPABASE_REGION)) {
    diagnostics.push(
      diagnostic("data/supabase-region", severity, `${opts.envExample}: SUPABASE_REGION should look like a cloud region`, {
        path: opts.envExample,
        target: "SUPABASE_REGION",
      }),
    );
  }

  return diagnostics;
}

function validateRuntimeEnvSource(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  if (!ctx.fs.exists(opts.runtimeEnvSource)) return [];
  const source = ctx.fs.readText(opts.runtimeEnvSource);
  const diagnostics: Diagnostic[] = [];

  for (const mode of ["auto", "memory", "supabase"]) {
    if (source.includes(`'${mode}'`) || source.includes(`"${mode}"`)) continue;
    diagnostics.push(
      diagnostic("data/supabase-runtime-mode", severity, `${opts.runtimeEnvSource}: missing data source mode ${mode}`, {
        path: opts.runtimeEnvSource,
        target: mode,
      }),
    );
  }

  for (const key of ["VITE_DATA_SOURCE", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    if (source.includes(key)) continue;
    diagnostics.push(
      diagnostic("data/supabase-runtime-env-key", severity, `${opts.runtimeEnvSource}: missing runtime env key ${key}`, {
        path: opts.runtimeEnvSource,
        target: key,
      }),
    );
  }

  if (!source.includes("shouldUseSupabase")) {
    diagnostics.push(
      diagnostic("data/supabase-runtime-selector", severity, `${opts.runtimeEnvSource}: should expose a Supabase runtime selector`, {
        path: opts.runtimeEnvSource,
        target: "shouldUseSupabase",
      }),
    );
  }

  return diagnostics;
}

function validateDatabaseTypes(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  if (!ctx.fs.exists(opts.databaseTypes)) return [];
  const source = ctx.fs.readText(opts.databaseTypes);
  const diagnostics: Diagnostic[] = [];

  if (!/export\s+type\s+Database\s*=/.test(source)) {
    diagnostics.push(
      diagnostic("data/supabase-database-types", severity, `${opts.databaseTypes}: must export type Database`, {
        path: opts.databaseTypes,
        target: "Database",
      }),
    );
  }

  if (!/\bTables:\s*\{/.test(source)) {
    diagnostics.push(
      diagnostic("data/supabase-database-tables", severity, `${opts.databaseTypes}: must include generated public Tables`, {
        path: opts.databaseTypes,
        target: "Tables",
      }),
    );
  }

  return diagnostics;
}

function validateTypedClient(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  if (!ctx.fs.exists(opts.clientSource)) return [];
  const source = ctx.fs.readText(opts.clientSource);
  const diagnostics: Diagnostic[] = [];

  if (!source.includes("createClient<Database>")) {
    diagnostics.push(
      diagnostic("data/supabase-typed-client", severity, `${opts.clientSource}: Supabase client should be typed with Database`, {
        path: opts.clientSource,
        target: "createClient<Database>",
      }),
    );
  }

  if (!source.includes(opts.databaseTypes.split("/").at(-1)?.replace(/\.ts$/, "") ?? "database.types")) {
    diagnostics.push(
      diagnostic("data/supabase-types-import", severity, `${opts.clientSource}: should import generated database types`, {
        path: opts.clientSource,
        target: "database.types",
      }),
    );
  }

  return diagnostics;
}

function validateAdapterIntegration(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (ctx.fs.exists(opts.adapterIndex)) {
    const source = ctx.fs.readText(opts.adapterIndex);
    if (!source.includes("createSupabaseAdapters")) {
      diagnostics.push(
        diagnostic("data/supabase-adapter-factory", severity, `${opts.adapterIndex}: should export createSupabaseAdapters`, {
          path: opts.adapterIndex,
          target: "createSupabaseAdapters",
        }),
      );
    }
    if (!source.includes("SupabaseClient") || !source.includes("Database")) {
      diagnostics.push(
        diagnostic("data/supabase-adapter-typed-client", severity, `${opts.adapterIndex}: adapter factory should accept typed SupabaseClient<Database>`, {
          path: opts.adapterIndex,
          target: "SupabaseClient<Database>",
        }),
      );
    }
  }

  if (ctx.fs.exists(opts.containerSource)) {
    const source = ctx.fs.readText(opts.containerSource);
    for (const token of ["createSupabaseAdapters", "createBrowserSupabaseClient"]) {
      if (source.includes(token)) continue;
      diagnostics.push(
        diagnostic("data/supabase-container-integration", severity, `${opts.containerSource}: missing ${token}`, {
          path: opts.containerSource,
          target: token,
        }),
      );
    }
  }

  if (ctx.fs.exists(opts.serverRuntimeSource)) {
    const source = ctx.fs.readText(opts.serverRuntimeSource);
    for (const token of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "createClient<Database>"]) {
      if (source.includes(token)) continue;
      diagnostics.push(
        diagnostic("data/supabase-service-role-runtime", severity, `${opts.serverRuntimeSource}: missing ${token}`, {
          path: opts.serverRuntimeSource,
          target: token,
        }),
      );
    }
  }

  return diagnostics;
}

function validateMigrations(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  const migrations = collectMigrations(ctx, opts);
  const diagnostics: Diagnostic[] = [];

  if (migrations.length === 0) {
    diagnostics.push(
      diagnostic("data/supabase-migration-required", severity, `${opts.migrationsDir}: must contain at least one Supabase migration`, {
        path: opts.migrationsDir,
        target: opts.migrationsDir,
      }),
    );
    return diagnostics;
  }

  const prefixes = new Set<string>();
  for (const migration of migrations) {
    const fileName = migration.path.split("/").at(-1) ?? migration.path;
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/i.exec(fileName);
    if (!match) {
      diagnostics.push(
        diagnostic("data/supabase-migration-name", severity, `${migration.path}: migration file name should be NNNN_description.sql`, {
          path: migration.path,
          target: fileName,
        }),
      );
      continue;
    }

    const prefix = match[1];
    if (prefixes.has(prefix)) {
      diagnostics.push(
        diagnostic("data/supabase-migration-prefix-unique", severity, `${migration.path}: migration prefix ${prefix} is duplicated`, {
          path: migration.path,
          target: prefix,
        }),
      );
    }
    prefixes.add(prefix);

    if (ctx.fs.readText(migration.path).trim().length === 0) {
      diagnostics.push(
        diagnostic("data/supabase-migration-empty", severity, `${migration.path}: migration file must not be empty`, {
          path: migration.path,
          target: migration.path,
        }),
      );
    }
  }

  return diagnostics;
}

function validatePackageScripts(ctx: RepoContext, opts: Required<DataSupabaseOptions>, severity: Severity): Diagnostic[] {
  if (!ctx.fs.exists(opts.packageJson)) return [];

  try {
    const pkg = ctx.fs.readJson<{ scripts?: Record<string, string> }>(opts.packageJson);
    const scripts = pkg.scripts ?? {};
    if (!Object.values(scripts).some((script) => script.includes("supabase gen types"))) {
      return [
        diagnostic("data/supabase-types-script", severity, `${opts.packageJson}: should define a Supabase generated-types script`, {
          path: opts.packageJson,
          target: "supabase gen types",
        }),
      ];
    }
  } catch {
    return [];
  }

  return [];
}

function artifactPaths(ctx: RepoContext, opts: Required<DataSupabaseOptions>): string[] {
  return unique([
    opts.envExample,
    opts.databaseTypes,
    opts.supabaseConfig,
    ...collectMigrations(ctx, opts).map((migration) => migration.path),
    ...[opts.runtimeEnvSource, opts.adapterIndex, opts.clientSource, opts.containerSource, opts.serverRuntimeSource, opts.packageJson].filter(
      (path) => pathExists(ctx.root, path),
    ),
  ]);
}

function coreRequiredArtifact(path: string, opts: Required<DataSupabaseOptions>): boolean {
  return path === opts.envExample || path === opts.databaseTypes || path === opts.supabaseConfig || path.startsWith(`${opts.migrationsDir}/`);
}

function supabaseArtifactKind(path: string, opts: Required<DataSupabaseOptions>): string {
  if (path === opts.envExample) return "supabase-env-example";
  if (path === opts.databaseTypes) return "supabase-generated-types";
  if (path === opts.supabaseConfig) return "supabase-config";
  if (path.startsWith(`${opts.migrationsDir}/`)) return "supabase-migration";
  if (path === opts.clientSource) return "supabase-client-source";
  if (path === opts.adapterIndex) return "supabase-adapter-source";
  return "supabase-contract-source";
}

function collectMigrations(ctx: RepoContext, opts: Required<DataSupabaseOptions>): SupabaseMigration[] {
  const absoluteDirectory = join(ctx.root, opts.migrationsDir);
  if (!existsSync(absoluteDirectory)) return [];

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const path = normalizePath(join(opts.migrationsDir, entry.name));
      return {
        path,
        prefix: /^(\d{4})_/.exec(entry.name)?.[1],
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function parseDatabaseTables(ctx: RepoContext, opts: Required<DataSupabaseOptions>): SupabaseTable[] {
  if (!ctx.fs.exists(opts.databaseTypes)) return [];
  const source = ctx.fs.readText(opts.databaseTypes);
  const match = /\bTables:\s*\{([\s\S]*?)\n\s*Views:\s*\{/m.exec(source) ?? /\bTables:\s*\{([\s\S]*?)\n\s*Functions:\s*\{/m.exec(source);
  const body = match?.[1] ?? "";
  return [...body.matchAll(/^\s{6}([A-Za-z0-9_]+):\s*\{/gm)].map(([, name]) => ({ name }));
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

function options(ctx: RepoContext): Required<DataSupabaseOptions> {
  const configured = rawOptions(ctx);
  return {
    envExample: configured.envExample ?? DEFAULT_ENV_EXAMPLE,
    runtimeEnvSource: configured.runtimeEnvSource ?? DEFAULT_RUNTIME_ENV_SOURCE,
    adapterDir: configured.adapterDir ?? DEFAULT_ADAPTER_DIR,
    adapterIndex: configured.adapterIndex ?? DEFAULT_ADAPTER_INDEX,
    clientSource: configured.clientSource ?? DEFAULT_CLIENT_SOURCE,
    databaseTypes: configured.databaseTypes ?? DEFAULT_DATABASE_TYPES,
    containerSource: configured.containerSource ?? DEFAULT_CONTAINER_SOURCE,
    serverRuntimeSource: configured.serverRuntimeSource ?? DEFAULT_SERVER_RUNTIME_SOURCE,
    supabaseConfig: configured.supabaseConfig ?? DEFAULT_SUPABASE_CONFIG,
    migrationsDir: configured.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
    packageJson: configured.packageJson ?? DEFAULT_PACKAGE_JSON,
    requiredEnvKeys: configured.requiredEnvKeys ?? DEFAULT_ENV_KEYS,
    requireAppIntegration: configured.requireAppIntegration ?? false,
    requireServerRuntime: configured.requireServerRuntime ?? false,
    requireTypesScript: configured.requireTypesScript ?? true,
  };
}

function rawOptions(ctx: RepoContext): DataSupabaseOptions {
  const configured = ctx.adapterOptions<DataSupabaseOptions & { supabase?: DataSupabaseOptions }>(dataSupabaseAdapter.id) ?? {};
  return configured.supabase ?? configured;
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
    source: dataSupabaseAdapter.id,
    ...fields,
  };
}

function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function supabaseTableNodeId(name: string): string {
  return `data-table:supabase:${name}`;
}

function supabaseMigrationNodeId(path: string): string {
  return `data-migration:supabase:${path}`;
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}
