# Decisions

## 2026-05-10 — Canonical identity is EAC

Use `eac` as the product, repository, binary, and config prefix:

```text
repo: JMLegere/eac
binary: eac
config: eac.config.ts
```

Do not tie the project to Agent Maple branding or package namespaces.

## 2026-05-10 — First implementation slice

Build the core/kernel plus exactly one real adapter first.

The first adapter is `agents/context` because it exercises the command loop, artifact declaration, diagnostics, and strict/advisory rule behavior without pulling in product manifest, Cucumber, XState, or Mermaid complexity.

## 2026-05-10 — Init write behavior

`eac init` writes missing safe files by default and skips existing files. Overwriting requires `--force`.

## 2026-05-10 — Kernel graph boundary

The kernel owns only a domain-agnostic artifact registry and repo graph contract:

- adapters contribute artifacts, graph nodes, graph edges, rules, init actions, and diagnostics
- kernel validates global rule IDs, artifact IDs, graph node IDs, and graph edge endpoints
- product, Cucumber, Mermaid, XState, design, env, and deploy semantics stay inside adapters

This is the first non-bootstrap kernel boundary after `agents/context`.

## 2026-05-10 — Product manifest adapter shape

`product/manifest` dynamically imports a repo-owned manifest module, defaulting to `eac.model.ts`.

Supported manifest exports:

- `actionCapabilities`
- `productCapabilities`
- `userActionWorkflows`

The adapter validates stable IDs, action verification obligations, action/capability/workflow references, high-risk mutation model coverage or exemption, and product graph nodes/edges.

## 2026-05-10 — Cucumber BDD adapter shape

`cucumber/bdd` parses repo-owned `.feature` files and enforces product traceability through tags:

- Feature-level `@capability.<id>` tags must reference known product capabilities
- Scenario/Scenario Outline `@action.<id>` tags must reference known actions
- actions requiring `bdd` must have scenario coverage
- each capability's required actions must be covered by one of its declared feature files
- orphan feature files are strict by default when feature inventory enforcement is enabled

## 2026-05-10 — SemVer is release hygiene, not an EAC adapter

Do not ship `versioning/semver` as a built-in EAC adapter.

Rationale: EAC adapters should model repo contracts that help humans, agents, and CI understand product/project truth. Package version/tag consistency is release-process hygiene for EAC itself, not a reusable Everything-as-Code contract module in the standard tool.

Keep strict package-version checks in release packaging scripts where useful, but outside the adapter registry and public adapter surface.

## 2026-05-10 — Main-website adapter set generalizes provider contracts

Use the following public adapter set for the `../main-website` seed validation path:

- `product/superbdd`
- `architecture/mermaid`
- `design/react`
- `data/supabase`
- `infra/terraform`
- `deploy/cloudflare`

These are public contract adapters, not main-website-specific scripts. Internal/provider evidence stays behind the public adapter seam; all adapters should accept configurable paths/options with sensible defaults. `../main-website` is seed evidence for validation, not the adapter boundary.

Environment checks are internal rule groups under provider adapters. GitHub Actions remains activation wiring, not a public adapter.

## 2026-05-10 — EAC repo dogfood installs through add/init and fails until authored

Do not use prefilled repo-local dogfood artifacts as proof of the fresh install story.

The EAC repo was reinstalled through the same onboarding path users should run. The repo now has starter SuperBDD artifacts, but they are intentionally not valid product truth yet:

```text
mise use github:JMLegere/eac@latest
eac add product/superbdd
  -> eac.config.ts only
eac init
  -> product/manifest.ts
  -> features/repo-contract.feature
eac check
  -> fails with product/starter-placeholder until starter placeholders are replaced with real product truth
```

`add` enables an EAC adapter bundle in config; `init` scaffolds missing files for enabled adapters. A passing `eac check` must require authored product truth, not generated placeholders.

## 2026-05-18 — SuperBDD doctor teaches the model after install

When `product/superbdd` is installed, `eac doctor` emits an advisory info diagnostic explaining the SuperBDD model and implementation loop.

Rationale: after `eac add product/superbdd`, users need to understand the concepts (capabilities, features, scenarios, steps, actions, optional workflows) and how to wire local advisory and strict CI check scripts before `eac check` can become useful. This stays adapter-owned so the kernel remains domain-agnostic.