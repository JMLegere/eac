import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/core/runner";

const config = `export default {
  adapters: ["infra/terraform"],
  infra: {
    requireTfvarsExample: true,
    requiredScriptKeys: ["tf:init", "tf:fmt", "tf:validate"],
  },
};
`;

describe("infra/terraform adapter", () => {
  test("valid Terraform contract passes and contributes provider variable resource graph nodes", async () => {
    const root = fixture();

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.artifacts.map((artifact) => artifact.kind)).toContain("terraform-source");
    expect(result.graph.nodes.map((node) => node.id)).toContain("infra-provider:terraform");
    expect(result.graph.nodes.map((node) => node.id)).toContain("terraform-provider:cloudflare");
    expect(result.graph.nodes.map((node) => node.id)).toContain("terraform-variable:cloudflare_api_token");
    expect(result.graph.nodes.map((node) => node.id)).toContain("terraform-resource:cloudflare_record.app");
  });

  test("missing Terraform script keys fail when configured", async () => {
    const root = fixture({
      packageJson: JSON.stringify({ scripts: { "tf:init": "terraform init" } }, null, 2),
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("infra/terraform-script-required");
  });

  test("missing ownership boundary evidence fails when configured", async () => {
    const root = fixture({
      configContent: `export default {
  adapters: ["infra/terraform"],
  infra: {
    ownershipBoundaryChecks: [
      { path: "infra/terraform/main.tf", pattern: "runtime owned by deploy tool", description: "runtime deployment boundary" },
    ],
  },
};
`,
    });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("infra/terraform-ownership-boundary");
  });
});

const providersSource = `terraform {
  required_version = ">= 1.8.0"
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
`;

const variablesSource = `variable "cloudflare_api_token" {
  type = string
}

variable "cloudflare_zone_id" {
  type = string
}
`;

const mainSource = `resource "cloudflare_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  value   = "example.com"
}
`;

function fixture({
  configContent = config,
  packageJson = JSON.stringify({ scripts: { "tf:init": "terraform init", "tf:fmt": "terraform fmt -check -recursive", "tf:validate": "terraform validate" } }, null, 2),
}: {
  configContent?: string;
  packageJson?: string;
} = {}): string {
  const root = tempRoot();
  write(join(root, "eac.config.ts"), configContent);
  write(join(root, "package.json"), packageJson);
  write(join(root, "infra", "terraform", "providers.tf"), providersSource);
  write(join(root, "infra", "terraform", "variables.tf"), variablesSource);
  write(join(root, "infra", "terraform", "main.tf"), mainSource);
  write(join(root, "infra", "terraform", "terraform.tfvars.example"), `cloudflare_zone_id = "zone"
`);
  return root;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
