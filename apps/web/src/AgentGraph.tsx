import type { GuardrailVerdict, TraceEvent } from "./api";
import { Khatam, Icon } from "./ui";

interface NodeDef { id: string; label: string; hint: string; tech: string }
const FLOW: NodeDef[] = [
  { id: "multimodal", label: "Écoute", hint: "texte, note vocale ou photo", tech: "multimodal_node" },
  { id: "intent", label: "Comprend", hint: "langue et intention du client", tech: "intent_node" },
  { id: "catalogue", label: "Consulte", hint: "catalogue, stock, livraison, panier", tech: "catalogue_node" },
  { id: "conversation", label: "Rédige", hint: "uniquement à partir de faits vérifiés", tech: "conversation_node" },
  { id: "guardrail", label: "Vérifie", hint: "chaque chiffre doit avoir une source", tech: "guardrail_node" },
  { id: "respond", label: "Répond", hint: "envoi au client et mémorisation", tech: "respond_node" },
];
const ESCALATION: NodeDef = { id: "escalation", label: "Passe la main", hint: "le commerçant reprend avec le contexte complet", tech: "escalation_node" };

const idOf = (node: string) => node.replace(/_node$/, "");
const short = (v: unknown, max = 700) => { const s = JSON.stringify(v, null, 1) ?? ""; return s.length > max ? `${s.slice(0, max)}…` : s; };

type Status = "done" | "active" | "idle" | "skipped";

interface Props {
  /** Trace d'un message terminé (source : PostgreSQL). */
  trace?: TraceEvent[] | null;
  guardrail?: GuardrailVerdict | null;
  latency?: number | null;
  /** Nœuds terminés en direct pendant un tour (événements WebSocket). */
  live?: string[];
  running?: boolean;
}

/** Le graphe LangGraph, rendu en direct : chaque étoile s'allume quand le nœud correspondant vient réellement de s'exécuter. */
export default function AgentGraph({ trace, guardrail, latency, live = [], running = false }: Props) {
  const events = trace ?? [];
  const visited = new Set<string>(running ? live : events.map((e) => idOf(e.node)));
  const escalated = visited.has("escalation");
  const nodes = escalated ? [...FLOW.filter((n) => n.id !== "respond"), ESCALATION] : FLOW;
  const finished = visited.has("respond") || escalated;

  const lastIdx = Math.max(-1, ...nodes.map((n, i) => (visited.has(n.id) ? i : -1)));
  const statusOf = (n: NodeDef, i: number): Status => {
    if (visited.has(n.id)) return "done";
    if (running && !finished && i === lastIdx + 1) return "active";
    if (!running && (trace?.length ?? 0) > 0) return "skipped";
    return "idle";
  };

  const tools = events.filter((e) => e.tool).length;
  if (!running && events.length === 0)
    return (
      <div className="graph-empty">
        <Khatam size={44} fill="var(--trait)" />
        <p>Envoyez un message : les étapes de Kenza s'allumeront ici, une par une, avec les outils réellement appelés.</p>
      </div>
    );

  return (
    <div className="graph">
      {!running && (
        <div className="graph-summary">
          {guardrail && <span className={`seal ${guardrail.ok ? "seal-ok" : "seal-ko"}`}><Icon name={guardrail.ok ? "check" : "close"} size={14} />{guardrail.ok ? "Chiffres vérifiés" : "Réponse bloquée"}</span>}
          {latency != null && <span className="chip">{(latency / 1000).toFixed(1)} s</span>}
          <span className="chip">{tools} outil{tools > 1 ? "s" : ""}</span>
        </div>
      )}
      <ol className="flow">
        {nodes.map((n, i) => {
          const st = statusOf(n, i);
          const mine = events.filter((e) => idOf(e.node) === n.id);
          const decision = mine.find((e) => e.decision)?.decision;
          const kind = n.id === "escalation" ? "esc" : st;
          return (
            <li key={n.id} className={`flow-node is-${kind}`}>
              <span className="flow-star">
                <Khatam size={30} fill={st === "done" ? (n.id === "escalation" ? "var(--corail)" : "var(--jade)") : st === "active" ? "var(--safran)" : "transparent"} stroke={st === "idle" || st === "skipped" ? "var(--trait)" : "none"} spin={st === "active"} />
                {st === "done" && <span className="flow-tick"><Icon name={n.id === "escalation" ? "alert" : "check"} size={13} /></span>}
              </span>
              <div className="flow-body">
                <div className="flow-title"><b>{n.label}</b><code>{n.tech}</code></div>
                <div className="flow-hint">{st === "skipped" ? "Non nécessaire pour ce message" : decision ?? n.hint}</div>
                {mine.filter((e) => e.tool).map((e, k) => (
                  <details key={k} className="tool-call">
                    <summary><code>{e.tool}()</code>{e.latency_ms != null && <span>{e.latency_ms} ms</span>}</summary>
                    {e.args !== undefined && <pre>{short(e.args)}</pre>}
                    {e.result !== undefined && <pre>{short(e.result)}</pre>}
                  </details>
                ))}
                {n.id === "guardrail" && guardrail && !guardrail.ok && <div className="violations">{guardrail.violations.map((v, k) => <div key={k}>{v}</div>)}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
