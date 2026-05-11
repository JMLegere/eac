@capability.release-distribution
Feature: Release distribution
  EAC produces versioned release assets that can be installed as a CLI tool.

  @action.package-release
  Scenario: Package a versioned release asset
    Given package metadata declares a SemVer version
    When the maintainer runs the release packaging script
    Then the compiled EAC binary is archived with the package version
    And a sha256 checksum is written for the archive
    And package/tag consistency is enforced as release hygiene
