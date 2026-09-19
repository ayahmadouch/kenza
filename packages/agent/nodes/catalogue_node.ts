import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { pool } from "../../db/pool";
import { DISCOUNT_MAX_PCT, MAX_TOOL_ROUNDS, POLICY } from "../config";
import { buildLlm, invokeLogged, llmConfigured } from "../llm";
import { analyzeMessage } from "../rules";
import { buildToolset, apply_discount, cartTotal, get_client_history, get_shipping_cost, loadCart, suggest_alternatives } from "../tools";
import type { CartItem, Fact, KenzaState, TraceEvent } from "../types";
import { ev, lastUserText, toChat } from "./util";

const SYSTEM = `Tu es le module "catalogue" de Kenza (agent commercial d'une boutique de prêt-à-porter marocaine).
Ton unique rôle : appeler les tools pour rassembler les données RÉELLES nécessaires à ce tour. Tu n'écris pas la réponse au client.
Règles :
- Ne fournis JAMAIS un prix, un total ou des frais : les tools les calculent.
- Une taille = une référence distincte. Client qui change de taille => update_cart(change_size), pas un nouvel ajout.
- Produit demandé => search_catalog / check_stock ; ajout au panier => update_cart(add) ; prix => get_price.
- Si un produit est en rupture, l'alternative est ajoutée automatiquement : n'invente rien.
- Ville de livraison connue et le client confirme + a choisi un paiement => create_order. Sans confirmation explicite, N'APPELLE PAS create_order.
- Information manquante (taille, ville, paiement) : n'appelle pas le tool, l'agent de conversation posera la question.
- Situation que tu ne sais pas traiter : appelle escalate.
Quand tu as assez de données, réponds sans tool call.`;

const j = (v: unknown): Record<string, any> => (v && typeof v === "object" ? (v as Record<string, any>) : {});

