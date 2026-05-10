# EAC PRD

Date: 2026-05-09
Status: Draft
Working repo: `/home/jerry/Workspace/eac`
Working product name: EAC

## 1. Executive Summary

EAC is an Everything-as-Code framework for making a software repo self-describing, agent-ready, and CI-enforced.

The product should follow a Pi-style model: a minimal kernel with many ways to adapt and plug into it. Users should be able to add capabilities, adapters, profiles, generators, local rules, and repo-owned artifacts instead of accepting a sealed framework that dictates their whole project shape.

EAC does not replace Vite, Next, Django, Rails, Cargo, Pytest, Terraform, Supabase, Cloudflare, or any other project toolchain. It sits above them as a repo contract layer:

```text
Existing project tools = build, runtime, framework, deploy, test execution
EAC = repo intelligence, traceability, agent contracts, strict verification, CI compilation
```

The core command loop is:

```bash
eac init      # install/scaffold repo-owned artifacts
eac doctor    # report setup gaps/adoption status; never fail
eac check     # strict CI/local compiler for configured rules
```

The initial standard distribution should include first-party modules for:

- agent/project context artifacts
- product manifest / capability-action model
- Cucumber/BDD executable requirements
- XState/workflow modeling for genuinely stateful behavior
- Mermaid architecture-as-code
- basic package/task/CI wiring

These are included as official modules, not hard-coded into the kernel.

## 2. Problem

Modern software repos are difficult for both humans and agents to operate safely because project truth is scattered across:

- source code
- test files
- README docs
- architecture diagrams
- CI workflows
- environment files
- deployment configs
- design systems
- issue trackers
- agent instructions
- tribal knowledge

AI coding agents make this harder and more important. Agents can move quickly, but they need a trustworthy, machine-checkable model of:

- what the product is supposed to do
- what user-visible actions exist
- what states and transitions matter
- which tests prove which obligations
- which architecture/design/environment/deployment constraints are binding
- what agents are allowed to change
- which waivers/exceptions exist and why

Without a strict repo contract, agents infer from stale files, partial tests, and local conventions. This causes drift, accidental scope changes, weak tests, and unsafe modifications.

## 3. Product Vision

EAC should become the repo operating-system layer for agentic software development.

It should let any project declare, install, check, and evolve its own Everything-as-Code contract.

```text
repo intent -> repo contracts -> repo artifacts -> repo checks -> CI enforcement -> agent-safe execution
```

The framework should be:

- project-agnostic
- strict by default
- plugin/adaptor-driven
- repo-owned, not hidden-state-driven
- useful for humans and agents
- composable across stacks
- small-kernel, rich-ecosystem

## 4. Product Doctrine

### 4.1 Minimal kernel, maximal contracts

The kernel should stay small and stable:

- config loading
- adapter runtime/lifecycle
- normalized repo graph / artifact registry
- rule engine
- diagnostics
- waivers/exemptions
- init/doctor/check orchestration

The kernel should not hard-code Vite, React, Cucumber, XState, Mermaid, Supabase, Terraform, etc.

### 4.2 Included, not entangled

The main distribution should include a strong EAC standard pack, but every piece should still be implemented as a module/adapter over the kernel.

Standard first-party pack:

- agents/context
- product manifest
- Cucumber/BDD
- XState/workflow
- Mermaid/architecture
- task/CI wiring basics

### 4.3 Repo-owned truth

EAC must install and check repo-owned artifacts. It must not hide the project model in package state or an external service.

Examples of repo-owned truth:

```text
eac.config.ts
.agents/
architecture/
features/
workflows/
tokens/
src/domain/actions.ts or equivalent manifest
.github/workflows/
package.json / pyproject.toml / Cargo.toml / Makefile
```

### 4.4 Strictness by default

`eac check` should be max-strict immediately.

- `doctor` is forgiving.
- `check` is unforgiving.
- Optional adapters are not mandatory.
- Once enabled, adapters are strict.
- Exceptions must be explicit, source-controlled waivers with rule, target, reason, owner, and expiry/revision condition.

