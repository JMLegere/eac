import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/core/runner";

const config = `export default {
  adapters: ["architecture/mermaid"],
  architecture: {
    sources: ["architecture/**/*.mmd"],
  },
};
`;

describe("architecture/mermaid adapter", () => {
  test("valid Mermaid sources pass and contribute architecture diagram graph nodes", async () => {
    const root = tempRoot();
    write(join(root, "eac.config.ts"), config);
    await mkdir(join(root, "architecture"), { recursive: true });
    write(join(root, "architecture", "system.mmd"), "flowchart LR\n  Browser --> Worker\n  Worker --> Supabase\n");

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.artifacts.map((artifact) => artifact.kind)).toContain("mermaid-source");
    expect(result.graph.nodes.map((node) => node.id)).toContain("architecture-diagram:architecture/system.mmd");
    expect(result.graph.edges.some((edge) => edge.kind === "parses-to")).toBe(true);
  });

  test("invalid Mermaid sources fail with parse findings", async () => {
    const root = tempRoot();
    write(join(root, "eac.config.ts"), config);
    await mkdir(join(root, "architecture"), { recursive: true });
    write(join(root, "architecture", "broken.mmd"), "not a diagram\n  A --> B\n");

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("architecture/mermaid-parse");
  });

  test("missing Mermaid sources fail when sources are required", async () => {
    const root = tempRoot();
    write(join(root, "eac.config.ts"), config);

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("architecture/mermaid-source-required");
  });
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}
