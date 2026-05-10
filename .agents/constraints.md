# Constraints

Hard rules for EAC itself:

- Keep the kernel small: config loading, adapter lifecycle, artifacts/graph, rules, diagnostics, waivers, and command orchestration.
- Keep domain-specific behavior in adapters; the kernel must not know Cucumber, XState, Mermaid, Vite, or deployment platforms directly.
- Store project truth in repo-owned artifacts, not hidden package state or a hosted service.
- `doctor` is advisory and should exit 0 for ordinary findings; `check` is strict and fails on unwaived errors.
- `init` may create missing safe files by default, but must not overwrite existing files without an explicit force option.
- Primary distribution target is a GitHub release asset installable by mise, not npm publishing.
