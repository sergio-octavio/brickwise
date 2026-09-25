/**
 * Modelo ÚNICO de reforma, puro y sin React: lo consumen la ficha
 * (ReformScenario) y la métrica del mapa, para que no den números distintos
 * del mismo piso.
 *
 * La subida de renta depende del ALCANCE de la reforma (qué partidas haces),
 * no del dinero que teclees: cada partida captura una fracción del margen
 * mediana→P75. El coste solo mueve el payback. Así una reforma barata no
 * infla la rentabilidad.
 */

export const SIZE_TOLERANCE = 0.2;

export const REFORM_ITEMS = {
  mobiliario: { label: "Mobiliario", defaults: { comprado: 45, medida: 100 }, weights: { comprado: 0.4, medida: 0.5 } },
  suelo: { label: "Suelo", perSqft: 55, weight: 0.25 },
  paredes: { label: "Paredes (pintura y arreglos)", perSqft: 12, weight: 0.2 },
  techos: { label: "Techos (falso techo e iluminación)", perSqft: 20, weight: 0.1 },
} as const;

export type FurnitureType = "comprado" | "medida";

export interface ReformState {
  mobiliario: { on: boolean; tipo: FurnitureType; cost: number };
  suelo: { on: boolean; cost: number };
  paredes: { on: boolean; cost: number };
  techos: { on: boolean; cost: number };
}

export function defaultReformState(sizeSqft: number | null): ReformState {
  const s = sizeSqft ?? 500;
  return {
    mobiliario: { on: true, tipo: "comprado", cost: Math.round(s * REFORM_ITEMS.mobiliario.defaults.comprado) },
    suelo: { on: true, cost: Math.round(s * REFORM_ITEMS.suelo.perSqft) },
    paredes: { on: true, cost: Math.round(s * REFORM_ITEMS.paredes.perSqft) },
    techos: { on: false, cost: Math.round(s * REFORM_ITEMS.techos.perSqft) },
  };
}

/**
 * Muestras mínimas para hablar de margen de reforma. NO es configurable a
 * propósito: es un listón epistémico, no una preferencia. Con n=3 el P75
 * interpola entre el 2º y el 3er contrato — medio margen lo fija uno solo.
 */
export const REFORM_MIN_N = 6;

/** Payback bueno/malo en años, para la rampa de color del mapa. */
export const PAYBACK_GOOD_YEARS = 3;
export const PAYBACK_BAD_YEARS = 10;

export interface ReformResult {
  scope: number;
  totalCost: number;
  expectedRent: number;
  capturedUplift: number;
  postReformYield: number;
  paybackYears: number | null;
}

export function computeReform(i: {
  state: ReformState;
  price: number;
  medianRent: number;
  /** Margen total disponible: P75 − mediana. */
  upliftFull: number;
}): ReformResult {
  const w = {
    mobiliario: i.state.mobiliario.on ? REFORM_ITEMS.mobiliario.weights[i.state.mobiliario.tipo] : 0,
    suelo: i.state.suelo.on ? REFORM_ITEMS.suelo.weight : 0,
    paredes: i.state.paredes.on ? REFORM_ITEMS.paredes.weight : 0,
    techos: i.state.techos.on ? REFORM_ITEMS.techos.weight : 0,
  };
  const scope = Math.min(1, w.mobiliario + w.suelo + w.paredes + w.techos);
  const totalCost =
    (i.state.mobiliario.on ? i.state.mobiliario.cost : 0) +
    (i.state.suelo.on ? i.state.suelo.cost : 0) +
    (i.state.paredes.on ? i.state.paredes.cost : 0) +
    (i.state.techos.on ? i.state.techos.cost : 0);

  const expectedRent = i.medianRent + i.upliftFull * scope;
  const capturedUplift = expectedRent - i.medianRent;
  return {
    scope,
    totalCost,
    expectedRent,
    capturedUplift,
    postReformYield: expectedRent / (i.price + totalCost),
    paybackYears: capturedUplift > 0 && totalCost > 0 ? totalCost / capturedUplift : null,
  };
}

/**
 * Payback de la reforma ESTÁNDAR (mobiliario comprado + suelo + paredes,
 * techos fuera → scope 0,85) para un piso, usando el margen por sqft del
 * edificio reescalado a su superficie. Es lo que pinta el mapa.
 *
 * null = no hay muestra suficiente o el margen no cubre el coste nunca.
 */
export function standardPayback(
  sizeSqft: number | null,
  rentPsqftMedian: number | null,
  rentPsqftP75: number | null,
  n: number | null
): number | null {
  if (sizeSqft == null || sizeSqft <= 0) return null;
  if (rentPsqftMedian == null || rentPsqftP75 == null) return null;
  if (n == null || n < REFORM_MIN_N) return null;
  const state = defaultReformState(sizeSqft);
  const r = computeReform({
    state,
    price: 1, // irrelevante para el payback
    medianRent: rentPsqftMedian * sizeSqft,
    upliftFull: (rentPsqftP75 - rentPsqftMedian) * sizeSqft,
  });
  return r.paybackYears;
}
