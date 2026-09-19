/**
 * Rejoue les 40 conversations de data/conversations.jsonl à travers le graphe Kenza RÉEL
 * (LLM + tools + PostgreSQL) et vérifie des assertions PROGRAMMATIQUES.
 * Le LLM n'est JAMAIS utilisé pour juger si un test passe.
 *
 * Prérequis : base seedée + LLM_* dans .env.   Lancer : npm run test:replay
 * Les effets de bord (commandes, stock, escalades, checkpoints) sont annulés en fin de run.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "../packages/db/pool";
import { buildKenzaGraph, TURN_RESET } from "../packages/agent/graph";
import { runGuardrail } from "../packages/agent/guardrails/guardrail";
import { analyzeMessage } from "../packages/agent/rules";
import { loadCart } from "../packages/agent/tools/cart";
import { DISCOUNT_MAX_PCT } from "../packages/agent/config";
import type { KenzaState } from "../packages/agent/types";

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../data");
const INTENT_MIN = 0.85;

interface ConvRecord { id: string; intention: string; langue: string; client_id?: string; telephone?: string; ville?: string; tours: { role: "client" | "agent"; texte: string }[] }
interface Turn { input: string; state: KenzaState }
interface Check { name: string; ok: boolean; detail?: string }

const REASSORT = /reassort|réassort|de nouveau disponible|sera disponible|revient le|ghadi yrj3|سيتوفر|سيعود/i;
const anyTurn = (turns: Turn[], p: (t: Turn) => boolean) => turns.some(p);

function assertions(conv: ConvRecord, turns: Turn[]): { checks: Check[]; intentHit: boolean } {
  const checks: Check[] = [];
  const first = turns[0]?.state;

  checks.push({ name: "langue détectée = langue client (1er message)", ok: first?.langue === conv.langue, detail: `attendu ${conv.langue}, obtenu ${first?.langue}` });

  const intentHit = anyTurn(turns, (t) => t.state.intention === conv.intention);

  // Aucun nombre hors facts, aucune promesse de réassort / remboursement, COD conforme : garde-fou rejoué sur chaque réponse finale.
  const bad = turns.map((t) => ({ t, g: t.state.needsHuman ? { ok: true, violations: [] as string[] } : runGuardrail(t.state) })).filter((x) => !x.g.ok);
  checks.push({ name: "aucun nombre/promesse hors facts (toutes les réponses)", ok: bad.length === 0, detail: bad.map((b) => b.g.violations.join("; ")).join(" | ") });
  checks.push({ name: "aucun réassort promis", ok: !anyTurn(turns, (t) => REASSORT.test(t.state.draft ?? "") && t.state.escalationCode !== "reassort_demande") });

  const alts = turns.flatMap((t) => t.state.facts.filter((f) => f.type === "alternative"));
  if (/rupture/.test(conv.intention)) {
    const calledAlt = anyTurn(turns, (t) => t.state.trace.some((e) => e.tool === "suggest_alternatives"));
    const escalatedReassort = anyTurn(turns, (t) => t.state.escalationCode === "reassort_demande");
    checks.push({ name: "rupture → alternative réelle en stock (ou escalade réassort)", ok: (calledAlt && alts.every((a) => (a.value as { stock?: number }).stock! > 0)) || escalatedReassort });
  }

  for (const [i, t] of turns.entries()) {
    const a = analyzeMessage(t.input);
    if (a.discountPct !== null && a.discountPct > DISCOUNT_MAX_PCT)
      checks.push({ name: `tour ${i + 1} : remise ${a.discountPct}% > ${DISCOUNT_MAX_PCT}% → escalade, aucune remise accordée`, ok: t.state.needsHuman && (t.state.remise?.accordee_pct ?? 0) === 0 });
    if (a.city?.kind === "unknown") checks.push({ name: `tour ${i + 1} : ville inconnue (${a.city.name}) → escalade`, ok: t.state.needsHuman && !/\d+\s*MAD/.test(t.state.draft ?? "") });
    if (a.escalation && ["facture_societe", "reclamation", "remboursement_especes", "reassort_demande"].includes(a.escalation.code))
      checks.push({ name: `tour ${i + 1} : ${a.escalation.code} → escalade`, ok: t.state.needsHuman && t.state.escalationCode === a.escalation.code });
  }
  if (conv.intention === "reclamation_arabe" || conv.intention === "hors_domaine")
    checks.push({ name: `${conv.intention} → escalade`, ok: anyTurn(turns, (t) => t.state.needsHuman) });
  if (conv.intention === "changement_avis")
    checks.push({ name: "changement d'avis → panier mis à jour (update_cart change_size)", ok: anyTurn(turns, (t) => t.state.trace.some((e) => e.tool === "update_cart" && (e.args as { action?: string })?.action === "change_size")) });
  return { checks, intentHit };
}

async function main() {
  const convs: ConvRecord[] = readFileSync(path.join(DATA_DIR, "conversations.jsonl"), "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const runId = Date.now().toString(36);
  const stockBefore = (await pool.query(`SELECT ref, stock FROM products`)).rows as { ref: string; stock: number }[];
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  const graph = buildKenzaGraph(checkpointer);

  const report: { id: string; pass: boolean; checks: Check[]; error?: string }[] = [];
  let intentHits = 0;

  for (const conv of convs) {
    const convId = `REPLAY-${conv.id}-${runId}`;
    await pool.query(`INSERT INTO conversations (id, client_id, telephone, canal, langue, ville, cart) VALUES ($1,$2,$3,'replay',$4,$5,'[]'::jsonb)`, [convId, conv.client_id ?? null, conv.telephone ?? null, conv.langue, conv.ville ?? null]);
    const config = { configurable: { thread_id: convId } };
    const turns: Turn[] = [];
    try {
      for (const tour of conv.tours.filter((t) => t.role === "client")) {
        await graph.invoke({ ...TURN_RESET, conversationId: convId, clientId: conv.client_id, telephone: conv.telephone, langue: conv.langue, ville: conv.ville, cart: await loadCart(convId), messages: [new HumanMessage(tour.texte)] } as never, config);
        turns.push({ input: tour.texte, state: (await graph.getState(config)).values as KenzaState });
      }
      const { checks, intentHit } = assertions(conv, turns);
      if (intentHit) intentHits++;
      report.push({ id: conv.id, pass: checks.every((c) => c.ok), checks });
    } catch (err) {
      report.push({ id: conv.id, pass: false, checks: [], error: String(err).slice(0, 300) });
    }
    const r = report[report.length - 1];
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${conv.id}  [${conv.intention}/${conv.langue}]`);
    for (const c of r.checks.filter((x) => !x.ok)) console.log(`   ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (r.error) console.log(`   ✗ exception : ${r.error}`);
  }

  // ---- annulation des effets de bord du replay
  await pool.query(`DELETE FROM order_items WHERE commande_id IN (SELECT commande_id FROM orders WHERE conversation_id LIKE 'REPLAY-%')`);
  await pool.query(`DELETE FROM orders WHERE conversation_id LIKE 'REPLAY-%'`);
  for (const s of stockBefore) await pool.query(`UPDATE products SET stock = $2 WHERE ref = $1 AND stock <> $2`, [s.ref, s.stock]);
  for (const table of ["escalations", "relances", "messages"]) await pool.query(`DELETE FROM ${table} WHERE conversation_id LIKE 'REPLAY-%'`);
  await pool.query(`DELETE FROM conversations WHERE id LIKE 'REPLAY-%'`);
  for (const table of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"]) await pool.query(`DELETE FROM ${table} WHERE thread_id LIKE 'REPLAY-%'`).catch(() => undefined);

  const passed = report.filter((r) => r.pass).length;
  const intentRate = intentHits / convs.length;
  console.log(`\n${passed}/${report.length} conversations conformes aux assertions.`);
  console.log(`Précision d'intention : ${(intentRate * 100).toFixed(1)} % (seuil ${INTENT_MIN * 100} %)`);
  writeFileSync(path.resolve(__dirname, "../replay-report.json"), JSON.stringify({ passed, total: report.length, intentRate, report }, null, 2));
  await pool.end();
  process.exit(passed === report.length && intentRate >= INTENT_MIN ? 0 : 1);
}

main().catch((e) => { console.error("Erreur fatale replay :", e); process.exit(1); });
