import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runCheck } from "../src/core/runner";

const config = `export default {
  adapters: ["data/supabase"],
};
`;

describe("data/supabase adapter", () => {
  test("valid static Supabase contract passes and contributes table and migration graph nodes", async () => {
    const root = fixture();

    const result = await runCheck({ root });

    expect(result.diagnostics).toEqual([]);
    expect(result.graph.artifacts.map((artifact) => artifact.kind)).toContain("supabase-generated-types");
    expect(result.graph.nodes.map((node) => node.id)).toContain("data-provider:supabase");
    expect(result.graph.nodes.map((node) => node.id)).toContain("data-table:supabase:profiles");
    expect(result.graph.nodes.map((node) => node.id)).toContain("data-migration:supabase:supabase/migrations/0001_initial_schema.sql");
    expect(result.graph.edges.some((edge) => edge.kind === "defines-table" && edge.to === "data-table:supabase:profiles")).toBe(
      true,
    );
  });

  test("env example must contain configured Supabase activation keys", async () => {
    const root = fixture({ envExample: envExample.replace("SUPABASE_PROJECT_REF=abcdefghijklmnopqrst\n", "") });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("data/supabase-env-key");
  });

  test("migrations must use ordered numeric file names", async () => {
    const root = fixture({ migrationName: "initial.sql" });

    const result = await runCheck({ root });

    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("data/supabase-migration-name");
  });
});

const envExample = `VITE_DATA_SOURCE=auto
VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ACCESS_TOKEN=
SUPABASE_ORGANIZATION_ID=
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
SUPABASE_DB_PASSWORD=
SUPABASE_REGION=us-east-1
`;

const databaseTypes = `export type Json = string | number | boolean | null;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string };
        Insert: { id?: string };
        Update: { id?: string };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};
`;

function fixture({
  envExample: env = envExample,
  migrationName = "0001_initial_schema.sql",
}: {
  envExample?: string;
  migrationName?: string;
} = {}): string {
  const root = tempRoot();
  write(join(root, "eac.config.ts"), config);
  write(join(root, ".env.example"), env);
  write(join(root, "package.json"), JSON.stringify({ scripts: { "supabase:types": "supabase gen types typescript --local" } }, null, 2));
  write(join(root, "src", "env.ts"), `export type DataSourceMode = 'auto' | 'memory' | 'supabase';
export function getRuntimeConfig(env = import.meta.env) {
  const dataSource = env.VITE_DATA_SOURCE ?? 'auto';
  const supabase = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY } : null;
  return { dataSource, supabase };
}
export function shouldUseSupabase(config = getRuntimeConfig()) { return config.dataSource === 'supabase' || (config.dataSource === 'auto' && config.supabase !== null); }
`);
  write(join(root, "src", "adapters", "supabase", "database.types.ts"), databaseTypes);
  write(join(root, "src", "adapters", "supabase", "client.ts"), `import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export function createBrowserSupabaseClient(config: { url: string; anonKey: string }) { return createClient<Database>(config.url, config.anonKey); }
`);
  write(join(root, "src", "adapters", "supabase", "index.ts"), `import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export function createSupabaseAdapters(client: SupabaseClient<Database>) { return { client }; }
`);
  write(join(root, "src", "application", "container.ts"), `import { createBrowserSupabaseClient, createSupabaseAdapters } from '../adapters/supabase';
const client = createBrowserSupabaseClient({ url: '', anonKey: '' });
export const applicationServices = client ? createSupabaseAdapters(client) : {};
`);
  write(join(root, "src", "worker.ts"), `import { createClient } from '@supabase/supabase-js';
import type { Database } from './adapters/supabase/database.types';
type WorkerEnv = { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string };
export function createAdmin(env: WorkerEnv) { return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? ''); }
`);
  write(join(root, "supabase", "config.toml"), "project_id = 'test'\n");
  write(join(root, "supabase", "migrations", migrationName), "create table profiles (id uuid primary key);\n");
  return root;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "eac-test-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
