// Shared yield → color scale used by both the map pins and the list badge.
// ≤6% red (mediocre) → 10%+ turquoise (espectacular); 8–9% around green (bueno).
export const YIELD_LOW = 0.06;
export const YIELD_HIGH = 0.1;

// La neta corre ~2 puntos por debajo de la bruta: misma escala, desplazada.
export const NET_YIELD_LOW = 0.04;
export const NET_YIELD_HIGH = 0.08;

/**
 * Payback de reforma → color. Menos años = mejor, así que se niega para
 * reutilizar la misma rampa (rojo→turquesa) del resto del mapa.
 * null = la reforma no se paga nunca → rojo pleno.
 */
export function paybackColor(years: number | null, good = 3, bad = 10): string {
  if (years == null) return "hsl(0, 66%, 44%)";
  return yieldColor(-years, -bad, -good);
}

export function yieldColor(y: number | null, low = YIELD_LOW, high = YIELD_HIGH): string {
  if (y == null) return "#8a8a8a";
  const t = Math.min(1, Math.max(0, (y - low) / (high - low)));
  const hue = t * 174; // 0° red → 174° turquoise
  return `hsl(${Math.round(hue)}, 66%, 44%)`;
}
