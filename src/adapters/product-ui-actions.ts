import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type { Diagnostic, RepoContext, Severity } from "../core/types";
import { productOptions, type ProductModel } from "./product-manifest";

const DEFAULT_ACTION_ATTRIBUTE = "data-user-action";
const DEFAULT_REACT_STATIC_SOURCES = ["src/**/*.tsx"];
const DEFAULT_REACT_INTERACTIVE_COMPONENTS = ["Button", "ButtonLink", "NavLink", "a", "button", "form"];

export type UiActionEvidenceKind = "static-ui" | "rendered-ui";

export type UiActionEvidence = {
  actionId: string;
  evidenceKind: UiActionEvidenceKind;
  surface?: string;
  control?: {
    element?: string;
    role?: string;
    name?: string;
  };
  source: {
    collector: string;
    path?: string;
    route?: string;
    line?: number;
  };
};

export type UiActionsOptions = {
  actionAttribute?: string;
  collectors?: UiActionCollectorOptions[];
};

export type UiActionCollectorOptions =
  | ReactStaticCollectorOptions
  | ReactRenderedCollectorOptions
  | EvidenceFileCollectorOptions;

export type ReactStaticCollectorOptions = {
  kind: "react-static";
  sources?: string[];
  interactiveComponents?: string[];
  ignore?: string[];
};

export type ReactRenderedCollectorOptions = {
  kind: "react-rendered";
  routes?: string[];
  appModule: string;
  appExport?: string;
  router?: "memory" | "none";
  packageRoot?: string;
};

export type EvidenceFileCollectorOptions = {
  kind: "evidence-file";
  files: string[];
};

export type UiActionEvidenceResult = {
  evidence: UiActionEvidence[];
  diagnostics: Diagnostic[];
};

export async function collectUiActionEvidence(
  ctx: RepoContext,
  product: ProductModel,
  severity: Severity,
): Promise<UiActionEvidenceResult> {
  const opts = uiActionOptions(ctx);
  const diagnostics: Diagnostic[] = [];
  const evidence: UiActionEvidence[] = [];
  const actionIds = new Set(product.actions.map((action) => action.id));
  const userActionsByKey = await loadUserActionsByKey(ctx, severity);
  diagnostics.push(...userActionsByKey.diagnostics);

  for (const collector of opts.collectors) {
    if (collector.kind === "react-static") {
      const result = collectReactStaticEvidence(ctx, collector, opts.actionAttribute, actionIds, userActionsByKey.values, severity);
      diagnostics.push(...result.diagnostics);
      evidence.push(...result.evidence);
      continue;
    }

    if (collector.kind === "react-rendered") {
      const result = await collectReactRenderedEvidence(ctx, collector, opts.actionAttribute, actionIds, severity);
      diagnostics.push(...result.diagnostics);
      evidence.push(...result.evidence);
      continue;
    }

    if (collector.kind === "evidence-file") {
      const result = collectEvidenceFileEvidence(ctx, collector, actionIds, severity);
      diagnostics.push(...result.diagnostics);
      evidence.push(...result.evidence);
      continue;
    }

    diagnostics.push(
      diagnostic("product/superbdd-ui-collector-kind", severity, `unknown uiActions collector kind: ${(collector as { kind?: string }).kind ?? "<missing>"}`, {
        target: (collector as { kind?: string }).kind,
      }),
    );
  }

  return { evidence: dedupeEvidence(evidence), diagnostics };
}

export function uiActionOptions(ctx: RepoContext): Required<UiActionsOptions> {
  const configured = ((ctx.config as { uiActions?: UiActionsOptions }).uiActions ?? {}) as UiActionsOptions;
  return {
    actionAttribute: configured.actionAttribute ?? DEFAULT_ACTION_ATTRIBUTE,
    collectors: configured.collectors ?? [],
  };
}

