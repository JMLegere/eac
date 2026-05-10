import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import type { Adapter, Artifact, Diagnostic, GraphContribution, RepoContext, Rule, Severity } from "../core/types";

const DEFAULT_SRC_DIR = "src";
const DEFAULT_DESIGN_DIR = "src/design";
const DEFAULT_TOKEN_SOURCE = "tokens/source/core.json";
const DEFAULT_GENERATED_TOKEN_CSS = "src/styles/generated/tokens.css";
const DEFAULT_APP_CSS = "src/styles/app.css";
const DEFAULT_TAXONOMY_DIRS = ["foundations", "primitives", "composites", "patterns"];
const DEFAULT_COMPONENT_TAXONOMY_DIRS = ["primitives", "composites", "patterns"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"]);
const REGISTRY_CATEGORIES = new Set(["primitive", "composite", "pattern"]);
const REGISTRY_STATUSES = new Set(["canonical", "experimental", "deprecated"]);

export type DesignReactOptions = {
  srcDir?: string;
  designDir?: string;
  tokenSource?: string;
  generatedTokenCss?: string;
  appCss?: string;
  taxonomyDirs?: string[];
  componentTaxonomyDirs?: string[];
};

type DesignRegistryEntry = {
  name: string;
  category: string;
  status: string;
  allowedInRoutes: boolean;
};

export const designReactAdapter: Adapter = {
  id: "design/react",
  description: "React design-system-as-code checks for tokens, taxonomy, registry, and import boundaries.",

  artifacts(ctx): Artifact[] {
    const opts = options(ctx);
    return requiredArtifacts(opts).map((path) => ({
      id: `design:react:${path}`,
      path,
      kind: designArtifactKind(path, opts),
      source: designReactAdapter.id,
      required: true,
    }));
  },

  graph(ctx): GraphContribution {
    const opts = options(ctx);
    const registryEntries = loadRegistryEntries(ctx, opts);
    return {
      nodes: [
        {
          id: "design-system:react",
          kind: "design-system",
          label: "React design system",
          path: opts.designDir,
          source: designReactAdapter.id,
        },
        ...registryEntries.map((entry) => ({
          id: designComponentNodeId(entry.name),
          kind: "design-component",
          label: entry.name,
          path: join(opts.designDir, "registry.ts"),
          source: designReactAdapter.id,
          data: {
            category: entry.category,
            status: entry.status,
            allowedInRoutes: entry.allowedInRoutes,
          },
        })),
      ],
      edges: registryEntries.map((entry) => ({
        from: "design-system:react",
        to: designComponentNodeId(entry.name),
        kind: "registers",
        source: designReactAdapter.id,
      })),
    };
  },

  doctor(ctx): Diagnostic[] {
    return collectDesignReactDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "design/react-valid",
        description: "React design system artifacts, registry, tokens, and app usage obey the design contract.",
        source: designReactAdapter.id,
        check(checkCtx) {
          return collectDesignReactDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function collectDesignReactDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);
  const diagnostics: Diagnostic[] = [];
  const srcFiles = walkFiles(ctx.root, opts.srcDir).filter((file) => SOURCE_EXTENSIONS.has(extname(file)));
  const registryEntries = loadRegistryEntries(ctx, opts);
  const registryNames = new Set(registryEntries.map((entry) => entry.name));

  diagnostics.push(...validateRequiredArtifacts(ctx, opts, severity));
  diagnostics.push(...validateSourceBoundaries(ctx, opts, srcFiles, registryEntries, severity));
  diagnostics.push(...validatePublicIndex(ctx, opts, severity));
  diagnostics.push(...validateRegistry(ctx, opts, registryEntries, severity));
  diagnostics.push(...validateRegistryCoverage(ctx, opts, registryEntries, registryNames, severity));

  return diagnostics;
}

function validateRequiredArtifacts(ctx: RepoContext, opts: Required<DesignReactOptions>, severity: Severity): Diagnostic[] {
  return requiredArtifacts(opts)
    .filter((path) => !ctx.fs.exists(path))
    .map((path) =>
      diagnostic("design/react-artifact-required", severity, `${path}: required design-library artifact is missing`, {
        path,
        target: path,
        hint: "add the required design system artifact or configure design paths",
      }),
    );
}

function validateSourceBoundaries(
  ctx: RepoContext,
  opts: Required<DesignReactOptions>,
  srcFiles: string[],
  registryEntries: DesignRegistryEntry[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const allowedHexFiles = new Set([opts.tokenSource, opts.generatedTokenCss]);
  const allowedDesignCssImportFiles = new Set([opts.appCss]);
  const designAbsolute = join(ctx.root, opts.designDir);

  for (const file of srcFiles) {
    const content = ctx.fs.readText(file);
    const isInDesign = isWithin(file, opts.designDir);
    const extension = extname(file);

    if (!isInDesign && /ff-[a-z0-9-]+/.test(content)) {
      diagnostics.push(
        diagnostic(
          "design/react-private-class-boundary",
          severity,
          `${file}: app code must not reference private ff-* design classes`,
          {
            path: file,
            target: "ff-*",
            hint: "add or use a primitive from src/design instead",
          },
        ),
      );
    }

    if (content.includes("design-system.css") && !allowedDesignCssImportFiles.has(file)) {
      diagnostics.push(
        diagnostic("design/react-css-import-boundary", severity, `${file}: design-system.css may only be imported by ${opts.appCss}`, {
          path: file,
          target: "design-system.css",
          hint: "app code should import src/design primitives, not design-system.css directly",
        }),
      );
    }

    if (!allowedHexFiles.has(file) && /#[0-9a-fA-F]{3,8}\b/.test(content)) {
      diagnostics.push(
        diagnostic("design/react-raw-hex-boundary", severity, `${file}: raw hex colors are not allowed outside token sources`, {
          path: file,
          target: "raw-hex-color",
          hint: "add a design token instead",
        }),
      );
    }

    if (!isInDesign && TYPESCRIPT_EXTENSIONS.has(extension)) {
      diagnostics.push(...validatePublicDesignImports(ctx, opts, file, content, registryEntries, severity, designAbsolute));
    }

    if (isInDesign && isTaxonomyComponentSource(file, opts)) {
      if (/\bclassName\??\s*:/.test(content) || /\bstyle\??\s*:/.test(content)) {
        diagnostics.push(
          diagnostic(
            "design/react-component-escape-hatch",
            severity,
            `${file}: design components must not expose className/style props by default`,
            {
              path: file,
              target: "className/style",
              hint: "add an intentional variant prop instead",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

function validatePublicDesignImports(
  ctx: RepoContext,
  opts: Required<DesignReactOptions>,
  file: string,
  content: string,
  registryEntries: DesignRegistryEntry[],
  severity: Severity,
  designAbsolute: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const specifier of importSpecifiers(content)) {
    const resolved = resolveRelativeImport(ctx.root, file, specifier);
    if (!resolved || !isWithinAbsolute(resolved, designAbsolute)) continue;

    if (normalizeAbsolute(resolved) !== normalizeAbsolute(designAbsolute)) {
      diagnostics.push(
        diagnostic("design/react-public-import-boundary", severity, `${file}: app code may import only the public ${opts.designDir} API`, {
          path: file,
          target: specifier,
          hint: "import from the public design API instead of internal design subpaths",
        }),
      );
    }
  }

  for (const { names, specifier } of namedImportSpecifiers(content)) {
    const resolved = resolveRelativeImport(ctx.root, file, specifier);
    if (!resolved || normalizeAbsolute(resolved) !== normalizeAbsolute(designAbsolute)) continue;

    for (const name of names) {
      const entry = registryEntries.find((candidate) => candidate.name === name);
      if (entry && !entry.allowedInRoutes) {
        diagnostics.push(
          diagnostic(
            "design/react-route-usage-boundary",
            severity,
            `${file}: ${name} is a design-library catalog/pattern artifact and is not allowed in app routes`,
            {
              path: file,
              target: name,
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

function validatePublicIndex(ctx: RepoContext, opts: Required<DesignReactOptions>, severity: Severity): Diagnostic[] {
  const indexPath = join(opts.designDir, "index.ts");
  if (!ctx.fs.exists(indexPath)) return [];
  const content = ctx.fs.readText(indexPath);
  const diagnostics: Diagnostic[] = [];

  for (const forbiddenLegacyExport of ["'./components'", "'./examples'"]) {
    if (content.includes(forbiddenLegacyExport)) {
      diagnostics.push(
        diagnostic(
          "design/react-public-api-taxonomy",
          severity,
          `${indexPath}: public API must export taxonomy barrels directly, not legacy ${forbiddenLegacyExport}`,
          {
            path: indexPath,
            target: forbiddenLegacyExport,
          },
        ),
      );
    }
  }

  return diagnostics;
}

function validateRegistry(
  ctx: RepoContext,
  opts: Required<DesignReactOptions>,
  registryEntries: DesignRegistryEntry[],
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const registryPath = join(opts.designDir, "registry.ts");
  const registryNames = new Set(registryEntries.map((entry) => entry.name));

  for (const entry of registryEntries) {
    if (!REGISTRY_CATEGORIES.has(entry.category)) {
      diagnostics.push(
        diagnostic("design/react-registry-category", severity, `${registryPath}: ${entry.name} must use a known category`, {
          path: registryPath,
          target: entry.name,
          hint: "use primitive, composite, or pattern",
        }),
      );
    }

    if (!REGISTRY_STATUSES.has(entry.status)) {
      diagnostics.push(
        diagnostic("design/react-registry-status", severity, `${registryPath}: ${entry.name} must use a known status`, {
          path: registryPath,
          target: entry.name,
          hint: "use canonical, experimental, or deprecated",
        }),
      );
    }
  }

  if (registryEntries.length !== registryNames.size) {
    diagnostics.push(
      diagnostic("design/react-registry-unique", severity, `${registryPath}: component names must be unique`, {
        path: registryPath,
        target: "designComponentRegistry",
      }),
    );
  }

  if (ctx.fs.exists(registryPath) && registryEntries.length === 0) {
    diagnostics.push(
      diagnostic("design/react-registry-parse", severity, `${registryPath}: designComponentRegistry entries could not be parsed`, {
        path: registryPath,
        target: "designComponentRegistry",
      }),
    );
  }

  return diagnostics;
}

function validateRegistryCoverage(
  ctx: RepoContext,
  opts: Required<DesignReactOptions>,
  registryEntries: DesignRegistryEntry[],
  registryNames: Set<string>,
  severity: Severity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const exportedComponents = exportedDesignComponentNames(ctx, opts);
  const registryPath = join(opts.designDir, "registry.ts");

  for (const name of exportedComponents) {
    if (!registryNames.has(name)) {
      diagnostics.push(
        diagnostic("design/react-registry-coverage", severity, `${registryPath}: exported component ${name} must be registered`, {
          path: registryPath,
          target: name,
        }),
      );
    }
  }

  for (const entry of registryEntries) {
    if (!exportedComponents.has(entry.name)) {
      diagnostics.push(
        diagnostic("design/react-registry-export", severity, `${registryPath}: ${entry.name} is registered but not exported`, {
          path: registryPath,
          target: entry.name,
        }),
      );
    }
  }

  return diagnostics;
}

function exportedDesignComponentNames(ctx: RepoContext, opts: Required<DesignReactOptions>): Set<string> {
  const names = new Set<string>();

  for (const dir of opts.componentTaxonomyDirs) {
    const taxonomyDir = join(opts.designDir, dir);
    for (const file of walkFiles(ctx.root, taxonomyDir)) {
      if (extname(file) !== ".tsx") continue;
      const source = ctx.fs.readText(file);
      for (const name of exportedComponentNames(source)) names.add(name);
    }
  }

  return names;
}

function loadRegistryEntries(ctx: RepoContext, opts: Required<DesignReactOptions>): DesignRegistryEntry[] {
  const registryPath = join(opts.designDir, "registry.ts");
  if (!ctx.fs.exists(registryPath)) return [];
  return parseRegistryEntries(ctx.fs.readText(registryPath));
}

function parseRegistryEntries(source: string): DesignRegistryEntry[] {
  return [
    ...source.matchAll(
      /\{\s*name: '([^']+)',\s*category: '([^']+)',\s*status: '([^']+)',[\s\S]*?allowedInRoutes: (true|false),\s*\}/g,
    ),
  ].map(([, name, category, status, allowedInRoutes]) => ({
    name,
    category,
    status,
    allowedInRoutes: allowedInRoutes === "true",
  }));
}

function requiredArtifacts(opts: Required<DesignReactOptions>): string[] {
  return [
    opts.tokenSource,
    opts.generatedTokenCss,
    join(opts.designDir, "index.ts"),
    join(opts.designDir, "registry.ts"),
    join(opts.designDir, "README.md"),
    join(opts.designDir, "design-system.css"),
    join(opts.designDir, "examples.tsx"),
    join(opts.designDir, "components.tsx"),
    ...opts.taxonomyDirs.map((dir) => join(opts.designDir, dir, "index.ts")),
  ];
}

function designArtifactKind(path: string, opts: Required<DesignReactOptions>): string {
  if (path === opts.tokenSource) return "design-token-source";
  if (path === opts.generatedTokenCss) return "design-token-css";
  if (path.endsWith("registry.ts")) return "design-component-registry";
  if (path.endsWith("design-system.css")) return "design-system-css";
  return "design-artifact";
}

function isTaxonomyComponentSource(file: string, opts: Required<DesignReactOptions>): boolean {
  if (extname(file) !== ".tsx") return false;
  return opts.componentTaxonomyDirs.some((dir) => isWithin(file, join(opts.designDir, dir)));
}

function isWithin(file: string, directory: string): boolean {
  const relativePath = relative(directory, file);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsoluteLike(relativePath));
}

function isWithinAbsolute(file: string, directory: string): boolean {
  const relativePath = relative(directory, file);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsoluteLike(relativePath));
}

function walkFiles(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = join(absoluteDirectory, entry.name);
    const relativePath = normalizePath(relative(root, absolutePath));
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function extname(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function exportedComponentNames(source: string): string[] {
  return [...source.matchAll(/export function ([A-Z][A-Za-z0-9]*)\(/g)].map((match) => match[1]);
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:import|export)\b(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gs)].map(
    (match) => match[1],
  );
}

function namedImportSpecifiers(source: string): Array<{ names: string[]; specifier: string }> {
  return [...source.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g)].map(
    ([, names, specifier]) => ({
      names: names
        .split(",")
        .map((name) => name.trim().split(/\s+as\s+/)[0]?.trim())
        .filter((name): name is string => Boolean(name)),
      specifier,
    }),
  );
}

function resolveRelativeImport(root: string, file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return resolvePath(dirname(join(root, file)), specifier);
}

function options(ctx: RepoContext): Required<DesignReactOptions> {
  const configured = ctx.adapterOptions<DesignReactOptions>(designReactAdapter.id) ?? {};
  return {
    srcDir: configured.srcDir ?? DEFAULT_SRC_DIR,
    designDir: configured.designDir ?? DEFAULT_DESIGN_DIR,
    tokenSource: configured.tokenSource ?? DEFAULT_TOKEN_SOURCE,
    generatedTokenCss: configured.generatedTokenCss ?? DEFAULT_GENERATED_TOKEN_CSS,
    appCss: configured.appCss ?? DEFAULT_APP_CSS,
    taxonomyDirs: configured.taxonomyDirs ?? DEFAULT_TAXONOMY_DIRS,
    componentTaxonomyDirs: configured.componentTaxonomyDirs ?? DEFAULT_COMPONENT_TAXONOMY_DIRS,
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
    source: designReactAdapter.id,
    ...fields,
  };
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function normalizeAbsolute(path: string): string {
  return normalizePath(path);
}

function isAbsoluteLike(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:/.test(path);
}

function designComponentNodeId(name: string): string {
  return `design-component:${name}`;
}
