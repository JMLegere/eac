import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AdapterSelection, EacConfig, LoadedConfig } from "./types";

const CONFIG_FILENAMES = ["eac.config.ts", "eac.config.mjs", "eac.config.js"];
const DEFAULT_ADAPTERS: AdapterSelection[] = ["agents/context"];

export function defineEac(config: EacConfig): EacConfig {
  return config;
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(root, filename);
    if (!existsSync(configPath)) continue;

    const mtime = statSync(configPath).mtimeMs;
    const moduleUrl = `${pathToFileURL(configPath).href}?mtime=${mtime}`;
    const loaded = await import(moduleUrl);
    return normalizeConfig(loaded.default ?? loaded.config ?? loaded, configPath);
  }

  return normalizeConfig({}, undefined);
}

function normalizeConfig(raw: unknown, configPath: string | undefined): LoadedConfig {
  if (!raw || typeof raw !== "object") {
    return { path: configPath, config: { adapters: DEFAULT_ADAPTERS } };
  }

  const config = raw as EacConfig;
  return {
    path: configPath,
    config: {
      ...config,
      adapters: config.adapters ?? DEFAULT_ADAPTERS,
      waivers: config.waivers ?? [],
    },
  };
}

export function adapterOptions<T = unknown>(config: EacConfig, adapterId: string): T | undefined {
  for (const selection of config.adapters ?? DEFAULT_ADAPTERS) {
    if (typeof selection === "string") continue;
    if (selection.use === adapterId) return selection.options as T;
  }

  if (adapterId === "agents/context") return config.agents as T | undefined;
  if (adapterId === "product/manifest") return config.product as T | undefined;
  if (adapterId === "cucumber/bdd") return (config.cucumber ?? config.bdd) as T | undefined;
  if (adapterId === "architecture/mermaid") return config.architecture as T | undefined;
  if (adapterId === "design/react") return config.design as T | undefined;
  if (adapterId === "data/supabase") return config.data as T | undefined;
  if (adapterId === "infra/terraform") return config.infra as T | undefined;
  if (adapterId === "deploy/cloudflare") return config.deploy as T | undefined;

  return undefined;
}