function collectReactStaticEvidence(
  ctx: RepoContext,
  collector: ReactStaticCollectorOptions,
  actionAttribute: string,
  actionIds: Set<string>,
  userActionsByKey: Map<string, string>,
  severity: Severity,
): UiActionEvidenceResult {
  const diagnostics: Diagnostic[] = [];
  const evidence: UiActionEvidence[] = [];
  const sources = collector.sources ?? DEFAULT_REACT_STATIC_SOURCES;
  const interactiveComponents = new Set(collector.interactiveComponents ?? DEFAULT_REACT_INTERACTIVE_COMPONENTS);
  const ignored = collector.ignore ?? [];

  for (const file of collectMatchingFiles(ctx.root, sources)) {
    const relativePath = normalizePath(relative(ctx.root, file));
    if (isIgnored(relativePath, ignored)) continue;

    const source = ctx.fs.readText(relativePath);
    const jsxTags = [...source.matchAll(/<([A-Z][A-Za-z0-9]*|a|button|form)\b([\s\S]*?)(\/?)>/g)];

    for (const match of jsxTags) {
      const [, componentName, attributes] = match;
      if (!interactiveComponents.has(componentName)) continue;

      const line = lineNumberForIndex(source, match.index ?? 0);
      const actionRef = actionRefFromAttributes(attributes, actionAttribute);

      if (!actionRef) {
        diagnostics.push(
          diagnostic(
            "product/superbdd-static-action-annotation-required",
            severity,
            `${relativePath}:${line}: <${componentName}> is interactive and must declare ${actionAttribute}`,
            {
              path: relativePath,
              location: { line },
              target: componentName,
              hint: `add ${actionAttribute} with a product action id`,
            },
          ),
        );
        continue;
      }

      const actionId = resolveActionRef(actionRef, userActionsByKey);
      if (!actionId || !actionIds.has(actionId)) {
        diagnostics.push(
          diagnostic(
            "product/superbdd-ui-action-known",
            severity,
            `${relativePath}:${line}: ${actionAttribute} references unknown product action "${actionRef.value}"`,
            {
              path: relativePath,
              location: { line },
              target: actionRef.value,
            },
          ),
        );
        continue;
      }

      evidence.push({
        actionId,
        evidenceKind: "static-ui",
        control: { element: componentName },
        source: { collector: "react-static", path: relativePath, line },
      });
    }
  }

  return { evidence, diagnostics };
}

async function collectReactRenderedEvidence(
  ctx: RepoContext,
  collector: ReactRenderedCollectorOptions,
  actionAttribute: string,
  actionIds: Set<string>,
  severity: Severity,
): Promise<UiActionEvidenceResult> {
  const diagnostics: Diagnostic[] = [];
  const evidence: UiActionEvidence[] = [];
  const routes = collector.routes ?? [];

  if (!collector.appModule) {
    return {
      evidence,
      diagnostics: [diagnostic("product/superbdd-rendered-app-required", severity, "react-rendered collector must define appModule")],
    };
  }

  if (routes.length === 0) {
    return {
      evidence,
      diagnostics: [diagnostic("product/superbdd-rendered-routes-required", severity, "react-rendered collector must define at least one route")],
    };
  }

  try {
    const packageRoot = collector.packageRoot ? join(ctx.root, collector.packageRoot) : ctx.root;
    const ReactModule = await importProjectDependency(packageRoot, "react");
    const React = (ReactModule.default ?? ReactModule) as {
      createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
    };
    const serverModule = await importProjectDependency(packageRoot, "react-dom/server");
    const { renderToStaticMarkup } = serverModule as {
      renderToStaticMarkup: (element: unknown) => string;
    };
    const routerModule = collector.router === "none" ? {} : await importProjectDependency(packageRoot, "react-router-dom");
    const MemoryRouter = collector.router === "none" ? undefined : (routerModule as { MemoryRouter?: unknown }).MemoryRouter;

    const appModule = await importModule(ctx.root, collector.appModule);
    const appExport = collector.appExport ?? "AppRouter";
    const App = appModule[appExport];

    if (!App) {
      return {
        evidence,
        diagnostics: [
          diagnostic("product/superbdd-rendered-app-export", severity, `${collector.appModule} must export ${appExport}`, {
            path: collector.appModule,
            target: appExport,
          }),
        ],
      };
    }

    for (const route of routes) {
      const appElement = React.createElement(App as object);
      const element = MemoryRouter
        ? React.createElement(MemoryRouter, { initialEntries: [route] }, appElement)
        : appElement;
      const html = renderToStaticMarkup(element);
      const result = collectRenderedHtmlEvidence(route, html, actionAttribute, actionIds, severity);
      diagnostics.push(...result.diagnostics);
      evidence.push(...result.evidence);
    }
  } catch (error) {
    const external = collectReactRenderedEvidenceInProjectProcess(ctx, collector, actionAttribute, actionIds, severity);
    if (external) {
      diagnostics.push(...external.diagnostics);
      evidence.push(...external.evidence);
    } else {
      diagnostics.push(
        diagnostic("product/superbdd-rendered-collector", severity, `react-rendered collector failed: ${messageFor(error)}`, {
          path: collector.appModule,
          hint: "ensure project React, react-dom/server, react-router-dom, and appModule are importable from the repo root",
        }),
      );
    }
  }

  return { evidence, diagnostics };
}

