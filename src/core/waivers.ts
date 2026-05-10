import type { Diagnostic, Waiver } from "./types";

export function validateWaivers(waivers: Waiver[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [index, waiver] of waivers.entries()) {
    const target = waiver.target ?? `waiver:${index}`;

    if (!waiver.rule || !waiver.reason || !waiver.owner) {
      diagnostics.push({
        ruleId: "eac/waiver-shape",
        severity: "error",
        message: "waiver must include rule, reason, and owner",
        target,
        hint: "add the missing waiver fields or remove the waiver",
        source: "eac/kernel",
      });
    }

    if (waiver.expires) {
      const expiry = parseDateOnly(waiver.expires);
      if (!expiry) {
        diagnostics.push({
          ruleId: "eac/waiver-expiry",
          severity: "error",
          message: `waiver expiry is not a valid YYYY-MM-DD date: ${waiver.expires}`,
          target,
          hint: "use an ISO date like 2026-06-01",
          source: "eac/kernel",
        });
      } else if (expiry.getTime() < startOfToday().getTime()) {
        diagnostics.push({
          ruleId: "eac/waiver-expired",
          severity: "error",
          message: `waiver expired on ${waiver.expires}`,
          target,
          hint: "remove the waiver or renew it with a fresh reason and expiry",
          source: "eac/kernel",
        });
      }
    }
  }

  return diagnostics;
}

export function applyWaivers(diagnostics: Diagnostic[], waivers: Waiver[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.severity !== "error") return true;
    return !waivers.some((waiver) => matchesWaiver(diagnostic, waiver));
  });
}

function matchesWaiver(diagnostic: Diagnostic, waiver: Waiver): boolean {
  if (waiver.rule !== diagnostic.ruleId) return false;
  if (!waiver.target) return true;
  return waiver.target === diagnostic.target || waiver.target === diagnostic.path;
}

function parseDateOnly(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
