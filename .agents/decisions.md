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
