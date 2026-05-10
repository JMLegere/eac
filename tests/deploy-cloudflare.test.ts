import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/core/runner";

const config = `export default {
  adapters: ["deploy/cloudflare"],
  deploy: {
    requireWorkerSource: true,
    requireAssets: true,
    requireRoutes: true,
    requireCustomDomains: true,
    requireEnvExample: true,
    requireWranglerDependency: true,
    requiredEnvKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    requiredScriptKeys: ["build", "deploy"],
    requiredDeployScriptPatterns: ["check-env-contract.mjs --cloudflare-deploy", "wrangler deploy"],
    requiredWorkflowChecks: [
      { path: ".github/workflows/verify.yml", pattern: "needs.ci.result == 'success'", description: "deploy waits for CI" },
    ],
  },
};
`;

describe("deploy/cloudflare adapter", () => {
  test("valid Wrangler deployment contract passes and contributes route asset var graph nodes", async () => {
    const root = fixture();

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.artifacts.map((artifact) => artifact.kind)).toContain("cloudflare-wrangler-config");
    expect(result.graph.nodes.map((node) => node.id)).toContain("cloudflare-deployment:test-worker");
    expect(result.graph.nodes.map((node) => node.id)).toContain("cloudflare-route:example.com");
    expect(result.graph.nodes.map((node) => node.id)).toContain("cloudflare-assets:ASSETS");
    expect(result.graph.nodes.map((node) => node.id)).toContain("cloudflare-var:APP_ORIGIN");
  });

  test("route custom domain requirement fails when configured", async () => {
    const root = fixture({
      wrangler: wranglerSource.replace("\"custom_domain\": true", "\"custom_domain\": false"),
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("deploy/cloudflare-custom-domain");
  });

  test("missing deploy prerequisites fail when configured", async () => {
    const root = fixture({
      packageJson: JSON.stringify({ scripts: { build: "vite build" } }, null, 2),
      envExample: "CLOUDFLARE_API_TOKEN=\n",
      deployScript: "pnpm build\n",
    });

    const result = await runCheck({ root });
    const ruleIds = result.diagnostics.map((diagnostic) => diagnostic.ruleId);

    expect(ruleIds).toContain("deploy/cloudflare-script-required");
    expect(ruleIds).toContain("deploy/cloudflare-wrangler-dependency");
    expect(ruleIds).toContain("deploy/cloudflare-env-key");
    expect(ruleIds).toContain("deploy/cloudflare-deploy-script-pattern");
  });
});

const wranglerSource = `{
  // JSONC comments and trailing commas should parse.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "test-worker",
  "compatibility_date": "2026-05-08",
  "main": "src/worker.ts",
  "workers_dev": false,
  "routes": [
    { "pattern": "example.com", "custom_domain": true },
  ],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
  },
  "vars": {
    "APP_ORIGIN": "https://example.com",
  },
}
`;

function fixture({
  wrangler = wranglerSource,
  packageJson = JSON.stringify({ scripts: { build: "vite build", deploy: "sh scripts/deploy-cloudflare.sh" }, devDependencies: { wrangler: "^4.45.0" } }, null, 2),
  envExample = "CLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n",
  deployScript = "node scripts/check-env-contract.mjs --cloudflare-deploy\npnpm build\npnpm exec wrangler deploy\n",
  workflow = "jobs:\n  deploy:\n    if: needs.ci.result == 'success'\n",
}: {
  wrangler?: string;
  packageJson?: string;
  envExample?: string;
  deployScript?: string;
  workflow?: string;
} = {}): string {
  const root = tempRoot();
  write(join(root, "eac.config.ts"), config);
  write(join(root, "wrangler.jsonc"), wrangler);
  write(join(root, "package.json"), packageJson);
  write(join(root, ".env.example"), envExample);
  write(join(root, "scripts", "deploy-cloudflare.sh"), deployScript);
  write(join(root, ".github", "workflows", "verify.yml"), workflow);
  write(join(root, "src", "worker.ts"), "export default { fetch: () => new Response('ok') };\n");
  return root;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
