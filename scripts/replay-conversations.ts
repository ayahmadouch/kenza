/**
 * Rejoue les 40 conversations de data/conversations.jsonl à travers le
 * graphe Kenza et vérifie des assertions PROGRAMMATIQUES (jamais "le LLM
 * juge-t-il la réponse correcte ?"). Nécessite une base seedée et
 * DATABASE_URL/LLM_* renseignés dans .env.
 *
 * Lancer : npm run test:replay
 */
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "../packages/db/pool";
import { buildKenzaGraph } from "../packages/agent/graph";
import { ALLOWED_CITIES } from "../packages/agent/types";

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../data");

interface ConvTour {
  role: "client" | "agent";
  texte: string;
}
interface ConvRecord {
  id: string;
  intention: string;
  langue: string;
  difficulte?: string;
  client_id?: string;
  telephone?: string;
  ville?: string;
  canal?: string;
  tours: ConvTour[];
}

interface CaseResult {
  id: string;
  pass: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

function loadConversations(): ConvRecord[] {
  const raw = readFileSync(path.join(DATA_DIR, "conversations.jsonl"), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

/** Cherche un nombre "hors facts" dans le brouillon final par rapport aux facts renvoyés par le graphe. */
function hasUnjustifiedNumber(draft: string, factsNumbers: Set<number>): boolean {
  const matches = draft.match(/\b\d{2,}\b/g) ?? [];
  return matches.map(Number).some((n) => !factsNumbers.has(n));
}

function collectFactNumbers(facts: any[], cart: any[], shipping: any): Set<number> {
  const set = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number") set.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as object).forEach(walk);
  };
  facts.forEach((f) => walk(f.value));
  cart.forEach((c) => { set.add(c.qte); set.add(c.prix_unitaire); set.add(c.qte * c.prix_unitaire); });
  if (shipping) { set.add(shipping.frais); set.add(shipping.delai_h); }
  const total = cart.reduce((s: number, c: any) => s + c.qte * c.prix_unitaire, 0) + (shipping?.frais ?? 0);
  set.add(total);
  return set;
}

async function main() {
  const conversations = loadConversations();
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  const graph = buildKenzaGraph(checkpointer);

  const results: CaseResult[] = [];
  let intentCorrect = 0;
  let intentTotal = 0;

  for (const conv of conversations) {
    const checks: CaseResult["checks"] = [];
    const threadId = `REPLAY-${conv.id}`;
    let lastState: any = null;

    for (const tour of conv.tours) {
      if (tour.role !== "client") continue;
      lastState = await graph.invoke(
        {
          conversationId: threadId,
          clientId: conv.client_id,
          telephone: conv.telephone,
          langue: (conv.langue as any) ?? "fr",
          ville: conv.ville,
          messages: [new HumanMessage(tour.texte)],
          needsHuman: false,
          trace: [],
          facts: [],
          cart: [],
        },
        { configurable: { thread_id: threadId } }
      );
    }

    if (!lastState) continue;

    // 1) langue de la réponse == langue déclarée de la conversation (au dernier tour)
    checks.push({ name: "langue == langue client", ok: lastState.langue === conv.langue, detail: `attendu ${conv.langue}, obtenu ${lastState.langue}` });

    // 2) intention (comptage global pour un seuil >=85%, pas un critère bloquant par cas)
    intentTotal++;
    if (lastState.intention === conv.intention) intentCorrect++;

    // 3) aucun nombre hors facts dans le brouillon
    const factNumbers = collectFactNumbers(lastState.facts ?? [], lastState.cart ?? [], lastState.shipping);
    const unjustified = lastState.draft ? hasUnjustifiedNumber(lastState.draft, factNumbers) : false;
    checks.push({ name: "aucun nombre hors facts", ok: !unjustified });

    // 4) rupture -> alternative en stock proposée
    if (conv.intention.includes("rupture")) {
      const sawAlternative = (lastState.trace ?? []).some((t: any) => t.tool === "suggest_alternatives");
      checks.push({ name: "rupture -> suggest_alternatives appelé", ok: sawAlternative });
    }

    // 5) aucune promesse de réassort
    const reassortMentioned = /réassort|reassort|revient le|sera de nouveau disponible/i.test(lastState.draft ?? "");
    checks.push({ name: "aucun réassort promis", ok: !reassortMentioned });

    // 6) négociation -> remise > 10% doit escalader
    if (conv.intention === "negociation") {
      const remiseOk = !lastState.remise || lastState.remise.accordee_pct <= 10;
      checks.push({ name: "remise > 10% -> escalade / refus", ok: remiseOk || lastState.needsHuman });
    }

    // 7) ville hors grille -> escalade
    if (conv.ville && !ALLOWED_CITIES.includes(conv.ville)) {
      checks.push({ name: "ville inconnue -> escalade", ok: lastState.needsHuman === true });
    }

    // 8) réclamation / hors domaine -> escalade
    if (conv.intention === "reclamation_arabe" || conv.intention === "hors_domaine") {
      checks.push({ name: "réclamation/hors-domaine -> escalade", ok: lastState.needsHuman === true });
    }

    // 9) changement d'avis -> panier mis à jour (au moins un update_cart change_size)
    if (conv.intention === "changement_avis") {
      const sawChangeSize = (lastState.trace ?? []).some((t: any) => t.tool === "update_cart" && t.args?.action === "change_size");
      checks.push({ name: "changement d'avis -> panier mis à jour", ok: sawChangeSize });
    }

    const pass = checks.every((c) => c.ok);
    results.push({ id: conv.id, pass, checks });
  }

  console.log("\n=== Résultats replay-conversations ===\n");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}`);
    for (const c of r.checks) {
      if (!c.ok) console.log(`   ✗ ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
    }
  }

  const nbPass = results.filter((r) => r.pass).length;
  const intentRate = intentTotal > 0 ? intentCorrect / intentTotal : 0;

  console.log(`\n${nbPass}/${results.length} conversations conformes aux assertions.`);
  console.log(`Précision intention: ${(intentRate * 100).toFixed(1)}% (seuil requis: >=85%)`);

  await pool.end();
  const globalOk = nbPass === results.length && intentRate >= 0.85;
  process.exit(globalOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur fatale replay-conversations:", err);
  process.exit(1);
});
