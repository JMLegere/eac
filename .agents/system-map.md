# System Map

Current bootstrap slice:

```text
repo root
  -> eac CLI
    -> command parser
      -> agents/context adapter
        -> declares .agents artifacts
        -> init creates missing files
        -> doctor emits advisory diagnostics
        -> check emits strict diagnostics
```

Target kernel composition:

```text
source-of-truth config
  -> adapter registry
    -> artifact registry / repo graph
      -> rule engine
        -> diagnostics
          -> waiver filter
            -> command reporter
```

Distribution path:

```text
TypeScript source
  -> Bun compiled binary
    -> GitHub release asset
      -> mise github backend
        -> eac on PATH
```
