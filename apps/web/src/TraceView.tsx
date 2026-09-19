import type { GuardrailVerdict, TraceEvent } from "./api";

const NODE_LABEL: Record<string, string> = {
  multimodal_node: "Multimodal", intent_node: "Intention", catalogue_node: "Catalogue", conversation_node: "Conversation",
  guardrail_node: "Garde-fou", escalation_node: "Escalade", respond_node: "Réponse", relance_node: "Relance", api: "API",
};
const NODE_CLASS: Record<string, string> = {
  multimodal_node: "n-blue", intent_node: "n-violet", catalogue_node: "n-green", conversation_node: "n-teal", guardrail_node: "n-amber",
  escalation_node: "n-red", respond_node: "n-lime", relance_node: "n-blue", api: "n-red",
};

const short = (v: unknown, max = 900) => { const s = JSON.stringify(v, null, 1) ?? ""; return s.length > max ? `${s.slice(0, max)}…` : s; };

/** Trace STRUCTURÉE et observable : nœud, tool, arguments, résultat, décision, latence. Jamais de chain-of-thought. */
export default function TraceView({ trace, guardrail, latency }: { trace?: TraceEvent[] | null; guardrail?: GuardrailVerdict | null; latency?: number | null }) {
  if (!trace || trace.length === 0) return <div className="muted small">Aucune trace pour ce message.</div>;
  return (
    <div className="trace">
      <div className="trace-summary">
        {guardrail && <span className={`chip ${guardrail.ok ? "chip-good" : "chip-warn"}`}>Garde-fou : {guardrail.ok ? "PASS" : "FAIL"}</span>}
        {latency != null && <span className="chip">{(latency / 1000).toFixed(1)} s</span>}
        <span className="chip">{trace.filter((t) => t.tool).length} appel(s) d'outil</span>
      </div>
      <ol className="trace-list">
        {trace.map((t, i) => (
          <li key={i} className="trace-item">
            <div className="trace-head">
              <span className={`node-pill ${NODE_CLASS[t.node] ?? "n-blue"}`}>{NODE_LABEL[t.node] ?? t.node}</span>
              {t.tool && <code className="tool-name">{t.tool}()</code>}
              {t.latency_ms != null && <span className="muted tiny">{t.latency_ms} ms</span>}
            </div>
            {t.decision && <div className="trace-decision">{t.decision}</div>}
            {(t.args !== undefined || t.result !== undefined) && (
              <details className="trace-details">
                <summary>arguments / résultat</summary>
                {t.args !== undefined && <pre>args {short(t.args)}</pre>}
                {t.result !== undefined && <pre>→ {short(t.result)}</pre>}
              </details>
            )}
          </li>
        ))}
      </ol>
      {guardrail && !guardrail.ok && <div className="trace-violations">{guardrail.violations.map((v, i) => <div key={i}>⚠ {v}</div>)}</div>}
    </div>
  );
}