### 4.5 Work with existing tools, never replace them

EAC is not an app framework, bundler, test runner, or deployment platform.

It should work with existing tools:

```text
Vite / Next / Django / Rails / Cargo / etc. = app/build/runtime toolchain
EAC = repo intelligence, traceability, agent contract, CI compiler layer
```

## 5. Inspiration and Prior Art

### 5.1 Pi-style extensibility

Pi positions itself as a minimal terminal coding harness that users adapt to their workflows through extensions, skills, prompt templates, themes, and packages. It emphasizes primitives over baked-in features.

EAC should use the same product model:

```text
Pi:
  minimal agent harness
  add extensions / skills / packages

EAC:
  minimal repo-contract kernel
  add adapters / rules / profiles / generators
```

### 5.2 ESLint-style enforcement

EAC should feel like ESLint for project intelligence and agent readiness:

```text
project config
+ adapters/rules
+ CLI check
+ CI failure
+ actionable diagnostics
```

### 5.3 shadcn/Storybook-style installation

EAC should install repo-owned artifacts instead of keeping important truth hidden in the package.

`eac init` should scaffold or update project files safely and idempotently.

### 5.4 TypeScript-style trust

`eac check` should be a compiler for the repo contract. If the project violates its declared model, CI fails.

## 6. Current Prototype Evidence

The current `/home/jerry/Workspace/main-website` repo already contains a project-specific EAC prototype. It should be treated as the extraction seed, not as the final product shape.

### 6.1 Product/action/testing model

```text
src/domain/userActions.ts
features/*.feature
scripts/check-action-coverage.mjs
scripts/check-model-workflow-coverage.mjs
scripts/test-model-workflows.mjs
scripts/check-rendered-actions.mjs
architecture/test-infrastructure.mmd
```

The repo has:

- `productCapabilities`: business capability -> Cucumber feature files -> required action leaves
- `actionCapabilities`: user-visible operations with actor, surface, risk, auth, boundary, verification obligations
- `userActionWorkflows`: stateful model-based workflow definitions
- Cucumber features tagged with `@capability.<id>`
- scenarios tagged with `@action.<id>`
- action coverage checks
- workflow coverage checks
- executable deterministic model tests against domain/application services
- rendered route audits for links/buttons/forms carrying `data-user-action`

### 6.2 Architecture-as-code

```text
architecture/system.mmd
architecture/ports-and-adapters.mmd
architecture/verification-pipeline.mmd
architecture/test-infrastructure.mmd
```

Architecture is lightweight, diffable, agent-readable, and CI-checkable through Mermaid.

### 6.3 Design-system-as-code

```text
src/design/
tokens/source/core.json
style-dictionary.config.mjs
scripts/check-design-contract.mjs
src/design/registry.test.ts
```

The repo enforces:

- token source ownership
- generated CSS variables
- design taxonomy: foundations / primitives / composites / patterns
- public design API
- design component registry
- no private `ff-*` class usage in app code
- no raw hex colors outside token source/generated output
- no internal design imports from route/app code
- no casual `className` / `style` props on design components

### 6.4 Environment/deploy-as-code

```text
.env.example
scripts/check-env-contract.mjs
wrangler.jsonc
infra/terraform/
.github/workflows/verify.yml
scripts/deploy-cloudflare.sh
scripts/bootstrap-github-cd.sh
```

The repo enforces:

- environment key inventory
- runtime mode validation
- provider value shape checks
- deployment wiring
- Terraform boundary
- CI/CD as code

### 6.5 Agent/project context as code

```text
.agents/constraints.md
.agents/decisions.md
.agents/community-hub-agent-prd.md
```

The repo stores project-local operating context for agents.

### 6.6 Verification pipeline

Current project gate includes:

