import type { KenzaState } from "../types";
import { runGuardrail } from "../guardrails/guardrail";

export async function guardrail_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const result = runGuardrail(state);
  const retries = (state.guardrail?.retries ?? 0) + (result.ok ? 0 : 1);

  return {
    guardrail: { ok: result.ok, violations: result.violations, retries },
    trace: [
      ...state.trace,
      {
        node: "guardrail_node",
        ts: new Date().toISOString(),
        decision: result.ok ? "PASS" : `FAIL (retry ${retries}): ${result.violations.join(" | ")}`,
        latency_ms: Date.now() - start,
      },
    ],
  };
}

/** Après guardrail: valide -> fin ; invalide et pas encore retry -> retry ; invalide après retry -> escalade. */
export function routeAfterGuardrail(state: KenzaState): "valid" | "retry" | "escalate" {
  if (state.guardrail?.ok) return "valid";
  if ((state.guardrail?.retries ?? 0) <= 1) return "retry";
  return "escalate";
}
