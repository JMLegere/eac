import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/core/runner";

const config = `export default {
  adapters: ["design/react"],
};
`;

describe("design/react adapter", () => {
  test("valid React design contract passes and contributes registry graph nodes", async () => {
    const root = await fixture();

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.artifacts.map((artifact) => artifact.kind)).toContain("design-component-registry");
    expect(result.graph.nodes.map((node) => node.id)).toContain("design-system:react");
    expect(result.graph.nodes.map((node) => node.id)).toContain("design-component:Button");
    expect(result.graph.edges.some((edge) => edge.kind === "registers" && edge.to === "design-component:Button")).toBe(
      true,
    );
  });

  test("app code cannot import internal design subpaths", async () => {
    const root = await fixture({
      appSource: `import { Button } from "../design/primitives";\nexport function App() { return Button({}); }\n`,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("design/react-public-import-boundary");
  });

  test("exported taxonomy components must be registered", async () => {
    const root = await fixture({ registrySource: registrySource.replace("Button", "MissingButton") });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("design/react-registry-coverage");
    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("design/react-registry-export");
  });
});

const registrySource = `export const designComponentRegistry = [
  { name: 'Button', category: 'primitive', status: 'canonical', allowedInRoutes: true, },
] as const;
`;

async function fixture({
  appSource = `import { Button } from "../design";\nexport function App() { return Button({}); }\n`,
  registrySource: registry = registrySource,
}: {
  appSource?: string;
  registrySource?: string;
} = {}): Promise<string> {
  const root = tempRoot();
  write(join(root, "eac.config.ts"), config);
  write(join(root, "tokens", "source", "core.json"), `{ "color": { "brand": { "value": "#112233" } } }\n`);
  write(join(root, "src", "styles", "generated", "tokens.css"), `:root { --color-brand: #112233; }\n`);
  write(join(root, "src", "styles", "app.css"), `@import "../design/design-system.css";\n`);

  for (const dir of ["foundations", "primitives", "composites", "patterns"]) {
    await mkdir(join(root, "src", "design", dir), { recursive: true });
    write(join(root, "src", "design", dir, "index.ts"), dir === "primitives" ? `export { Button } from "./button";\n` : "");
  }

  write(join(root, "src", "design", "primitives", "button.tsx"), `export function Button(_props: {}) { return null; }\n`);
  write(join(root, "src", "design", "index.ts"), `export { Button } from "./primitives";\n`);
  write(join(root, "src", "design", "registry.ts"), registry);
  write(join(root, "src", "design", "README.md"), "# Design system\n");
  write(join(root, "src", "design", "design-system.css"), `.ff-button { color: var(--color-brand); }\n`);
  write(join(root, "src", "design", "examples.tsx"), "export const examples = [];\n");
  write(join(root, "src", "design", "components.tsx"), "export const components = [];\n");
  write(join(root, "src", "app", "App.tsx"), appSource);

  return root;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
