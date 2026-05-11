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

Installed repo-local dogfood state:

```text
EAC repo source tree
  -> eac.config.ts
    -> adapters: ["product/superbdd"]
    -> product.manifest: "product/manifest.ts"
    -> cucumber.features: ["features/**/*.feature"]
  -> product/manifest.ts
    -> starter action/capability with eacStarter: true
  -> features/repo-contract.feature
    -> starter BDD scenario
  -> eac check
    -> fails on product/starter-placeholder until authored
```

Clean SuperBDD onboarding path:

```text
mise use github:JMLegere/eac@latest
  -> eac binary on PATH
eac add product/superbdd
  -> target resolver
    -> adapters: ["product/superbdd"]
    -> product.manifest: "product/manifest.ts"
    -> cucumber.features: ["features/**/*.feature"]
  -> eac.config.ts
eac init
  -> product/manifest.ts
  -> features/repo-contract.feature
eac check
  -> fails on starter placeholders
  -> passes only after the repo authors real product truth
```

Repo verification path:

```text
bun test
  -> adapter/unit coverage
  -> clean `eac add product/superbdd` + `eac init` fixture coverage
tsc --noEmit
bun src/cli.ts check
  -> default agents/context check only when no repo config is installed
bun build src/cli.ts --compile --outfile dist/eac
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

Implemented public adapter set seeded by `../main-website`:

```text
product/superbdd
  -> compiles Capability -> Feature -> Scenario -> Step -> Action evidence

architecture/mermaid
  -> discovers and parses Mermaid source diagrams

design/react
  -> validates React design-system artifacts, registry, and usage boundaries

data/supabase
  -> validates static Supabase runtime/data contract artifacts

infra/terraform
  -> validates static Terraform source truth and ownership boundaries

deploy/cloudflare
  -> validates static Wrangler runtime deployment contract evidence
```

All six adapters are generalized through configurable paths/options. `../main-website` is the seed validation repo, not the adapter boundary.
