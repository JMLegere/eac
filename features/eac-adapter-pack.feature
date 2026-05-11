@capability.official-adapter-pack
Feature: Official EAC adapter pack
  EAC ships generalized public adapters that resolve through the registry and validate repo-owned contract evidence.

  @action.resolve-official-adapters
  Scenario: Resolve built-in adapter selections
    Given an EAC config names a built-in adapter id
    When the EAC runtime resolves configured adapters
    Then the adapter is loaded from the built-in registry
    And unknown adapter ids fail fast

  @action.validate-product-superbdd
  Scenario: Validate the product SuperBDD spine
    Given a product manifest and Cucumber feature evidence
    When product/superbdd runs
    Then it compiles Capability to Feature to Scenario to Step to Action evidence
    And it reports missing ownership or coverage diagnostics

  @action.validate-architecture-mermaid
  Scenario: Validate Mermaid architecture source files
    Given configured Mermaid architecture sources
    When architecture/mermaid runs
    Then the files are discovered and parsed
    And parse failures are reported as architecture diagnostics

  @action.validate-design-react
  Scenario: Validate React design-system contracts
    Given configured React design-system source paths
    When design/react runs
    Then token, registry, taxonomy, and usage-boundary evidence is checked
    And provider-specific rules remain configurable by project

  @action.validate-data-supabase
  Scenario: Validate static Supabase data contracts
    Given configured Supabase env, type, adapter, and migration paths
    When data/supabase runs
    Then static project evidence is checked without live provider access
    And generated tables and migrations contribute graph evidence

  @action.validate-infra-terraform
  Scenario: Validate Terraform infrastructure contracts
    Given configured Terraform source and script paths
    When infra/terraform runs
    Then providers, variables, resources, scripts, and ownership boundaries are checked statically
    And no live plan or apply is required

  @action.validate-deploy-cloudflare
  Scenario: Validate Cloudflare deployment contracts
    Given configured Wrangler, package, script, env, and workflow paths
    When deploy/cloudflare runs
    Then static deployment evidence is checked
    And no live Cloudflare deploy is required
