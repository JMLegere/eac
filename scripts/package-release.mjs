import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import pkg from "../package.json" with { type: "json" };

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const version = pkg.version;

if (!STRICT_SEMVER.test(version)) {
  throw new Error(`package.json version is not strict SemVer: ${version}`);
}
const platform = process.platform === "darwin" ? "macos" : process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch;
const releaseDir = join(process.cwd(), "release");
const stagingDir = join(releaseDir, `eac-${version}-${platform}-${arch}`);
const binaryPath = join(process.cwd(), "dist", process.platform === "win32" ? "eac.exe" : "eac");
const stagedBinary = join(stagingDir, process.platform === "win32" ? "eac.exe" : "eac");
const archiveName = `eac-${version}-${platform}-${arch}.tar.gz`;
const archivePath = join(releaseDir, archiveName);

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(binaryPath, stagedBinary);
chmodSync(stagedBinary, 0o755);
execFileSync("tar", ["-czf", archivePath, "-C", stagingDir, basename(stagedBinary)], { stdio: "inherit" });

const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`, "utf8");

console.log(`created ${archivePath}`);
console.log(`created ${archivePath}.sha256`);
