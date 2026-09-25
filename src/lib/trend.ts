import { TxRow } from "./pf/transactions";

// Same ±20% "comparable" window the yield sample and the AED/sqft chart use.
const SIZE_TOLERANCE = 0.2;
const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

// Suavizado: ancho de banda del kernel acotado a [45, 180] días y ~48 puntos
// de curva. Con mucho volumen la curva sigue de cerca a las transacciones;
// con poco, promedia un entorno más ancho.
const H_MIN = 45 * DAY_MS;
const H_MAX = 180 * DAY_MS;
const GRID_N = 48;

export interface TrendResult {
  /** Trend value (AED/sqft) at the most recent transaction date — the current fair price. */
  currentPsqft: number;
  /** Annual drift of the trend, as a fraction (e.g. 0.08 = +8 %/yr). */
  annualPct: number | null;
  /** Number of comparable points the fit used. */
  n: number;
  /** Smoothed curve (kernel-weighted moving average) for the chart. */
  curve: { t: number; y: number }[];
}

/**
 * Kernel-weighted moving average (Nadaraya-Watson) of AED/sqft over time for a
 * building's transactions, fitted on comparable units (similar size ±20%,
 * bedrooms fallback) — the exact curve drawn by PsqftChart. Not a straight
 * line: each curve point is the mean of nearby transactions weighted by a
 * gaussian on time distance, so periods with more volume pull the curve
 * harder and thin periods get smoothed. `currentPsqft` is the curve at the
 * latest date, i.e. what a comparable unit is worth per sqft right now.
 */
export function psqftTrend(
  rows: TxRow[],
  listingSizeSqft: number | null,
  listingBedrooms: number | null
): TrendResult | null {
  const pts = rows
    .filter((r) => r.size_sqft && r.size_sqft > 0 && r.amount > 0 && r.date)
    .map((r) => ({
      t: Date.parse(r.date),
      y: r.amount / (r.size_sqft as number),
      comparable:
        listingSizeSqft != null
          ? Math.abs((r.size_sqft as number) - listingSizeSqft) / listingSizeSqft <= SIZE_TOLERANCE
          : listingBedrooms != null && r.bedrooms === listingBedrooms,
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;

  const comp = pts.filter((p) => p.comparable);
  const fitSet = comp.length >= 2 ? comp : pts;
  const tMin = fitSet[0].t;
  const tMax = fitSet[fitSet.length - 1].t;
  if (fitSet.length < 2 || tMax <= tMin) return null;

  const span = tMax - tMin;
  const h = Math.min(H_MAX, Math.max(H_MIN, span / 6));
  const estimate = (t: number) => {
    let sw = 0;
    let swy = 0;
    for (const p of fitSet) {
      const w = Math.exp(-0.5 * ((t - p.t) / h) ** 2);
      sw += w;
      swy += w * p.y;
    }
    return sw > 0 ? swy / sw : NaN;
  };

  const curve: { t: number; y: number }[] = [];
  for (let i = 0; i < GRID_N; i++) {
    const t = tMin + (span * i) / (GRID_N - 1);
    curve.push({ t, y: estimate(t) });
  }
  const currentPsqft = curve[curve.length - 1].y;

  // Deriva anualizada de la propia curva: ahora vs hace un año (o el inicio
  // del histórico si es más corto). Con menos de ~9 meses no es fiable.
  let annualPct: number | null = null;
  if (span >= 270 * DAY_MS) {
    const tPrev = Math.max(tMin, tMax - YEAR_MS);
    const prev = estimate(tPrev);
    if (prev > 0 && tMax > tPrev) {
      annualPct = (currentPsqft / prev - 1) * (YEAR_MS / (tMax - tPrev));
    }
  }

  return { currentPsqft, annualPct, n: fitSet.length, curve };
}

/**
 * Discount of the asking price vs the current trend, as a fraction: positive when
 * the listing is cheaper than the trend (a discount), negative when it's above it.
 */
export function discountVsTrend(
  trend: TrendResult | null,
  askingPsqft: number | null
): number | null {
  if (!trend || askingPsqft == null || trend.currentPsqft <= 0) return null;
  return (trend.currentPsqft - askingPsqft) / trend.currentPsqft;
}
