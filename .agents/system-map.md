# System Map

Current implemented slice:

```text
repo root
  -> eac CLI
    -> command parser
      -> config loader
        -> adapter registry
          -> artifact registry
          -> repo graph
          -> rule collection
          -> waiver filter
          -> command reporter
```

Enabled dogfood adapters in this repo:

```text
agents/context
  -> declares .agents artifacts
  -> init creates missing files
  -> doctor emits advisory diagnostics
  -> check emits strict diagnostics

product/manifest
  -> loads eac.model.ts
  -> declares capability/action/workflow graph nodes
  -> checks IDs, ownership, references, verification obligations, high-risk mutation model coverage

cucumber/bdd
  -> discovers features/**/*.feature
  -> parses @capability.<id> and @action.<id> tags
  -> links feature/scenario graph nodes to product graph nodes
  -> checks feature ownership and BDD action coverage

versioning/semver
  -> checks package.json strict SemVer
  -> checks release tag/version alignment in tag contexts
```

Current dogfood traceability path:

```text
eac.model.ts
  -> productCapabilities.eacKernel
    -> features/eac-kernel.feature @capability.eac-kernel
      -> @action.run-init
      -> @action.run-doctor
      -> @action.run-check
        -> bun test
        -> eac check
        -> tsc --noEmit
        -> bun build
```

Target kernel composition:

```text
source-of-truth config
  -> adapter registry
    -> artifact registry / repo graph
      -> rule engine
        -> diagnostics
          -> waiver filter
            -> command reporter
```

Distribution path:

```text
TypeScript source
  -> Bun compiled binary
    -> GitHub release asset
      -> mise github backend
        -> eac on PATH
```
