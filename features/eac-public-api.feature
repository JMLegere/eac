@capability.public-api
Feature: Public adapter and configuration API
  EAC exposes official adapters and option types so external projects can configure the contract compiler without depending on private modules.

  @action.export-public-api
  Scenario: Export official public adapter surface
    Given an external consumer imports from the EAC package entrypoint
    When the consumer requests official adapters or option types
    Then src/index.ts exports the built-in adapters
    And src/index.ts exports the public option types for configurable adapters

  @action.load-adapter-options
  Scenario: Route configuration namespaces to adapter options
    Given eac.config.ts declares top-level adapter option namespaces
    When the EAC runtime creates adapter contexts
    Then product options are visible to product/manifest and product/superbdd
    And cucumber options are visible to cucumber/bdd and product/superbdd
    And architecture, design, data, infra, and deploy options route to their matching adapters
