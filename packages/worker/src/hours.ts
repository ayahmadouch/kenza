const OPEN_HOUR = Number(process.env.SHOP_OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.SHOP_CLOSE_HOUR || 20);

/** Boutique ouverte lundi (1) à samedi (6), 10h-20h. Dimanche (0) fermé. */
export function isShopOpen(date: Date): boolean {
  const day = date.getDay();
  const hour = date.getHours();
  if (day === 0) return false;
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/** Si `date` tombe hors horaires, reporte au prochain créneau d'ouverture (10h). */
export function nextOpeningFrom(date: Date): Date {
  const d = new Date(date);
  while (!isShopOpen(d)) {
    if (d.getDay() === 0 || d.getHours() >= 20) {
      d.setDate(d.getDate() + 1);
      d.setHours(OPEN_HOUR, 0, 0, 0);
    } else {
      d.setHours(OPEN_HOUR, 0, 0, 0);
    }
  }
  return d;
}

export function abandonedThresholdMs(): number {
  const demoMinutes = process.env.DEMO_DELAY_MINUTES ? Number(process.env.DEMO_DELAY_MINUTES) : null;
  if (demoMinutes && demoMinutes > 0) return demoMinutes * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
