import assert from "node:assert";
import { isShopOpen, nextOpeningFrom, abandonedThresholdMs } from "./hours";
import { chooseVariant } from "../../agent/nodes/relance_node";

let ok = 0, ko = 0;
const t = (n: string, f: () => void) => { try { f(); ok++; console.log("  ✓ " + n); } catch (e) { ko++; console.log("  ✗ " + n + "\n    " + (e as Error).message); } };

// Africa/Casablanca est en UTC+1 toute l'année (hors Ramadan) : dates de septembre => UTC+1.
t("mardi 15h locale : ouvert", () => assert.ok(isShopOpen(new Date("2026-09-15T14:00:00Z"))));
t("mardi 22h locale : fermé", () => assert.ok(!isShopOpen(new Date("2026-09-15T21:00:00Z"))));
t("mardi 09h locale : fermé", () => assert.ok(!isShopOpen(new Date("2026-09-15T08:00:00Z"))));
t("dimanche 15h : fermé", () => assert.ok(!isShopOpen(new Date("2026-09-20T14:00:00Z"))));
t("samedi 15h : ouvert", () => assert.ok(isShopOpen(new Date("2026-09-19T14:00:00Z"))));
t("relance de nuit reportée au lendemain 10h locale", () => {
  const d = nextOpeningFrom(new Date("2026-09-15T21:30:00Z"));
  assert.strictEqual(d.toISOString(), "2026-09-16T09:00:00.000Z");
});
t("relance du samedi soir reportée au lundi 10h locale", () => {
  const d = nextOpeningFrom(new Date("2026-09-19T20:00:00Z"));
  assert.strictEqual(d.toISOString(), "2026-09-21T09:00:00.000Z");
});
t("seuil 24 h par défaut, 1 min en démo", () => {
  delete process.env.DEMO_DELAY_MINUTES;
  assert.strictEqual(abandonedThresholdMs(), 86_400_000);
  process.env.DEMO_DELAY_MINUTES = "1";
  assert.strictEqual(abandonedThresholdMs(), 60_000);
});
t("A/B déterministe et réparti", () => {
  assert.strictEqual(chooseVariant("conv-1"), chooseVariant("conv-1"));
  const set = new Set(Array.from({ length: 40 }, (_, i) => chooseVariant(`conv-${i}`)));
  assert.strictEqual(set.size, 2);
});
console.log(`\n${ok} passés, ${ko} échoués.`);
process.exit(ko ? 1 : 0);
