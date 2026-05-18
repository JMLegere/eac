import type { Diagnostic } from "./types";

export function printDiagnostics(
  diagnostics: Diagnostic[],
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({ diagnostics }, null, 2));
    return;
  }

  if (diagnostics.length === 0) {
    console.log("EAC: no diagnostics");
    return;
  }

  for (const diagnostic of diagnostics) {
    console.log(`${diagnostic.severity} ${diagnostic.ruleId}`);
    console.log(`  ${diagnostic.message}`);
    if (diagnostic.path) console.log(`  file: ${diagnostic.path}`);
    if (diagnostic.location?.line) {
      const column = diagnostic.location.column
        ? `:${diagnostic.location.column}`
        : "";
      console.log(`  location: ${diagnostic.location.line}${column}`);
    }
    if (diagnostic.target) console.log(`  target: ${diagnostic.target}`);
    if (diagnostic.hint) console.log(`  hint: ${diagnostic.hint}`);
    for (const detail of diagnostic.details ?? []) console.log(`  - ${detail}`);
    console.log(`  source: ${diagnostic.source}`);
    console.log("");
  }
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