function collectReactRenderedEvidenceInProjectProcess(
  ctx: RepoContext,
  collector: ReactRenderedCollectorOptions,
  actionAttribute: string,
  actionIds: Set<string>,
  severity: Severity,
): UiActionEvidenceResult | undefined {
  const routes = collector.routes ?? [];
  const appExport = collector.appExport ?? "AppRouter";
  const script = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.env.EAC_REACT_RENDER_CONFIG);
const appModule = await import(pathToFileURL(config.appModule).href);
const App = appModule[config.appExport];
if (!App) throw new Error(config.appModule + " must export " + config.appExport);

const results = [];
for (const route of config.routes) {
  const appElement = React.createElement(App);
  const element = config.router === "none"
    ? appElement
    : React.createElement(MemoryRouter, { initialEntries: [route] }, appElement);
  results.push({ route, html: renderToStaticMarkup(element) });
}

console.log(JSON.stringify(results));
`;

  try {
    const packageRoot = collector.packageRoot ? join(ctx.root, collector.packageRoot) : ctx.root;
    const output = execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        EAC_REACT_RENDER_CONFIG: JSON.stringify({
          appModule: join(ctx.root, collector.appModule),
          appExport,
          routes,
          router: collector.router ?? "memory",
        }),
      },
    });
    const rendered = JSON.parse(output) as Array<{ route: string; html: string }>;
    const diagnostics: Diagnostic[] = [];
    const evidence: UiActionEvidence[] = [];

    for (const item of rendered) {
      const result = collectRenderedHtmlEvidence(item.route, item.html, actionAttribute, actionIds, severity);
      diagnostics.push(...result.diagnostics);
      evidence.push(...result.evidence);
    }

    return { evidence, diagnostics };
  } catch {
    return undefined;
  }
}

function collectRenderedHtmlEvidence(
  route: string,
  html: string,
  actionAttribute: string,
  actionIds: Set<string>,
  severity: Severity,
): UiActionEvidenceResult {
  const diagnostics: Diagnostic[] = [];
  const evidence: UiActionEvidence[] = [];
  const interactiveTags = [...html.matchAll(/<(a|button|form)\b([^>]*)>/g)];

  for (const match of interactiveTags) {
    const [, tagName, attributes] = match;
    const actionMatch = attributeValue(attributes, actionAttribute);
    const label = renderedLabelFor(html, match.index ?? 0);

    if (!actionMatch) {
      diagnostics.push(
        diagnostic(
          "product/superbdd-rendered-action-annotation-required",
          severity,
          `${route}: rendered <${tagName}>${label ? ` (${label})` : ""} is interactive and lacks ${actionAttribute}`,
          {
            target: tagName,
            hint: `add ${actionAttribute} to the rendered control`,
          },
        ),
      );
      continue;
    }

    if (!actionIds.has(actionMatch)) {
      diagnostics.push(
        diagnostic("product/superbdd-ui-action-known", severity, `${route}: rendered <${tagName}> references unknown ${actionAttribute}="${actionMatch}"`, {
          target: actionMatch,
        }),
      );
      continue;
    }

    evidence.push({
      actionId: actionMatch,
      evidenceKind: "rendered-ui",
      surface: route,
      control: { element: tagName, role: tagName === "a" ? "link" : tagName === "form" ? "form" : "button", name: label },
      source: { collector: "react-rendered", route },
    });
  }

  return { evidence, diagnostics };
}

function collectEvidenceFileEvidence(
  ctx: RepoContext,
  collector: EvidenceFileCollectorOptions,
  actionIds: Set<string>,
  severity: Severity,
): UiActionEvidenceResult {
  const diagnostics: Diagnostic[] = [];
  const evidence: UiActionEvidence[] = [];

  for (const file of collector.files) {
    if (!ctx.fs.exists(file)) {
      diagnostics.push(diagnostic("product/superbdd-ui-evidence-file-required", severity, `UI action evidence file is missing: ${file}`, { path: file }));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(ctx.fs.readText(file));
    } catch (error) {
      diagnostics.push(diagnostic("product/superbdd-ui-evidence-file-json", severity, `${file}: could not parse UI action evidence JSON: ${messageFor(error)}`, { path: file }));
      continue;
    }

    const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.evidence) ? parsed.evidence : undefined;
    if (!rows) {
      diagnostics.push(diagnostic("product/superbdd-ui-evidence-file-shape", severity, `${file}: evidence file must be an array or { evidence: [] }`, { path: file }));
      continue;
    }

    for (const [index, row] of rows.entries()) {
      if (!isRecord(row) || typeof row.actionId !== "string" || !isUiActionEvidenceKind(row.evidenceKind)) {
        diagnostics.push(diagnostic("product/superbdd-ui-evidence-file-shape", severity, `${file}: evidence row ${index + 1} must define actionId and evidenceKind`, { path: file }));
        continue;
      }

      if (!actionIds.has(row.actionId)) {
        diagnostics.push(diagnostic("product/superbdd-ui-action-known", severity, `${file}: evidence row ${index + 1} references unknown action "${row.actionId}"`, { path: file, target: row.actionId }));
        continue;
      }

      evidence.push({
        actionId: row.actionId,
        evidenceKind: row.evidenceKind,
        surface: typeof row.surface === "string" ? row.surface : undefined,
        source: { collector: "evidence-file", path: file },
      });
    }
  }

  return { evidence, diagnostics };
}

async function loadUserActionsByKey(
  ctx: RepoContext,
  severity: Severity,
): Promise<{ values: Map<string, string>; diagnostics: Diagnostic[] }> {
  const opts = productOptions(ctx);
  const values = new Map<string, string>();

  if (!ctx.fs.exists(opts.manifest)) return { values, diagnostics: [] };

  try {
    const loaded = await importModule(ctx.root, opts.manifest);
    const actions = loaded[opts.actionsExport];
    if (!isRecord(actions)) return { values, diagnostics: [] };

    for (const [key, value] of Object.entries(actions)) {
      if (isRecord(value) && typeof value.id === "string") values.set(key, value.id);
    }

    return { values, diagnostics: [] };
  } catch (error) {
    return {
      values,
      diagnostics: [
        diagnostic("product/superbdd-ui-manifest-load", severity, `could not load action keys from product manifest: ${messageFor(error)}`, {
          path: opts.manifest,
        }),
      ],
    };
  }
}

function validateEvidenceShape(evidence: UiActionEvidence): boolean {
  return Boolean(evidence.actionId && evidence.evidenceKind && evidence.source?.collector);
}

function dedupeEvidence(evidence: UiActionEvidence[]): UiActionEvidence[] {
  const seen = new Set<string>();
  const deduped: UiActionEvidence[] = [];

  for (const item of evidence) {
    if (!validateEvidenceShape(item)) continue;
    const key = [item.actionId, item.evidenceKind, item.source.collector, item.source.path ?? item.source.route ?? "", item.source.line ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function actionRefFromAttributes(attributes: string, actionAttribute: string): { kind: "key" | "literal"; value: string } | undefined {
  const escaped = escapeRegExp(actionAttribute);
  const keyMatch = attributes.match(new RegExp(`${escaped}=\\{userActions\\.([A-Za-z0-9_]+)\\}`));
  if (keyMatch) return { kind: "key", value: keyMatch[1] };

  const literalMatch = attributes.match(new RegExp(`${escaped}=["']([^"']+)["']`));
  if (literalMatch) return { kind: "literal", value: literalMatch[1] };

  return undefined;
}

function resolveActionRef(actionRef: { kind: "key" | "literal"; value: string }, userActionsByKey: Map<string, string>): string | undefined {
  if (actionRef.kind === "literal") return actionRef.value;
  return userActionsByKey.get(actionRef.value);
}

function attributeValue(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`${escapeRegExp(name)}="([^"]+)"`));
  return match?.[1];
}

