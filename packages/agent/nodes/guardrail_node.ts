import type { KenzaState } from "../types";
import { runGuardrail } from "../guardrails/guardrail";
import { ev } from "./util";

export async function guardrail_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const result = runGuardrail(state);
  const retries = (state.guardrail?.retries ?? 0) + (result.ok ? 0 : 1);
  const exhausted = !result.ok && retries > 1;
  return {
    guardrail: { ok: result.ok, violations: result.violations, retries },
    ...(exhausted
      ? { needsHuman: true, escalationCode: "guardrail_echec", escalation: { motif: `Garde-fou : ${result.violations.join(" | ")}`, contexte: "" } }
      : {}),
    trace: [...state.trace, ev("guardrail_node", { decision: result.ok ? "PASS" : `FAIL (essai ${retries}) : ${result.violations.join(" | ")}`, result: { ok: result.ok, violations: result.violations }, latency_ms: Date.now() - start })],
  };
}

/** valide -> respond ; invalide 1re fois -> retry conversation ; invalide encore -> escalade. */
export function routeAfterGuardrail(state: KenzaState): "valid" | "retry" | "escalate" {
  if (state.guardrail?.ok) return "valid";
  return (state.guardrail?.retries ?? 0) <= 1 ? "retry" : "escalate";
}
