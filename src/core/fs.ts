import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EacFileSystem } from "./types";

export function createFileSystem(root: string): EacFileSystem {
  const resolve = (path: string) => join(root, path);

  return {
    exists(path: string): boolean {
      return existsSync(resolve(path));
    },

    readText(path: string): string {
      return readFileSync(resolve(path), "utf8");
    },

    readJson<T = unknown>(path: string): T {
      return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
    },

    writeText(path: string, content: string): void {
      const absolutePath = resolve(path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    },
  };
}