```text
formatting
-> design tokens
-> env contract
-> design contract
-> action/capability contract
-> model workflow contract
-> executable model tests
-> rendered action audit
-> typecheck
-> unit tests
-> BDD requirements
-> build
-> smoke routes
-> CI/deploy
```

EAC should generalize this pattern.

## 7. Core Concepts

### 7.1 Artifact

A repo-owned file or generated output that participates in the contract.

Examples:

- `features/auth.feature`
- `architecture/system.mmd`
- `src/domain/userActions.ts`
- `.agents/constraints.md`
- `.github/workflows/verify.yml`
- `tokens/source/core.json`

### 7.2 Adapter

A module that teaches EAC how to detect, scaffold, validate, or generate part of the repo contract.

Adapters can contribute:

- detection
- init scaffolds
- artifacts
- rules
- doctor diagnostics
- generators
- checkers
- model mappers

### 7.3 Rule

A strict check over the normalized repo model and/or artifacts.

Rules emit structured diagnostics and may be waived only explicitly.

### 7.4 Diagnostic

A structured finding from `doctor` or `check`.

Required diagnostic fields should include:

- rule id
- severity
- message
- file/path when applicable
- location when applicable
- fix hint when possible
- adapter/source

### 7.5 Waiver

A source-controlled exception to a strict rule.

Required shape:

```ts
{
  rule: "cucumber/action-coverage",
  target: "billing",
  reason: "Billing workflow not implemented until Stripe contract is chosen.",
  owner: "jeremy",
  expires: "2026-06-01"
}
```

Invalid waivers fail `eac check`.

### 7.6 Repo graph

A normalized model of project entities and relationships.

Initial graph node types:

- artifact
- capability
- feature
- scenario
- action
- workflow
- state
- transition
- verification obligation
- architecture diagram
- agent context file
- rule
- waiver

Initial graph edge types:

- owns
- covers
- requires
- verifies
- references
- generates
- depends-on
- waives

## 8. CLI Commands

### 8.1 `eac init`

Purpose: install/scaffold repo-owned EAC artifacts.

Expected behavior:

- detect existing stack/tooling
- ask minimal questions only when necessary
- install safe baseline artifacts
- avoid overwriting user files without explicit confirmation or merge strategy
- wire package/task/CI commands where adapter supports it
- create a repo that can pass `eac check` immediately for the enabled baseline

Possible options:

```bash
eac init
eac init --profile vite-react
eac init --pack standard
eac init --adapter cucumber
eac init --dry-run
eac init --write
```

### 8.2 `eac doctor`

Purpose: report setup gaps and adoption status. Never fails because the repo is incomplete.

Expected behavior:

- run detection
- show enabled adapters
- show missing recommended artifacts
- show what `eac init` can repair
- show what would fail in `eac check`
- never exit non-zero for ordinary findings

### 8.3 `eac check`

Purpose: strict compiler for configured repo contract.

Expected behavior:

- load config and adapters
- build normalized repo graph
- run every enabled rule
- validate waivers
- fail on any unwaived error
- print actionable diagnostics
- support CI-friendly output

Possible options:

```bash
eac check
eac check --format pretty
eac check --format json
eac check --rule cucumber/action-coverage
eac check --adapter mermaid
```

## 9. Standard First-Party Pack

The standard pack is the initial opinionated EAC experience. It should be included with the main distribution.

### 9.1 Agent/context adapter

Purpose: make project operating context explicit for humans and agents.

Scaffold examples:

```text
.agents/constraints.md
.agents/decisions.md
.agents/open-questions.md
.agents/system-map.md
```

Rules:

- required context files exist
- required files are not empty stub-only files
- decisions/constraints are readable markdown
- configured agent instruction files exist, e.g. `AGENTS.md`, `CLAUDE.md`, `.omp/SYSTEM.md` where enabled

### 9.2 Product manifest adapter

Purpose: declare capabilities, actions, workflows, and verification obligations.

Potential artifact names:

```text
eac.model.ts
eac.manifest.ts
src/domain/userActions.ts
```