export async function catalogue_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const text = lastUserText(state.messages);
  const rules = analyzeMessage(text);
  const facts: Fact[] = [...state.facts];
  const trace: TraceEvent[] = [...state.trace];
  const tools = buildToolset({ conversationId: state.conversationId, clientId: state.clientId, telephone: state.telephone });

  let ville = state.ville;
  let shipping = state.shipping;
  let orderId = state.orderId;
  let remise = state.remise;
  let escalation = state.escalation;
  let escalationCode = state.escalationCode;
  let needsHuman = state.needsHuman;
  const seenStockZero = new Set<string>();
  const altDone = new Set<string>();

  const step = async <T>(tool: string, args: unknown, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const result = await fn();
    trace.push(ev("catalogue_node", { tool, args, result, latency_ms: Date.now() - t0 }));
    return result;
  };
  const escalateNow = (code: string, motif: string) => {
    if (needsHuman) return;
    needsHuman = true;
    escalationCode = code;
    escalation = { motif, contexte: "" };
  };

  // ---- 1) Étapes déterministes (indépendantes du LLM) ----------------------
  if (state.clientId || state.telephone) {
    const h = await step("get_client_history", { clientId: state.clientId }, () => get_client_history({ clientId: state.clientId, telephone: state.telephone }));
    if (h.trouve) facts.push({ type: "history", value: h, source: "db:clients+orders" });
  }

  const cartBefore = await loadCart(state.conversationId);
  if (ville && (rules.city?.kind === "grid" || cartBefore.length > 0)) {
    const s = await step("get_shipping_cost", { ville }, () => get_shipping_cost({ ville: ville! }));
    facts.push({ type: "shipping", value: s, source: "db:shipping_rates" });
    if (s.trouve) shipping = { ville: s.ville!, frais: s.frais_mad!, delai_h: s.delai_heures!, cod: s.cod, retrait: s.retrait };
    else escalateNow("ville_hors_grille", `Ville hors grille : ${ville}.`);
  }

  // Remise : demandée (%) ou implicite (« vous faites un geste ? ») => plafond appliqué en code.
  const asksDiscount = rules.discountPct !== null || state.intention === "negociation";
  if (asksDiscount) {
    const pct = rules.discountPct ?? DISCOUNT_MAX_PCT;
    const d = await step("apply_discount", { total: cartTotal(cartBefore), pct }, () => apply_discount({ total: cartTotal(cartBefore), pct }));
    facts.push({ type: "discount", value: d, source: `code:apply_discount (plafond ${DISCOUNT_MAX_PCT}%)` });
    if (d.autorise) {
      remise = { demandee_pct: pct, accordee_pct: d.pct_applique };
      await pool.query(`UPDATE conversations SET remise_pct = $2 WHERE id = $1`, [state.conversationId, d.pct_applique]);
    } else {
      remise = { demandee_pct: pct, accordee_pct: 0 };
      escalateNow("remise_hors_plancher", `Remise demandée (${pct}%) au-delà du plafond (${DISCOUNT_MAX_PCT}%).`);
    }
  }

  if (rules.policyTopics.length) {
    facts.push({
      type: "policy",
      value: { sujets: rules.policyTopics, retour_jours: POLICY.retour_jours, garantie_jours: POLICY.garantie_jours, ouverture_h: POLICY.ouverture_h, fermeture_h: POLICY.fermeture_h, jours: "lundi au samedi", retrait_villes: POLICY.retrait_villes, retrait_delai_h: POLICY.retrait_delai_h, regle_retour: "échange ou avoir, article non porté, étiquette en place ; remboursement en espèces = escalade", paiements: ["à la livraison (si la grille l'autorise)", "virement", "carte via lien"] },
      source: "data/politique-commerciale.md + faq-boutique.md",
    });
  }

  // ---- 2) Boucle de tool-calling LLM ---------------------------------------
  let llmDown = false;
  if (!needsHuman && llmConfigured()) {
    try {
      const llm = buildLlm().bindTools(tools as never);
      const ctx = `Contexte : client=${state.clientId ?? "inconnu"} ; ville=${ville ?? "inconnue"} ; panier=${JSON.stringify(cartBefore)} ; le client confirme la commande à ce tour : ${state.confirmation ? "OUI" : "NON"} ; intention=${state.intention}.`;
      const working: unknown[] = [{ role: "system", content: `${SYSTEM}\n${ctx}` }, ...toChat(state.messages, 12)];

      for (let round = 0; round < MAX_TOOL_ROUNDS && !needsHuman; round++) {
        const res = (await invokeLogged("catalogue", llm as never, working)) as AIMessage;
        working.push(res);
        const calls = res.tool_calls ?? [];
        if (calls.length === 0) break;

        for (const call of calls) {
          const tool = tools.find((t) => t.name === call.name);
          const args = call.args as Record<string, unknown>;
          let raw: string;

          if (call.name === "escalate") {
            escalateNow("incertitude", String(args.motif ?? "Situation non traitable par l'agent"));
            escalation = { motif: String(args.motif ?? escalation?.motif ?? ""), contexte: String(args.contexte ?? "") };
            trace.push(ev("catalogue_node", { tool: "escalate", args, decision: "escalade demandée (créée par escalation_node)" }));
            raw = JSON.stringify({ ok: true });
          } else if (call.name === "create_order" && !state.confirmation) {
            raw = JSON.stringify({ ok: false, motif: "confirmation_client_requise" });
            trace.push(ev("catalogue_node", { tool: "create_order", args, result: JSON.parse(raw), decision: "BLOQUÉ : pas de confirmation explicite du client" }));
          } else if (!tool) {
            raw = JSON.stringify({ ok: false, erreur: "tool_inconnu" });
          } else {
            const t0 = Date.now();
            try { raw = await tool.invoke(args); } catch (e) { raw = JSON.stringify({ ok: false, erreur: String(e).slice(0, 160) }); }
            trace.push(ev("catalogue_node", { tool: call.name, args, result: JSON.parse(raw), latency_ms: Date.now() - t0 }));
          }

          const result = j(JSON.parse(raw));
          absorb(call.name, args, result);
          working.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content: raw }));
        }
      }
    } catch {
      llmDown = true;
      trace.push(ev("catalogue_node", { decision: "LLM indisponible pendant le tool-calling : étapes déterministes conservées" }));
    }
  }

  function absorb(name: string, args: Record<string, unknown>, result: Record<string, any>) {
    const ref = (args.ref as string) ?? result.ref;
    switch (name) {
      case "get_price": if (result.trouve) facts.push({ type: "price", value: result, source: "db:products.prix_mad+promotions", ref }); break;
      case "check_stock":
        facts.push({ type: "stock", value: result, source: "db:products.stock", ref });
        if (result.trouve && result.ref && !result.disponible && !result.ambigu) seenStockZero.add(result.ref);
        if (result.trouve === false) escalateNow("hors_catalogue", "Produit demandé introuvable dans le catalogue.");
        break;
      case "search_catalog":
        for (const p of Array.isArray(result) ? result : []) facts.push({ type: "price", value: p, source: "db:products+promotions", ref: p.ref });
        break;
      case "suggest_alternatives":
        altDone.add(String(args.ref));
        for (const a of Array.isArray(result) ? result : []) facts.push({ type: "alternative", value: a, source: "db:products (stock>0)", ref: a.ref });
        break;
      case "get_shipping_cost":
        facts.push({ type: "shipping", value: result, source: "db:shipping_rates" });
        if (result.trouve) { shipping = { ville: result.ville, frais: result.frais_mad, delai_h: result.delai_heures, cod: result.cod, retrait: result.retrait }; ville = result.ville; }
        else escalateNow("ville_hors_grille", `Ville hors grille : ${String(args.ville)}.`);
        break;
      case "apply_discount":
        facts.push({ type: "discount", value: result, source: "code:apply_discount" });
        if (result.autorise) remise = { demandee_pct: result.pct_demande, accordee_pct: result.pct_applique };
        else escalateNow("remise_hors_plancher", `Remise demandée (${result.pct_demande}%) au-delà du plafond.`);
        break;
      case "update_cart":
        facts.push({ type: "cart", value: result, source: "db:conversations.cart" });
        if (result.motif === "rupture" && result.ref) seenStockZero.add(result.ref);
        break;
      case "create_order":
        if (result.ok) { orderId = result.commande_id; facts.push({ type: "order_total", value: result, source: "db:orders" }); }
        else facts.push({ type: "order_total", value: result, source: "db:orders (refus)" });
        break;
      default: break;
    }
  }

  // ---- 3) Rupture => alternative réelle GARANTIE par le code ----------------
  for (const ref of seenStockZero) {
    if (altDone.has(ref)) continue;
    const alts = await step("suggest_alternatives", { ref }, () => suggest_alternatives({ ref }));
    for (const a of alts) facts.push({ type: "alternative", value: a, source: "db:products (stock>0)", ref: a.ref });
    altDone.add(ref);
  }

  // ---- 4) Panier réel (source de vérité = DB) + totaux calculés par le code --
  const cart: CartItem[] = await loadCart(state.conversationId);
  if (cart.length) {
    const articles = cartTotal(cart);
    const { rows } = await pool.query(`SELECT remise_pct FROM conversations WHERE id = $1`, [state.conversationId]);
    const d = await apply_discount({ total: articles, pct: rows[0]?.remise_pct ?? 0 });
    const frais = shipping?.frais ?? null;
    facts.push({
      type: "totals",
      value: { total_articles_mad: articles, remise_pct: d.pct_applique, remise_mad: d.montant_remise, total_apres_remise_mad: d.total_apres_remise, frais_livraison_mad: frais, total_a_payer_mad: frais === null ? null : d.total_apres_remise + frais },
      source: "code:computeTotals(db.cart, remise, shipping_rates)",
    });
  }

  return {
    facts, cart, ville, shipping, remise, orderId, escalation, escalationCode, needsHuman,
    trace: [...trace, ev("catalogue_node", { decision: `${facts.length - state.facts.length} facts${llmDown ? " (LLM indisponible)" : ""}`, latency_ms: Date.now() - start })],
  };
}
