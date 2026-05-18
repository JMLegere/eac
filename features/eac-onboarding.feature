@capability.eac-onboarding
Feature: EAC SuperBDD onboarding
  EAC installs SuperBDD as an adapter bundle, scaffolds starter artifacts separately, and refuses to pass placeholders as product truth.

  @action.add-product-superbdd
  Scenario: Add SuperBDD to a clean repository
    Given a repository without EAC configuration
    When the developer runs eac add product/superbdd
    Then eac.config.ts enables product/superbdd
    And product/manifest.ts is not created by add
    And features/repo-contract.feature is not created by add

  @action.check-repo-contract
  Scenario: Check fails before enabled artifacts are initialized
    Given product/superbdd is enabled in eac.config.ts
    And product/manifest.ts is missing
    When the developer runs eac check
    Then the command fails with product/manifest-file-required

  @action.init-enabled-adapters
  Scenario: Initialize starter artifacts for enabled adapters
    Given product/superbdd is enabled in eac.config.ts
    When the developer runs eac init
    Then product/manifest.ts is created
    And features/repo-contract.feature is created
    And existing files are skipped unless force is requested

  @action.reject-starter-placeholders
  Scenario: Reject generated starter placeholders
    Given product/manifest.ts still contains eacStarter markers
    When the developer runs eac check
    Then the command fails with product/starter-placeholder

  @action.explain-superbdd-doctor
  Scenario: Explain the SuperBDD model after install
    Given product/superbdd is enabled in eac.config.ts
    When the developer runs eac doctor
    Then the command explains capabilities, features, scenarios, steps, actions, and workflows
    And it recommends advisory doctor and strict check scripts
