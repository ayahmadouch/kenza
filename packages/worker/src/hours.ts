/**
 * Horaires boutique : lundi → samedi, 10h → 20h, fuseau Africa/Casablanca.
 * Une relance qui tombe la nuit (ou le dimanche) est reportée au prochain créneau d'ouverture.
 */
const TZ = process.env.SHOP_TZ || "Africa/Casablanca";
const OPEN_HOUR = Number(process.env.SHOP_OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.SHOP_CLOSE_HOUR || 20);

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function localParts(date: Date): { weekday: string; hour: number; minute: number } {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute) };
}

/** Le seuil « demo » ne désactive PAS les horaires, sauf DEMO_IGNORE_SHOP_HOURS=1 (démo nocturne uniquement). */
export function isShopOpen(date: Date): boolean {
  if (process.env.DEMO_IGNORE_SHOP_HOURS === "1") return true;
  const { weekday, hour } = localParts(date);
  if (weekday === "Sun") return false;
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/** Prochain instant d'ouverture >= date (pas d'une minute, borné à 8 jours). */
export function nextOpeningFrom(date: Date): Date {
  const d = new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 60 && !isShopOpen(d); i++) d.setTime(d.getTime() + 60_000);
  return d;
}

/** 24 h par défaut ; DEMO_DELAY_MINUTES réduit uniquement ce seuil (logique métier inchangée). */
export function abandonedThresholdMs(): number {
  const demo = Number(process.env.DEMO_DELAY_MINUTES || 0);
  return demo > 0 ? demo * 60_000 : 24 * 60 * 60_000;
}