async function importModule(root: string, relativePath: string): Promise<Record<string, unknown>> {
  const absolutePath = join(root, relativePath);
  const stat = statSync(absolutePath);
  return (await import(`${pathToFileURL(absolutePath).href}?mtime=${stat.mtimeMs}&size=${stat.size}`)) as Record<string, unknown>;
}

async function importProjectDependency(packageRoot: string, specifier: string): Promise<Record<string, unknown>> {
  const requireFromProject = createRequire(join(packageRoot, "package.json"));

  try {
    return requireFromProject(specifier) as Record<string, unknown>;
  } catch {
    const resolved = resolveProjectDependencyEntry(packageRoot, specifier);
    return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  }
}

function resolveProjectDependencyEntry(packageRoot: string, specifier: string): string {
  const { packageName, subpath } = splitPackageSpecifier(specifier);
  const packageDir = join(packageRoot, "node_modules", packageName);
  const packageJsonPath = join(packageDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
  const exportsField = packageJson.exports;
  const exportTarget = isRecord(exportsField) ? exportsField[subpath] : undefined;
  const entry =
    exportPath(exportTarget) ??
    (subpath === "." ? stringValue(packageJson.module) ?? stringValue(packageJson.main) : undefined) ??
    `${subpath.slice(2)}.js`;
  return join(packageDir, entry);
}

function splitPackageSpecifier(specifier: string): { packageName: string; subpath: string } {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return {
      packageName: parts.slice(0, 2).join("/"),
      subpath: parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".",
    };
  }

  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? `./${parts.slice(1).join("/")}` : ".",
  };
}

