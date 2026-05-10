#!/usr/bin/env bun

import pkg from "../package.json" with { type: "json" };
import { hasErrors, printDiagnostics } from "./core/diagnostics";
import { runCheck, runDoctor, runInit } from "./core/runner";

const VERSION = pkg.version;

type ParsedArgs = {
  command: string;
  flags: Set<string>;
};

function usage(): string {
  return `EAC ${VERSION}\n\nEverything-as-Code repo contract compiler.\n\nUsage:\n  eac init [--dry-run] [--force] [--json]\n  eac doctor [--json]\n  eac check [--json]\n  eac --version\n  eac help\n\nCurrent release includes the real kernel contracts, agents/context adapter, and semver enforcement adapter.\n`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...args] = argv;
  return {
    command,
    flags: new Set(args.filter((arg) => arg.startsWith("--"))),
  };
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const json = flags.has("--json");

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  if (command === "init") {
    const result = await runInit({
      dryRun: flags.has("--dry-run"),
      force: flags.has("--force"),
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    console.log(result.dryRun ? "EAC init dry run:" : "EAC init:");
    if (result.configPath) console.log(`  config    ${result.configPath}`);
    for (const action of result.actions) {
      console.log(`  ${action.action.padEnd(9)} ${action.path}`);
    }
    return 0;
  }

  if (command === "doctor") {
    const result = await runDoctor();
    printDiagnostics(result.diagnostics, json);
    return 0;
  }

  if (command === "check") {
    const result = await runCheck();
    printDiagnostics(result.diagnostics, json);
    return hasErrors(result.diagnostics) ? 1 : 0;
  }

  console.error(`Unknown command: ${command}\n`);
  console.error(usage());
  return 2;
}

process.exitCode = await main();
