import { getDb } from "./db";
import type { AppConfig } from "./config";
import { mollakRateFor } from "./mollak";
import { CoolingType, parseCoolingType } from "./coolingTypes";

/**
 * Tipo de refrigeración del EDIFICIO. Determina quién paga el frío, que en
 * Dubái es un gasto real y variable:
 *
 * - `chiller_free`: el A/C va dentro del service charge (lo paga el
 *   propietario vía OA). El ocupante no recibe factura de chiller.
 * - `district`: Empower/Emicool/Tabreed factura aparte al ocupante, con
 *   capacity charge que se paga aunque el piso esté vacío.
 * - `dewa`: split propio, el consumo va en la factura de DEWA.
 * - null: desconocido. Se comporta como hoy (coste global de config).
 *
 * IMPORTANTE: la detección automática cubre muy poco. Verificado sobre los 558
 * anuncios reales: solo 5 mencionan "chiller free" y CERO mencionan proveedor
 * de district cooling. En la práctica esto es un campo manual con ayudas.
 */
export type { CoolingType } from "./coolingTypes";

export interface ResolvedCooling {
  type: CoolingType | null;
  /** De dónde salió: para que el usuario sepa cuánto fiarse. */
  source: string;
  monthly: number;
}

/**
 * Pista (débil) de Mollak: si la OA presupuesta el A/C por sqft, ese coste ya
 * está dentro del service charge y el ocupante no paga chiller aparte.
 *
 * Solo concluye en POSITIVO. La AUSENCIA de línea A/C no prueba nada: se
 * verificó que su presencia depende sobre todo de la GESTORA de la comunidad
 * (Emaar 87% y VCM 96% la reportan; Nakheel 2% y Edacom 0%, pese a gestionar
 * Discovery Gardens, Palm e International City, que sí tienen district cooling).
 */
export function mollakCoolingHint(towerName: string | null, communityName: string | null): boolean {
  const m = mollakRateFor(towerName, communityName);
  if (!m) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit FROM mollak_categories c
       JOIN mollak_service_charges s
         ON s.property_group_id = c.property_group_id AND s.budget_year = c.budget_year
       WHERE s.building_name = ? AND s.budget_year = ? AND c.category LIKE '%A/C%' AND c.cost > 0
       LIMIT 1`
    )
    .get(m.building, m.year) as { hit: number } | undefined;
  return !!row;
}

/**
 * "Chiller free" en la descripción. Se exige la palabra FREE pegada: hay dos
 * anuncios de la misma torre donde uno dice "Facilities included: - Chiller"
 * (incluido) y otro "- Chiller Free". "chiller" a secas no significa nada.
 */
const CHILLER_FREE_RE = /chiller[\s-]*free|free[\s-]*chiller/i;

/** Se agrega por TORRE: basta que un anuncio del edificio lo declare. */
function textCoolingHint(towerId: string | null, towerSlug: string | null): boolean {
  if (towerId == null && towerSlug == null) return false;
  const row = getDb()
    .prepare(
      `SELECT description FROM listings
       WHERE ((tower_id IS NOT NULL AND tower_id = ?) OR (tower_slug IS NOT NULL AND tower_slug = ?))
         AND description IS NOT NULL AND description != ''`
    )
    .all(towerId, towerSlug) as { description: string }[];
  return row.some((r) => CHILLER_FREE_RE.test(r.description));
}

export function resolveCooling(
  l: {
    cooling_type_override: string | null;
    tower_id: string | null;
    tower_slug: string | null;
    tower_name: string | null;
    community_name: string | null;
  },
  cfg: AppConfig
): ResolvedCooling {
  const monthlyFor = (t: CoolingType | null) => (t === "chiller_free" ? 0 : cfg.cooling_monthly);

  const override = parseCoolingType(l.cooling_type_override);
  if (override) return { type: override, source: "dato del edificio (manual)", monthly: monthlyFor(override) };

  if (textCoolingHint(l.tower_id, l.tower_slug)) {
    return { type: "chiller_free", source: "anuncio: “chiller free”", monthly: 0 };
  }
  if (mollakCoolingHint(l.tower_name, l.community_name)) {
    return { type: "chiller_free", source: "Mollak: el A/C va en el service charge", monthly: 0 };
  }
  return { type: null, source: "sin dato", monthly: cfg.cooling_monthly };
}