function exportPath(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;

  for (const key of ["bun", "node", "module-sync", "import", "default"]) {
    const candidate = value[key];
    const resolved = exportPath(candidate);
    if (resolved) return resolved;
  }

  return undefined;
}

function collectMatchingFiles(root: string, patterns: string[]): string[] {
  const files = new Set<string>();

  for (const pattern of patterns) {
    const normalized = normalizePath(pattern);
    if (!normalized.includes("*")) {
      const absolute = join(root, normalized);
      if (existsSync(absolute) && statSync(absolute).isFile()) files.add(absolute);
      continue;
    }

    const base = normalized.slice(0, normalized.indexOf("*")).replace(/[/\\][^/\\]*$/, "").replace(/[/\\]$/, "") || ".";
    const suffix = normalized.includes("*.") ? normalized.slice(normalized.lastIndexOf("*." ) + 1) : "";
    const baseAbsolute = join(root, base);
    if (!existsSync(baseAbsolute)) continue;

    for (const file of walkFiles(baseAbsolute)) {
      if (suffix && !normalizePath(file).endsWith(suffix)) continue;
      files.add(file);
    }
  }

  return [...files].sort();
}

function walkFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function renderedLabelFor(html: string, tagStartIndex: number): string {
  const close = html.indexOf(">", tagStartIndex);
  if (close === -1) return "";
  const nextCloseTag = html.indexOf("</", close);
  if (nextCloseTag === -1) return "";
  return html
    .slice(close + 1, nextCloseTag)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isIgnored(relativePath: string, ignored: string[]): boolean {
  return ignored.map(normalizePath).some((ignoredPath) => {
    if (ignoredPath.startsWith("**/*")) return relativePath.endsWith(ignoredPath.slice(4));
    return relativePath === ignoredPath || relativePath.startsWith(`${ignoredPath}/`);
  });
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function isUiActionEvidenceKind(value: unknown): value is UiActionEvidenceKind {
  return value === "static-ui" || value === "rendered-ui";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    source: "product/superbdd",
    ...fields,
  };
}
