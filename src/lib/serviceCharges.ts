import { getDb, now } from "./db";
import type { AppConfig } from "./config";
import { mollakRateFor } from "./mollak";

export interface ZoneServiceChargeRow {
  community_slug: string;
  community_name: string;
  aed_per_sqft: number;
  updated_at: string;
}

/**
 * Estimaciones AED/sqft/año por comunidad (jul-2026, editables en /settings).
 * Son punto de partida: el dato real del edificio (Mollak) va en el override
 * por anuncio.
 */
const SEED: [slug: string, name: string, rate: number][] = [
  ["jumeirah-village-circle", "Jumeirah Village Circle", 12],
  ["jumeirah-village-triangle", "Jumeirah Village Triangle", 12],
  ["business-bay", "Business Bay", 18],
  ["dubai-marina", "Dubai Marina", 16],
  ["downtown-dubai", "Downtown Dubai", 20],
  ["international-city", "International City", 8],
  ["dubai-sports-city", "Dubai Sports City", 10],
  ["dubai-silicon-oasis", "Dubai Silicon Oasis", 10],
  ["al-furjan", "Al Furjan", 11],
  ["dubai-production-city", "Dubai Production City (IMPZ)", 10],
  ["jumeirah-lake-towers", "Jumeirah Lake Towers", 14],
  ["meydan-city", "Meydan City", 16],
  ["arjan", "Arjan", 12],
  ["dubai-south", "Dubai South", 9],
  ["town-square", "Town Square", 11],
  ["deira", "Deira", 9],
  ["palm-jumeirah", "Palm Jumeirah", 25],
  ["emaar-beachfront", "Emaar Beachfront", 22],
  ["dubai-hills-estate", "Dubai Hills Estate", 15],
  ["damac-hills-2", "Damac Hills 2", 9],
];

function seedZoneServiceCharges() {
  const db = getDb();
  const count = (db.prepare(`SELECT COUNT(*) n FROM zone_service_charges`).get() as { n: number }).n;
  if (count > 0) return;
  const ins = db.prepare(
    `INSERT INTO zone_service_charges (community_slug, community_name, aed_per_sqft, updated_at) VALUES (?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const [slug, name, rate] of SEED) ins.run(slug, name, rate, now());
  });
  tx();
}

export function listZoneServiceCharges(): ZoneServiceChargeRow[] {
  seedZoneServiceCharges();
  return getDb()
    .prepare(`SELECT * FROM zone_service_charges ORDER BY community_name COLLATE NOCASE`)
    .all() as ZoneServiceChargeRow[];
}

export function upsertZoneServiceCharge(slug: string, name: string, rate: number) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO zone_service_charges (community_slug, community_name, aed_per_sqft, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(slug.toLowerCase(), name, rate, now());
}

export function deleteZoneServiceCharge(slug: string) {
  getDb().prepare(`DELETE FROM zone_service_charges WHERE community_slug = ?`).run(slug);
}

/**
 * Fuente de la tasa aplicada. `label` es lo que se muestra en la ficha.
 * Prioridad: override manual → dato oficial Mollak del edificio (Dubai Pulse)
 * → estimación por zona → default global.
 */
export interface ResolvedServiceCharge {
  rate: number;
  source: "override" | "mollak" | "zona" | "default";
  label: string;
}

export function resolveServiceChargeRate(
  l: {
    service_charge_override: number | null;
    community_slug: string | null;
    community_name: string | null;
    tower_name: string | null;
  },
  cfg: AppConfig
): ResolvedServiceCharge {
  if (l.service_charge_override != null && l.service_charge_override > 0) {
    return { rate: l.service_charge_override, source: "override", label: "dato del edificio (manual)" };
  }
  const mollak = mollakRateFor(l.tower_name, l.community_name);
  if (mollak) {
    return {
      rate: mollak.rate,
      source: "mollak",
      label: `Mollak: ${mollak.building}, ${mollak.year}`,
    };
  }
  if (l.community_slug) {
    seedZoneServiceCharges();
    const row = getDb()
      .prepare(`SELECT aed_per_sqft FROM zone_service_charges WHERE community_slug = ?`)
      .get(l.community_slug.toLowerCase()) as { aed_per_sqft: number } | undefined;
    if (row) return { rate: row.aed_per_sqft, source: "zona", label: `estimación ${l.community_name ?? l.community_slug}` };
  }
  return { rate: cfg.service_charge_default, source: "default", label: "default global" };
}
