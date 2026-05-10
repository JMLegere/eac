#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VERSION = "0.0.1";

type Severity = "info" | "warning" | "error";

type Diagnostic = {
  ruleId: string;
  severity: Severity;
  message: string;
  path?: string;
  hint?: string;
  source: string;
};

type AgentContextFile = {
  path: string;
  title: string;
  description: string;
  template: string;
};

const AGENT_CONTEXT_FILES: AgentContextFile[] = [
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

function usage(): string {
  return `EAC ${VERSION}\n\nEverything-as-Code repo contract compiler.\n\nUsage:\n  eac init [--dry-run] [--force] [--json]\n  eac doctor [--json]\n  eac check [--json]\n  eac --version\n  eac help\n\nCurrent release includes the core command loop and first agents/context adapter.\n`;
}

function parseFlags(args: string[]): Set<string> {
  return new Set(args.filter((arg) => arg.startsWith("--")));
}

function repoPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}

function isThinMarkdown(content: string): boolean {
  const meaningful = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("```"));

  return meaningful.join(" ").length < 40;
}

function collectAgentContextDiagnostics(severity: Severity): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const file of AGENT_CONTEXT_FILES) {
    const absolutePath = repoPath(file.path);

    if (!existsSync(absolutePath)) {
      diagnostics.push({
        ruleId: "agents/context-file-required",
        severity,
        message: `required agent context file is missing: ${file.path}`,
        path: file.path,
        hint: `run eac init to scaffold ${file.path}`,
        source: "agents/context",
      });
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    if (isThinMarkdown(content)) {
      diagnostics.push({
        ruleId: "agents/context-file-not-thin",
        severity,
        message: `agent context file is too thin: ${file.path}`,
        path: file.path,
        hint: `add project-specific ${file.title.toLowerCase()} context`,
        source: "agents/context",
      });
    }
  }

  return diagnostics;
}

function printDiagnostics(diagnostics: Diagnostic[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ diagnostics }, null, 2));
    return;
  }

  if (diagnostics.length === 0) {
    console.log("EAC: no diagnostics");
    return;
  }

  for (const diagnostic of diagnostics) {
    console.log(`${diagnostic.severity} ${diagnostic.ruleId}`);
    console.log(`  ${diagnostic.message}`);
    if (diagnostic.path) console.log(`  file: ${diagnostic.path}`);
    if (diagnostic.hint) console.log(`  hint: ${diagnostic.hint}`);
    console.log(`  source: ${diagnostic.source}`);
    console.log("");
  }
}

function runInit(args: string[]): number {
  const flags = parseFlags(args);
  const dryRun = flags.has("--dry-run");
  const force = flags.has("--force");
  const json = flags.has("--json");
  const actions: Array<{ path: string; action: "create" | "overwrite" | "skip" }> = [];

  for (const file of AGENT_CONTEXT_FILES) {
    const absolutePath = repoPath(file.path);
    const exists = existsSync(absolutePath);

    if (exists && !force) {
      actions.push({ path: file.path, action: "skip" });
      continue;
    }

    actions.push({ path: file.path, action: exists ? "overwrite" : "create" });

    if (!dryRun) {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, file.template, "utf8");
    }
  }

  if (json) {
    console.log(JSON.stringify({ dryRun, force, actions }, null, 2));
    return 0;
  }

  console.log(dryRun ? "EAC init dry run:" : "EAC init:");
  for (const action of actions) {
    console.log(`  ${action.action.padEnd(9)} ${action.path}`);
  }
  console.log("\nagents/context adapter ready");
  return 0;
}

function runDoctor(args: string[]): number {
  const flags = parseFlags(args);
  const diagnostics = collectAgentContextDiagnostics("warning");
  printDiagnostics(diagnostics, flags.has("--json"));
  return 0;
}

function runCheck(args: string[]): number {
  const flags = parseFlags(args);
  const diagnostics = collectAgentContextDiagnostics("error");
  printDiagnostics(diagnostics, flags.has("--json"));
  return diagnostics.length === 0 ? 0 : 1;
}

function main(): number {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  if (command === "init") return runInit(args);
  if (command === "doctor") return runDoctor(args);
  if (command === "check") return runCheck(args);

  console.error(`Unknown command: ${command}\n`);
  console.error(usage());
  return 2;
}

process.exitCode = main();
