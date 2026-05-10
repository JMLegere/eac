@capability.eac-kernel
Feature: EAC kernel command loop
  The CLI turns repo-owned contracts into advisory diagnostics, strict checks, and safe initialization.

  @action.run-init
  Scenario: Init creates missing safe artifacts without overwriting existing files
    Given a repo has EAC adapters enabled
    When a developer runs eac init
    Then missing repo-owned artifacts are scaffolded
    And existing artifacts are skipped unless --force is provided

  @action.run-doctor
  Scenario: Doctor reports adoption status without failing the workflow
    Given a repo has EAC adapters enabled
    When a developer runs eac doctor
    Then advisory diagnostics explain missing setup or drift
    And the command exits successfully for ordinary findings

  @action.run-check
  Scenario: Check fails on unwaived contract drift
    Given a repo has EAC adapters enabled
    When a developer runs eac check
    Then every enabled strict rule is evaluated
    And unwaived errors fail the command
    And valid waivers suppress only their matching diagnostics
