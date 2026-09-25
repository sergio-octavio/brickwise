/**
 * Señal de precio vs mercado: ¿pides por encima o por debajo de lo que se ha
 * pagado por unidades comparables?
 *
 * Escala DIVERGENTE centrada en 0 — no vale `yieldColor`, que es monótona
 * (rojo→turquesa): aquí el 0 es lo neutro y ambos extremos son informativos.
 */

export interface PriceOpts {
  /** Prima a partir de la cual se considera sobreprecio (fracción). */
  premiumBad: number;
  /** Descuento a partir del cual se considera chollo (fracción). */
  discountGood: number;
  /** Ventas comparables mínimas para emitir veredicto. */
  minN: number;
}

export const DEFAULT_PRICE_OPTS: PriceOpts = {
  premiumBad: 0.1,
  discountGood: 0.1,
  minN: 5,
};

export type PriceVerdict = "chollo" | "en-precio" | "caro";

/**
 * Diferencias mayores que esto casi nunca son un chollo (ni un atraco) real:
 * suelen significar que los comparables mezclan lanzamientos off-plan,
 * apartamentos de hotel o tipos de unidad distintos dentro de la misma torre.
 * Verificado sobre la cartera real: solo el 3% de los anuncios los supera.
 */
export const PRICE_EXTREME = 0.35;

export function isPriceOutlier(x: number | null): boolean {
  return x != null && Math.abs(x) > PRICE_EXTREME;
}

/** null = muestra insuficiente: "no lo sé" NO es lo mismo que "está en precio". */
export function priceVerdict(x: number | null, n: number | null, o: PriceOpts): PriceVerdict | null {
  if (x == null || n == null || n < o.minN) return null;
  if (x >= o.premiumBad) return "caro";
  if (x <= -o.discountGood) return "chollo";
  return "en-precio";
}

/** Gris neutro en 0 → verde bajo mercado → rojo sobre mercado. */
export function priceSignalColor(x: number | null, o: PriceOpts = DEFAULT_PRICE_OPTS): string {
  if (x == null) return "#8a8a8a";
  // Los extremos van en ámbar: no son chollos, son datos a revisar.
  if (isPriceOutlier(x)) return "#b45309";
  const band = Math.max(o.premiumBad, o.discountGood) * 1.5;
  const t = Math.max(-1, Math.min(1, x / band));
  const hue = t <= 0 ? 152 : 0; // verde (barato) / rojo (caro)
  const sat = 12 + Math.abs(t) * 54;
  const light = 46 - Math.abs(t) * 4;
  return `hsl(${hue}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

/** "▲ 9%" si pides de más, "▼ 12%" si pides de menos; "⚠" si es sospechoso. */
export function priceSignalText(x: number | null): string {
  if (x == null) return "—";
  const pct = Math.abs(x * 100);
  return `${isPriceOutlier(x) ? "⚠ " : ""}${x >= 0 ? "▲" : "▼"} ${pct.toFixed(0)}%`;
}

export const OUTLIER_HELP =
  "Diferencia demasiado grande para ser real: revisa las ventas comparables antes de creértela. " +
  "Suele significar que la torre mezcla lanzamientos off-plan, apartamentos de hotel o tipos de unidad " +
  "muy distintos, no que hayas encontrado un chollo.";
