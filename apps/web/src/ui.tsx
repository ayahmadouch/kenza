import { useEffect, useRef, useState, type ReactNode } from "react";

// ------------------------------------------------------------------ Khatam : l'étoile à 8 branches du zellige
/** Points d'une étoile {8/2} (deux carrés superposés) — le motif unique de l'interface. */
export function starPoints(cx: number, cy: number, R: number): string {
  const r = (R * Math.cos(Math.PI / 4)) / Math.cos(Math.PI / 8);
  return Array.from({ length: 16 }, (_, k) => {
    const a = (k * Math.PI) / 8 - Math.PI / 2;
    const rad = k % 2 === 0 ? R : r;
    return `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

export function Khatam({ size = 24, fill = "currentColor", stroke = "none", spin = false, className = "" }: { size?: number; fill?: string; stroke?: string; spin?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`${spin ? "khatam-spin" : ""} ${className}`} aria-hidden="true">
      <polygon points={starPoints(12, 12, 11.2)} fill={fill} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ Icônes (trait 1.7, 24 px)
const ICONS: Record<string, string> = {
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  people: "M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17.5v.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  hanger: "M12 7a2 2 0 1 0-2-2M12 7v2l9 6a1.5 1.5 0 0 1-.8 2.7H3.8A1.5 1.5 0 0 1 3 15l9-6",
  box: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3",
  image: "M4 5h16v14H4zM4 16l4.5-4.5L13 16l3-3 4 4M9 9.5v.01",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  plus: "M12 5v14M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6 6 18",
  stop: "M7 7h10v10H7z",
};
export function Icon({ name, size = 20 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

// ------------------------------------------------------------------ Couleurs du catalogue
const SWATCH: Record<string, string> = {
  beige: "#D9C4A0", "blanc cassé": "#F1ECE0", "bleu nuit": "#1B2550", bordeaux: "#6E1F2E", camel: "#B98550",
  "gris perle": "#C3C7CE", ivoire: "#F4EEDB", noir: "#17171B", terracotta: "#C2603F", "vert olive": "#6B7133",
};
export const swatch = (c?: string | null) => SWATCH[(c ?? "").toLowerCase()] ?? "#C9CDE0";

// ------------------------------------------------------------------ Nombres animés
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Counter({ value, format = (n: number) => Math.round(n).toLocaleString("fr-FR") }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

// ------------------------------------------------------------------ Anneau
export function Ring({ value, size = 132, label, children }: { value: number; size?: number; label: string; children?: ReactNode }) {
  const r = 52; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(1, value));
  return (
    <figure className="donut" style={{ width: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${label} : ${Math.round(v * 100)} %`}>
        <circle cx="60" cy="60" r={r} className="ring-track" />
        <circle cx="60" cy="60" r={r} className="ring-value" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 60 60)" />
        <text x="60" y="66" textAnchor="middle" className="ring-num">{Math.round(v * 100)} %</text>
      </svg>
      <figcaption>{label}</figcaption>
      {children}
    </figure>
  );
}

// ------------------------------------------------------------------ Texte révélé mot à mot (réponse fraîche de Kenza)
export function RevealText({ text, animate }: { text: string; animate: boolean }) {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(animate && !reduced() ? 0 : words.length);
  useEffect(() => {
    if (!animate || reduced()) { setN(words.length); return; }
    setN(0);
    const step = Math.max(14, Math.min(45, 1400 / words.length));
    const t = setInterval(() => setN((k) => { if (k >= words.length) { clearInterval(t); return k; } return k + 1; }), step);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);
  return <>{words.slice(0, n).join("")}</>;
}
