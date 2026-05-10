# Open Questions

- Should release automation target single-platform local publishing first, or GitHub Actions multi-platform assets immediately?
- What license should the public repository use?
- When should `eac.config.ts` become mandatory versus defaulting to the built-in agents/context adapter?
- Should `cucumber/bdd` eventually use a full Gherkin parser, or is the lightweight tag parser enough for v1?
- Should product workflow validation remain in `product/manifest`, or move into the upcoming workflow/XState adapter once that adapter exists?