Need support for project-specific manifest location.

Core model:

```text
Capability -> Feature -> Scenario -> Action
Action -> Verification obligations
Action -> Workflow events where stateful
Workflow -> States/transitions/forbidden transitions
```

Rules:

- ids are stable, unique, kebab-case
- no orphan capabilities/actions/workflows
- every action declares verification obligations
- high-risk durable mutations require state/model coverage or explicit waiver

### 9.3 Cucumber adapter

Purpose: executable human-readable product requirements.

Rules:

- every declared feature file exists
- every Cucumber Feature carries a known `@capability.<id>` tag
- every `@capability.*` and `@action.*` tag references known manifest ids
- every action requiring BDD has at least one `@action.<id>` Scenario or Scenario Outline
- every capability's required actions are covered by one of its owned feature files

### 9.4 XState/workflow adapter

Purpose: model genuinely stateful workflows.

Important doctrine: not every route or screen needs XState. Use workflow models only for real lifecycles.

Examples:

- auth/access lifecycle
- approval workflows
- admin role governance
- payment/subscription lifecycle
- onboarding
- background jobs

Rules:

- workflow schema is valid
- initial state exists
- transition endpoints are known states
- workflow events reference known action ids
- every workflow event appears in allowed or forbidden transitions
- forbidden transitions include reasons
- states/transitions/forbidden transitions are covered once workflow adapter is enabled
- runtime XState machines match manifest where present

### 9.5 Mermaid architecture adapter

Purpose: architecture-as-code.

Rules:

- configured architecture directory exists
- required diagrams exist
- Mermaid files parse
- no orphan diagrams when inventory is declared
- diagrams link to configured architecture claims or repo artifacts where required
- optional rendered output is fresh if generation is enabled

Initial scaffold:

```text
architecture/system.mmd
architecture/verification-pipeline.mmd
architecture/README.md or architecture/index.md
```

### 9.6 Task/CI wiring adapter

Purpose: ensure the repo actually runs `eac check`.

Rules:

- local task runner invokes `eac check`
- CI invokes `eac check`
- CI does not mark EAC failures as continue-on-error unless explicitly waived
- generated artifacts are fresh if generation is enabled

## 10. Optional First-Party Adapter Families

These are not required for v1, but the architecture must support them.

### 10.1 Design adapters

Examples:

- Style Dictionary
- Tailwind
- Storybook
- design token contracts
- component registries

Potential rules:

- token source exists
- generated tokens are fresh
- raw colors forbidden outside token source/generated output
- component registry matches public API
- app code imports only public design API
- design components follow configured prop policy

### 10.2 Environment adapters

Examples:

- dotenv
- typed env schemas
- provider variable shape checks

Potential rules:

- `.env.example` contains required keys
- runtime modes are valid
- required env vars exist for deployment modes
- secret-looking values are not committed where forbidden
- provider IDs/URLs match expected shapes

### 10.3 Deployment/infra adapters

Examples:

- GitHub Actions
- Cloudflare
- Vercel
- Terraform
- Supabase
- Docker
- Kubernetes

Potential rules:

- deployment config exists
- CI deploy path invokes required gates
- Terraform files format/validate
- Supabase migrations are ordered and valid
- Cloudflare/Vercel config matches declared hostnames

### 10.4 Test adapters

Examples:

- Vitest
- Jest
- Playwright
- Pytest
- Cargo test

Potential rules:

- declared verification obligations map to test commands
- test commands exist and run in CI
- coverage artifacts are present where configured

### 10.5 App framework adapters

Examples:

- Vite
- Next
- Remix
- Astro
- Django
- Rails
- SvelteKit

Potential rules:

- routes/surfaces can be discovered
- rendered/source action audits can run where supported
- build command is wired into verification pipeline

### 10.6 API/data adapters

Examples:

- OpenAPI
- GraphQL
- Prisma
- Supabase

Potential rules:

