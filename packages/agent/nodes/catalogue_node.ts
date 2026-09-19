import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { KenzaState, Fact } from "../types";
import { buildLlm } from "../llm";
import { buildToolset } from "../tools";

const MAX_TOOL_ROUNDS = 4;

const SYSTEM = `Tu es le module "catalogue" de Kenza. Ton unique rôle est d'appeler les tools
nécessaires (search_catalog, check_stock, suggest_alternatives, get_price, get_shipping_cost,
apply_discount, update_cart, create_order, get_client_history, escalate) pour rassembler les
données réelles dont l'agent a besoin pour répondre à ce tour de conversation. Tu n'écris pas la
réponse finale au client : appelle les tools pertinents puis arrête-toi. N'invente jamais une
donnée : si une information manque (ville, taille, référence), n'appelle pas le tool concerné
et laisse l'agent de conversation demander une clarification.`;

/**
 * Boucle de tool-calling : le LLM choisit les tools à appeler, les tools
 * s'exécutent réellement (PostgreSQL), et chaque résultat devient un
 * `fact` traçable consommé ensuite par conversation_node/guardrail_node.
 */
export async function catalogue_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const tools = buildToolset(state.conversationId);
  const llm = buildLlm({ temperature: 0 }).bindTools(tools);

  const facts: Fact[] = [...state.facts];
  const trace = [...state.trace];
  let cart = state.cart;
  let shipping = state.shipping;
  let orderId = state.orderId;
  let escalation = state.escalation;
  let needsHuman = state.needsHuman;

  let working = [...state.messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = (await llm.invoke([{ role: "system", content: SYSTEM }, ...working])) as AIMessage;
    working = [...working, res];

    const calls = res.tool_calls ?? [];
    if (calls.length === 0) break;

    for (const call of calls) {
      const toolFn = tools.find((t) => t.name === call.name);
      if (!toolFn) continue;
      const toolStart = Date.now();
      let resultRaw: string;
      try {
        resultRaw = (await toolFn.invoke(call.args as never)) as string;
      } catch (err) {
        resultRaw = JSON.stringify({ error: String(err) });
      }
      const result = safeParse(resultRaw);

      trace.push({
        node: "catalogue_node",
        ts: new Date().toISOString(),
        tool: call.name,
        args: call.args,
        result,
        latency_ms: Date.now() - toolStart,
      });

      facts.push(...toolResultToFacts(call.name, call.args as Record<string, unknown>, result));

      if (call.name === "update_cart" && result?.cart) cart = result.cart;
      if (call.name === "get_shipping_cost" && result?.trouve) {
        shipping = { frais: result.frais_mad, delai_h: result.delai_heures, cod: result.cod, retrait: result.retrait };
      }
      if (call.name === "create_order" && result?.ok) orderId = result.commande_id;
      if (call.name === "escalate") {
        needsHuman = true;
        escalation = { motif: (call.args as { motif?: string })?.motif ?? "inconnu", contexte: (call.args as { contexte?: string })?.contexte ?? "" };
      }

      working.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content: resultRaw }));
    }
  }

  return {
    facts,
    cart,
    shipping,
    orderId,
    escalation,
    needsHuman,
    trace: [...trace, { node: "catalogue_node", ts: new Date().toISOString(), decision: `${facts.length - state.facts.length} nouveaux facts`, latency_ms: Date.now() - start }],
  };
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function toolResultToFacts(name: string, args: Record<string, unknown>, result: any): Fact[] {
  const ref = (args?.ref as string) || (result?.ref as string) || undefined;
  switch (name) {
    case "get_price":
      return result?.trouve ? [{ type: "price", value: result, source: "db:products.prix_mad+promotions", ref }] : [];
    case "check_stock":
      return result ? [{ type: "stock", value: result, source: "db:products.stock", ref: result.ref ?? ref }] : [];
    case "get_shipping_cost":
      return [{ type: "shipping", value: result, source: "db:shipping_rates" }];
    case "apply_discount":
      return [{ type: "discount", value: result, source: "code:apply_discount (plancher 10%)" }];
    case "search_catalog":
      return (Array.isArray(result) ? result : []).map((p: any) => ({ type: "price", value: p, source: "db:products", ref: p.ref }));
    case "create_order":
      return result?.ok ? [{ type: "order_total", value: result, source: "db:orders" }] : [];
    default:
      return [];
  }
}
