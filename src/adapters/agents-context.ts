import type { Adapter, Artifact, Diagnostic, InitAction, RepoContext, Rule, Severity } from "../core/types";

type AgentContextFile = {
  path: string;
  title: string;
  description: string;
  template: string;
};

type AgentsContextOptions = {
  files?: AgentContextFile[];
  instructionFiles?: string[];
  minimumMeaningfulCharacters?: number;
};

const DEFAULT_FILES: AgentContextFile[] = [
  {
    path: ".agents/constraints.md",
    title: "Constraints",
    description: "Hard rules and invariants agents must preserve.",
    template: `# Constraints\n\nThis file records hard project rules and invariants agents must preserve.\n\n- Keep source-of-truth project context in the repo.\n- Update this file when a durable implementation constraint is discovered.\n`,
  },
  {
    path: ".agents/decisions.md",
    title: "Decisions",
    description: "Why important project choices were made.",
    template: `# Decisions\n\nThis file records durable project decisions and the rationale behind them.\n\n- Add dated entries when architecture, product, or process decisions become binding.\n`,
  },
  {
    path: ".agents/open-questions.md",
    title: "Open Questions",
    description: "Known blockers or unresolved design questions.",
    template: `# Open Questions\n\nThis file records unresolved questions that should shape future agent work.\n\n- Add questions when implementation needs a human/product decision.\n- Remove or move questions when they become decisions.\n`,
  },
  {
    path: ".agents/system-map.md",
    title: "System Map",
    description: "High-level architecture and data-flow map.",
    template: `# System Map\n\nThis file records the project's high-level nodes, edges, and verification paths.\n\nStart with the smallest useful map:\n\n\`\`\`text\nsource of truth -> mutation boundary -> read contract -> services -> presentation -> QA\n\`\`\`\n`,
  },
];

export const agentsContextAdapter: Adapter = {
  id: "agents/context",
  description: "Repo-owned operating context for humans and agents.",

  artifacts(ctx): Artifact[] {
    return options(ctx).files.map((file) => ({
      id: `agents:${file.path}`,
      path: file.path,
      kind: "agent-context-file",
      source: agentsContextAdapter.id,
      required: true,
    }));
  },

  init(ctx): InitAction[] {
    return options(ctx).files.map((file) => ({
      path: file.path,
      content: file.template,
      source: agentsContextAdapter.id,
      description: file.description,
    }));
  },

  doctor(ctx): Diagnostic[] {
    return collectDiagnostics(ctx, "warning");
  },

  rules(ctx): Rule[] {
    return [
      {
        id: "agents/context-file-required",
        description: "Required agent context files exist.",
        source: agentsContextAdapter.id,
        check(checkCtx) {
          return collectMissingFileDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
      {
        id: "agents/context-file-not-thin",
        description: "Required agent context files contain project-specific context.",
        source: agentsContextAdapter.id,
        check(checkCtx) {
          return collectThinFileDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
      {
        id: "agents/instruction-file-required",
        description: "Configured agent instruction files exist.",
        source: agentsContextAdapter.id,
        check(checkCtx) {
          return collectInstructionFileDiagnostics(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function options(ctx: RepoContext): Required<AgentsContextOptions> {
  const configured = ctx.adapterOptions<AgentsContextOptions>(agentsContextAdapter.id) ?? {};
  return {
    files: configured.files ?? DEFAULT_FILES,
    instructionFiles: configured.instructionFiles ?? [],
    minimumMeaningfulCharacters: configured.minimumMeaningfulCharacters ?? 40,
  };
}

function collectDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  return [
    ...collectMissingFileDiagnostics(ctx, severity),
    ...collectThinFileDiagnostics(ctx, severity),
    ...collectInstructionFileDiagnostics(ctx, severity),
  ];
}

function collectMissingFileDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  return options(ctx).files.flatMap((file) => {
    if (ctx.fs.exists(file.path)) return [];
    return [
      {
        ruleId: "agents/context-file-required",
        severity,
        message: `required agent context file is missing: ${file.path}`,
        path: file.path,
        target: file.path,
        hint: `run eac init to scaffold ${file.path}`,
        source: agentsContextAdapter.id,
      },
    ];
  });
}

function collectThinFileDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);

  return opts.files.flatMap((file) => {
    if (!ctx.fs.exists(file.path)) return [];
    const content = ctx.fs.readText(file.path);
    if (!isThinMarkdown(content, opts.minimumMeaningfulCharacters)) return [];

    return [
      {
        ruleId: "agents/context-file-not-thin",
        severity,
        message: `agent context file is too thin: ${file.path}`,
        path: file.path,
        target: file.path,
        hint: `add project-specific ${file.title.toLowerCase()} context`,
        source: agentsContextAdapter.id,
      },
    ];
  });
}

function collectInstructionFileDiagnostics(ctx: RepoContext, severity: Severity): Diagnostic[] {
  return options(ctx).instructionFiles.flatMap((path) => {
    if (ctx.fs.exists(path)) return [];
    return [
      {
        ruleId: "agents/instruction-file-required",
        severity,
        message: `configured agent instruction file is missing: ${path}`,
        path,
        target: path,
        hint: "create the instruction file or remove it from the agents/context configuration",
        source: agentsContextAdapter.id,
      },
    ];
  });
}

function isThinMarkdown(content: string, minimumMeaningfulCharacters: number): boolean {
  const meaningful = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("<!--"));

  return meaningful.join(" ").length < minimumMeaningfulCharacters;
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}