- API specs parse
- schema/migration drift is detected
- route/action boundaries link to API operations
- dangerous operations have stronger verification obligations

### 10.7 Local/community adapters

Projects must be able to define local rules without publishing a package.

Example:

```ts
export default defineEac({
  adapters: [
    localAdapter({
      name: "company-rules",
      rules: [noPublicSlackChannels(), requireOwnerOnWaivers()],
    }),
  ],
});
```

## 11. Profiles and Packs

Profiles bundle adapters and default rules for common stacks.

Examples:

```ts
export default defineEac({
  profile: viteReactApp(),
});
```

Possible profiles:

- `standard()`
- `viteReactApp()`
- `nextApp()`
- `pythonApi()`
- `rustCli()`
- `cloudflareSupabaseApp()`
- `designSystemPackage()`
- `monorepo()`

Profiles should be convenience layers, not magic. Users can inspect what adapters/rules they enable.

## 12. Configuration Sketch

Example `eac.config.ts`:

```ts
import { defineEac } from "eac";
import { standard, viteReactApp } from "eac/profiles";
import { styleDictionary } from "eac/adapters/design";
import { cloudflare, supabase, terraform } from "eac/adapters/deploy";

export default defineEac({
  project: {
    name: "freddy-founders",
  },

  profile: viteReactApp(),

  packs: [standard()],

  adapters: [styleDictionary(), cloudflare(), supabase(), terraform()],

  model: {
    manifest: "src/domain/userActions.ts",
  },

  waivers: [
    {
      rule: "architecture/render-fresh",
      target: "architecture/deployment.mmd",
      reason: "Renderer not stable in CI yet.",
      owner: "jeremy",
      expires: "2026-06-01",
    },
  ],
});
```

## 13. Rule Taxonomy

Initial rule families:

```text
eac/setup
eac/agent
eac/product
eac/cucumber
eac/workflow
eac/xstate
eac/mermaid
eac/source-actions
eac/design
eac/environment
eac/deployment
eac/ci
eac/waivers
```

### 13.1 Mandatory kernel rules

These should apply to any configured EAC repo:

- config exists and parses
- enabled adapters can load
- rule ids are unique
- waivers have valid shape
- expired waivers fail
- waiver targets reference real rules/artifacts where possible
- no adapter reports invalid graph nodes

### 13.2 Standard pack rules

Enabled by the standard pack:

- agent context files exist
- product manifest schema valid
- capability/action ids valid and unique
- no orphan manifest entries
- Mermaid architecture files parse
- Cucumber feature/action tags align with manifest
- workflow model coverage valid for stateful workflows
- task/CI wiring invokes `eac check`

### 13.3 Adapter rules

Each adapter contributes its own strict rules once enabled.

Optional does not mean weak.

## 14. Diagnostics UX

Diagnostics must be excellent. Strictness only works if failures are clear.

Example output:

```text
EAC check failed with 3 errors.

error cucumber/action-coverage
  action "submit-login" requires BDD coverage but no scenario is tagged @action.submit-login
  manifest: src/domain/userActions.ts:103
  hint: add a scenario tagged @action.submit-login under a feature owned by capability auth-access

error mermaid/parse
  architecture/system.mmd is not valid Mermaid
  file: architecture/system.mmd:12
  hint: run eac doctor --adapter mermaid for parse details

error waiver/expired
  waiver for architecture/render-fresh expired on 2026-06-01
  file: eac.config.ts
  hint: remove the waiver or renew it with a new reason and expiry
```

Output formats:

- pretty terminal output
- JSON for CI/tooling
- maybe SARIF later

## 15. Non-Goals

V1 should not:

- replace project frameworks or build tools
- become a hosted service
- require every project to use every adapter
- hide project truth outside the repo
- build a large third-party ecosystem before the kernel is stable
- force XState onto trivial screens/routes
- enforce design/env/deploy rules unless the relevant adapter/profile is enabled
- create a giant app template as the main product

## 16. V1 Scope

