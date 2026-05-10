import type { Adapter, Diagnostic, RepoContext, Rule, Severity } from "../core/types";

type PackageJson = {
  version?: unknown;
};

type VersioningSemverOptions = {
  packageJson?: string;
  tagPrefix?: string;
};

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const versioningSemverAdapter: Adapter = {
  id: "versioning/semver",
  description: "Strict semantic version enforcement for releaseable repos.",

  rules(ctx): Rule[] {
    return [
      {
        id: "versioning/package-version-semver",
        description: "package.json version is strict SemVer 2.0.0.",
        source: versioningSemverAdapter.id,
        check(checkCtx) {
          return checkPackageVersion(checkCtx, severityFor(checkCtx));
        },
      },
      {
        id: "versioning/tag-matches-package-version",
        description: "Release tag matches package.json version when running in a tag context.",
        source: versioningSemverAdapter.id,
        check(checkCtx) {
          return checkTagMatchesPackageVersion(checkCtx, severityFor(checkCtx));
        },
      },
    ];
  },
};

function options(ctx: RepoContext): Required<VersioningSemverOptions> {
  const configured = ctx.adapterOptions<VersioningSemverOptions>(versioningSemverAdapter.id) ?? {};
  return {
    packageJson: configured.packageJson ?? "package.json",
    tagPrefix: configured.tagPrefix ?? "v",
  };
}

function checkPackageVersion(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const opts = options(ctx);

  if (!ctx.fs.exists(opts.packageJson)) {
    return [
      {
        ruleId: "versioning/package-version-semver",
        severity,
        message: `versioning/semver requires ${opts.packageJson}`,
        path: opts.packageJson,
        target: opts.packageJson,
        hint: "add package.json or disable the versioning/semver adapter",
        source: versioningSemverAdapter.id,
      },
    ];
  }

  const pkg = ctx.fs.readJson<PackageJson>(opts.packageJson);
  if (typeof pkg.version !== "string" || !STRICT_SEMVER.test(pkg.version)) {
    return [
      {
        ruleId: "versioning/package-version-semver",
        severity,
        message: `${opts.packageJson} version must be strict SemVer 2.0.0`,
        path: opts.packageJson,
        target: opts.packageJson,
        hint: "use MAJOR.MINOR.PATCH with optional prerelease/build metadata, e.g. 0.1.0 or 1.0.0-beta.1",
        source: versioningSemverAdapter.id,
      },
    ];
  }

  return [];
}

function checkTagMatchesPackageVersion(ctx: RepoContext, severity: Severity): Diagnostic[] {
  const tag = currentTagName();
  if (!tag) return [];

  const opts = options(ctx);
  if (!ctx.fs.exists(opts.packageJson)) return [];

  const pkg = ctx.fs.readJson<PackageJson>(opts.packageJson);
  if (typeof pkg.version !== "string" || !STRICT_SEMVER.test(pkg.version)) return [];

  const expected = `${opts.tagPrefix}${pkg.version}`;
  if (tag === expected) return [];

  return [
    {
      ruleId: "versioning/tag-matches-package-version",
      severity,
      message: `release tag ${tag} does not match package version ${pkg.version}`,
      path: opts.packageJson,
      target: tag,
      hint: `use tag ${expected} or update ${opts.packageJson} before releasing`,
      source: versioningSemverAdapter.id,
    },
  ];
}

function currentTagName(): string | undefined {
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }

  const ref = process.env.GITHUB_REF;
  if (ref?.startsWith("refs/tags/")) {
    return ref.slice("refs/tags/".length);
  }

  return undefined;
}

function severityFor(ctx: RepoContext): Severity {
  return ctx.mode === "check" ? "error" : "warning";
}

export function isStrictSemver(value: string): boolean {
  return STRICT_SEMVER.test(value);
}
