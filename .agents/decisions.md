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