V1 should be small but real.

Must ship:

- TypeScript CLI package
- `eac init`
- `eac doctor`
- `eac check`
- config loading
- adapter lifecycle
- rule engine
- diagnostics
- waivers
- standard first-party pack:
  - agents/context
  - product manifest
  - Cucumber
  - workflow/XState-compatible model
  - Mermaid
  - basic package/CI wiring

Must dogfood:

- extract the current `main-website` EAC pattern into reusable modules
- install/use EAC back in `main-website`
- install/use EAC in one second repo that is meaningfully different

## 17. Implementation Plan

### Phase 1: Repository scaffold

Create the package repo with:

```text
package.json
tsconfig.json
src/cli.ts
src/core/
src/adapters/
src/profiles/
tests/
PRD.md
```

Keep code minimal.

### Phase 2: Kernel

Implement:

- config loader
- adapter registration
- rule type
- diagnostic type
- waiver validation
- command runner
- file artifact helpers

### Phase 3: Standard pack skeleton

Implement first adapters as internal modules:

- agents adapter
- product manifest adapter
- cucumber adapter
- workflow adapter
- mermaid adapter
- package/CI adapter

### Phase 4: Extract from `main-website`

Turn current project-specific checks into generalized rules:

- action coverage
- model workflow coverage
- Mermaid architecture validation
- agent context existence
- package/CI wiring

### Phase 5: Dogfood in `main-website`

Replace repo-specific scripts where safe with `eac check`, or run EAC alongside them until equivalent.

### Phase 6: Second repo validation

Install into a different repo and verify that adoption takes less than one afternoon and improves safety.

### Phase 7: Optional adapters

Only after the standard pack proves useful:

- design/style-dictionary adapter
- env/dotenv adapter
- deploy/cloudflare/supabase/terraform adapters
- framework/vite/react adapter

## 18. Success Criteria

V1 is successful if:

- `eac init` can install a passing strict baseline in a repo
- `eac doctor` clearly explains missing setup without failing
- `eac check` fails reliably on contract drift
- the current `main-website` EAC prototype can be represented by the tool
- a second repo can adopt EAC meaningfully within one afternoon
- diagnostics are clear enough that an agent can fix most failures
- repo truth remains visible and source-controlled

## 19. Product Risks

### Risk: too abstract too early

Mitigation: extract from the real `main-website` prototype and dogfood immediately.

### Risk: adapter sprawl

Mitigation: build standard pack first, ecosystem later.

### Risk: strictness creates noise

Mitigation: excellent `init`, `doctor`, diagnostics, and explicit waivers.

### Risk: kernel becomes bloated

Mitigation: keep Cucumber/XState/Mermaid as first-party modules, not kernel internals.

### Risk: project truth becomes hidden

Mitigation: all important state lives in repo artifacts.

### Risk: tool competes with existing frameworks

Mitigation: EAC is a companion/meta-tool. Adapters integrate with frameworks; they do not replace them.

## 20. Open Questions

1. Final repo/package name?
   - Chosen repo path/name: `/home/jerry/Workspace/eac`, `JMLegere/eac`
   - Primary distribution target: mise-managed GitHub release asset, binary `eac`

2. Initial manifest file name?
   - `eac.model.ts`
   - `eac.manifest.ts`
   - configurable existing path such as `src/domain/userActions.ts`

3. Should Cucumber/XState/Mermaid be installed by default through `standard()` or enabled explicitly during `init`?
   - Current leaning: included in first-party standard pack, modular internally.

4. What is the first second-repo dogfood target?

5. What output formats are required in v1?
   - Pretty and JSON likely enough.
   - SARIF can come later.

6. How much should `eac init` modify package/CI files automatically?
   - Need safe merge/idempotence design.

## 21. One-Sentence Positioning

EAC is a minimal, plugin-driven Everything-as-Code framework that installs repo-owned project contracts and strictly checks them so humans, agents, and CI can trust what the repo says.
