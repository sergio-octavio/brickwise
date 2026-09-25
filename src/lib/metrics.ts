import { NET_YIELD_HIGH, NET_YIELD_LOW, paybackColor, yieldColor } from "./yieldColor";
import { REFORM_MIN_N, standardPayback } from "./reform";
import {
  DEFAULT_PRICE_OPTS,
  PriceOpts,
  priceSignalColor,
  priceSignalText,
  priceVerdict,
} from "./priceSignal";

/** Métrica elegible para pines del mapa y tarjetas del pipeline. */
export type PinMetric = "bruta" | "neta" | "coc" | "vsmediana" | "reforma" | "sqft" | "psqft" | "ficha";

export const PIN_METRICS: { id: PinMetric; label: string }[] = [
  { id: "neta", label: "Neta" },
  { id: "bruta", label: "Bruta" },
  { id: "coc", label: "CoC" },
  { id: "vsmediana", label: "vs mediana" },
  { id: "reforma", label: "Reforma" },
  { id: "sqft", label: "Tamaño" },
  { id: "psqft", label: "AED/sqft" },
  { id: "ficha", label: "Ficha" },
];

/** "310,000" → "310K"; "1,250,000" → "1.25M". Para los pines compactos. */
export function kFmt(n: number | null): string {
  if (n == null) return "—";
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "M" : Math.round(n / 1000) + "K";
}

/** Campos de un listing analizado que las métricas necesitan leer. */
export interface MetricRow {
  asking_yield: number | null;
  net_yield: number | null;
  cash_on_cash: number | null;
  size_sqft: number | null;
  price_per_sqft: number | null;
  price_vs_median: number | null;
  sale_psqft_n: number | null;
  rent_psqft_median: number | null;
  rent_psqft_p75: number | null;
  rent_psqft_n: number | null;
}

export interface PinData {
  /** Valor para ordenar lista y apilar pines (mayor = mejor = encima). */
  v: number | null;
  text: string;
  color: string;
}

/** Valor, etiqueta y color según la métrica elegida. */
export function pinData(r: MetricRow, metric: PinMetric, priceOpts: PriceOpts = DEFAULT_PRICE_OPTS): PinData {
  const pct = (x: number | null) => (x != null ? (x * 100).toFixed(1) + "%" : "—");
  switch (metric) {
    case "reforma": {
      // Con muestra corta NO se pinta un número: se dice cuántos datos hay.
      if ((r.rent_psqft_n ?? 0) < REFORM_MIN_N) {
        return { v: null, text: `n=${r.rent_psqft_n ?? 0}`, color: "#8a8a8a" };
      }
      const years = standardPayback(r.size_sqft, r.rent_psqft_median, r.rent_psqft_p75, r.rent_psqft_n);
      // Menos años = mejor: se niega para que lo rentable quede arriba.
      return {
        v: years != null ? -years : null,
        text: years != null ? `${years.toFixed(0)} años` : "no paga",
        color: paybackColor(years),
      };
    }
    case "vsmediana": {
      // Sin muestra suficiente NO se inventa un número: "no lo sé" ≠ "en precio".
      if (priceVerdict(r.price_vs_median, r.sale_psqft_n, priceOpts) == null) {
        return { v: null, text: `n=${r.sale_psqft_n ?? 0}`, color: "#8a8a8a" };
      }
      // Pedir menos = mejor: se niega para que lo barato quede arriba.
      return {
        v: -(r.price_vs_median as number),
        text: priceSignalText(r.price_vs_median),
        color: priceSignalColor(r.price_vs_median, priceOpts),
      };
    }
    case "bruta":
      return { v: r.asking_yield, text: pct(r.asking_yield), color: yieldColor(r.asking_yield) };
    case "neta":
    case "ficha":
      return { v: r.net_yield, text: pct(r.net_yield), color: yieldColor(r.net_yield, NET_YIELD_LOW, NET_YIELD_HIGH) };
    case "coc":
      return { v: r.cash_on_cash, text: pct(r.cash_on_cash), color: yieldColor(r.cash_on_cash, 0.04, 0.1) };
    case "sqft":
      return {
        v: r.size_sqft,
        text: r.size_sqft != null ? `${Math.round(r.size_sqft)} sqft` : "—",
        color: "#4f46e5",
      };
    case "psqft":
      // Menor AED/sqft = mejor: se niega el valor para que orden y apilado
      // pongan lo más barato por sqft arriba.
      return {
        v: r.price_per_sqft != null ? -r.price_per_sqft : null,
        text: r.price_per_sqft != null ? `${Math.round(r.price_per_sqft)}/sqft` : "—",
        color: "#0e7490",
      };
  }
}
