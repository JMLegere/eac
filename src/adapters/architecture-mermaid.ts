import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import DOMPurify from "dompurify";
import type { Adapter, Artifact, Diagnostic, GraphContribution, RepoContext, Rule, Severity } from "../core/types";

const DEFAULT_SOURCE_PATTERNS = ["architecture/**/*.mmd"];
const DEFAULT_REQUIRED_SOURCE = "architecture/system.mmd";

export type ArchitectureMermaidOptions = {
  sources?: string[];
  requireSources?: boolean;
};

type ParsedMermaidSource = {
  path: string;
  diagramType?: string;
  diagnostics: Diagnostic[];
};

type MermaidModule = {
  initialize(config: { startOnLoad: boolean }): void;
  parse(text: string): Promise<false | { diagramType?: string }>;
};

export const architectureMermaidAdapter: Adapter = {
  id: "architecture/mermaid",
  description: "Architecture-as-code checks for Mermaid source diagrams.",

  artifacts(ctx): Artifact[] {
    const sourcePaths = collectMermaidSourcePaths(ctx);
    const requiredFallback = sourcePaths.length === 0 && options(ctx).requireSources;
    const paths = requiredFallback ? [DEFAULT_REQUIRED_SOURCE] : sourcePaths;

    return paths.map((path) => ({
      id: `architecture:mermaid:${path}`,
      path,
      kind: "mermaid-source",
      source: architectureMermaidAdapter.id,
      required: true,
    }));
  },

  async graph(ctx): Promise<GraphContribution> {
    const parsed = await loadMermaidSources(ctx, "warning");
    return {
      nodes: parsed.map((source) => ({
        id: mermaidDiagramNodeId(source.path),
        kind: "architecture-diagram",
        label: source.path,
        path: source.path,
        source: architectureMermaidAdapter.id,
        data: {
          diagramType: source.diagramType,
        },
      })),
      edges: parsed.map((source) => ({
        from: artifactNodeId(source.path),
        to: mermaidDiagramNodeId(source.path),
        kind: "parses-to",
        source: architectureMermaidAdapter.id,
      })),
    };
  },

  doctor(ctx): Promise<Diagnostic[]> {
    return collectMermaidDiagnostics(ctx, "warning");
  },

  rules(_ctx): Rule[] {
    return [
      {
        id: "architecture/mermaid-valid",
        description: "Mermaid architecture source diagrams exist and parse successfully.",
        source: architectureMermaidAdapter.id,
        check(checkCtx) {
          return collectMermaidDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

async function collectMermaidDiagnostics(ctx: RepoContext, severity: Severity): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const sourcePaths = collectMermaidSourcePaths(ctx);

  if (sourcePaths.length === 0 && options(ctx).requireSources) {
    diagnostics.push(
      diagnostic(
        "architecture/mermaid-source-required",
        severity,
        `no Mermaid architecture sources matched: ${options(ctx).sources.join(", ")}`,
        {
          target: "architecture/mermaid",
          hint: `add a Mermaid source such as ${DEFAULT_REQUIRED_SOURCE} or configure architecture.sources`,
        },
      ),
    );
  }

  const parsed = await loadMermaidSources(ctx, severity, sourcePaths);
  diagnostics.push(...parsed.flatMap((source) => source.diagnostics));
  return diagnostics;
}

async function loadMermaidSources(
  ctx: RepoContext,
  severity: Severity,
  sourcePaths = collectMermaidSourcePaths(ctx),
): Promise<ParsedMermaidSource[]> {
  const mermaid = await loadMermaid();
  return Promise.all(
    sourcePaths.map(async (path) => {
      try {
        const result = await mermaid.parse(ctx.fs.readText(path));
        return {
          path,
          diagramType: typeof result === "object" && result ? result.diagramType : undefined,
          diagnostics: [],
        };
      } catch (error) {
        return {
          path,
          diagnostics: [
            diagnostic("architecture/mermaid-parse", severity, `${path} could not be parsed as Mermaid: ${messageFor(error)}`, {
              path,
              target: path,
              hint: "fix the Mermaid source syntax or remove the file from architecture.sources",
            }),
          ],
        };
      }
    }),
  );
}

function collectMermaidSourcePaths(ctx: RepoContext): string[] {
  return unique(options(ctx).sources.flatMap((pattern) => expandMermaidPattern(ctx.root, pattern)));
}

function expandMermaidPattern(root: string, pattern: string): string[] {
  if (pattern.endsWith("/**/*.mmd")) {
    const directory = pattern.slice(0, -"/**/*.mmd".length);
    return walkMermaidFiles(root, directory);
  }

  if (pattern.endsWith("/*.mmd")) {
    const directory = pattern.slice(0, -"/*.mmd".length);
    return listImmediateMermaidFiles(root, directory);
  }

  const absolute = join(root, pattern);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isDirectory()) return walkMermaidFiles(root, pattern);
  return pattern.endsWith(".mmd") ? [normalizePath(pattern)] : [];
}

function walkMermaidFiles(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = join(absoluteDirectory, entry.name);
    const relativePath = normalizePath(relative(root, absolutePath));
    if (entry.isDirectory()) {
      files.push(...walkMermaidFiles(root, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".mmd")) {
      files.push(relativePath);
    }
  }
  return files;
}

function listImmediateMermaidFiles(root: string, directory: string): string[] {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mmd"))
    .map((entry) => normalizePath(join(directory, entry.name)));
}

function options(ctx: RepoContext): Required<ArchitectureMermaidOptions> {
  const configured = ctx.adapterOptions<ArchitectureMermaidOptions>(architectureMermaidAdapter.id) ?? {};
  return {
    sources: configured.sources ?? DEFAULT_SOURCE_PATTERNS,
    requireSources: configured.requireSources ?? true,
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
    source: architectureMermaidAdapter.id,
    ...fields,
  };
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactNodeId(path: string): string {
  return `artifact:${path}`;
}

function mermaidDiagramNodeId(path: string): string {
  return `architecture-diagram:${path}`;
}

async function loadMermaid(): Promise<MermaidModule> {
  const purify = DOMPurify as unknown as {
    sanitize?: (text: string) => string;
    addHook?: (...args: unknown[]) => void;
    removeHook?: (...args: unknown[]) => void;
  };

  purify.sanitize ??= (text: string) => text;
  purify.addHook ??= () => {};
  purify.removeHook ??= () => {};

  const loaded = await import("mermaid");
  const mermaid = loaded.default as MermaidModule;
  mermaid.initialize({ startOnLoad: false });
  return mermaid;
}
