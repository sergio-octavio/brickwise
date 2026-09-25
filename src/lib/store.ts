/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "crypto";
import { getDb, now } from "./db";
import { buildAgentJson } from "./agent";
import type { PipelineStatus } from "./pipeline";
import {
  AnalysisRow,
  ListingRow,
  PfProperty,
  ReplacementCandidate,
  ReplacementInfo,
  YieldResult,
} from "./types";
import { AppreciationResult, EMPTY_FINANCE, FinanceResult, ResidencePlanResult, StrResult } from "./finance";
import type { ReformBasis } from "./yield";

function sizeSqft(p: PfProperty): number | null {
  const s: any = p.size;
  if (s == null) return null;
  if (typeof s === "number") return s;
  const parsed = parseFloat(String(s.value ?? s));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Coerce PF values that may come as number, numeric string, {value} or {price} object. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as { value?: unknown; price?: unknown };
    return toNum(o.value ?? o.price);
  }
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Search pages: images is an array; detail pages: {property: [...]} with other size keys. */
function normalizeImages(p: PfProperty): { small: string; medium: string }[] {
  const raw: any = p.images;
  const arr: any[] = Array.isArray(raw) ? raw : raw?.property || [];
  return arr
    .map((i) => ({ small: i.small || i.thumbnail || i.medium || "", medium: i.medium || i.full || i.small || "" }))
    .filter((i) => i.medium);
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).toLowerCase();
  if (s === "studio") return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** The tower node (or deepest location) the transactions history is keyed on. */
function towerNode(p: PfProperty) {
  const tree = p.location_tree;
  if (tree?.length) {
    const tower = [...tree].reverse().find((l) => l.type === "TOWER");
    return tower || tree[tree.length - 1];
  }
  return p.location;
}

/** The community node (zone) — keys service charges and STR market data. */
function communityNode(p: PfProperty) {
  return p.location_tree?.find((l) => l.type === "COMMUNITY") ?? null;
}

/** PF completion_status ("off_plan_primary", "completed"…) → "offplan" | "ready". */
function completionStatus(p: PfProperty): string | null {
  const cs = p.completion_status;
  if (!cs) return null;
  return cs.includes("off_plan") ? "offplan" : cs.includes("completed") ? "ready" : null;
}

/**
 * Subtipo de venta de PF: "_primary" = venta nueva directa del developer
 * (new sale / new project, precio de lista con payment plan); sin sufijo =
 * resale (reventa, en off-plan suele llevar ya prima de mercado).
 */
function saleType(p: PfProperty): string | null {
  const cs = p.completion_status;
  if (!cs) return null;
  return cs.includes("_primary") ? "primary" : "resale";
}

export function upsertListing(p: PfProperty, citySlug = "dubai"): ListingRow {
  const db = getDb();
  const tower = towerNode(p);
  const community = communityNode(p);
  const size = sizeSqft(p);
  const price = p.price?.value ?? 0;
  const ts = now();
  // The statement below is INSERT OR REPLACE: any user-edited column (finance
  // flags) or richer previously-scraped data must be carried over explicitly.
  const existing = db
    .prepare(
      `SELECT first_seen_at, amenities_json, description, images_json, agent_json,
              community_slug, community_name, service_charge_override, dld_waiver, second_home,
              completion_status, handover_date, sale_type, listed_date, cooling_type_override,
              unavailable_at, availability_checked_at
       FROM listings WHERE id = ?`
    )
    .get(p.id) as
    | {
        first_seen_at: string;
        amenities_json: string;
        description: string | null;
        images_json: string;
        agent_json: string;
        community_slug: string | null;
        community_name: string | null;
        service_charge_override: number | null;
        dld_waiver: number;
        second_home: number | null;
        completion_status: string | null;
        handover_date: string | null;
        sale_type: string | null;
        listed_date: string | null;
        cooling_type_override: string | null;
        unavailable_at: string | null;
        availability_checked_at: string | null;
      }
    | undefined;
  const amenities = p.amenity_names?.length
    ? JSON.stringify(p.amenity_names)
    : existing?.amenities_json ?? "[]";
  // Search cards only carry ~3 images; never let them clobber a richer detail-page set.
  let images = normalizeImages(p);
  if (existing) {
    try {
      const prev = JSON.parse(existing.images_json);
      if (Array.isArray(prev) && prev.length > images.length) images = prev;
    } catch {}
  }

  db.prepare(
    `INSERT OR REPLACE INTO listings
     (id, url, title, price, size_sqft, bedrooms, bathrooms, property_type, tower_id, tower_slug, tower_name,
      city_slug, lat, lon, images_json, amenities_json, agent_json, price_per_sqft, description, first_seen_at, last_scraped_at,
      community_slug, community_name, service_charge_override, dld_waiver, second_home, completion_status, handover_date, sale_type, listed_date,
      cooling_type_override, unavailable_at, availability_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(p.id),
    p.share_url || `https://www.propertyfinder.ae${p.details_path || ""}`,
    p.title || "",
    price,
    size,
    toInt(p.bedrooms),
    toInt(p.bathrooms),
    p.property_type || "",
    tower?.id != null ? String(tower.id) : null,
    tower?.slug ?? null,
    tower?.name ?? null,
    citySlug,
    toNum(p.location?.coordinates?.lat),
    toNum(p.location?.coordinates?.lon),
    JSON.stringify(images),
    amenities,
    buildAgentJson(p, existing?.agent_json),
    toNum(p.price_per_area) ?? (size && price ? price / size : null),
    p.description ?? existing?.description ?? null,
    existing?.first_seen_at ?? ts,
    ts,
    community?.slug ?? existing?.community_slug ?? null,
    community?.name ?? existing?.community_name ?? null,
    existing?.service_charge_override ?? null,
    existing?.dld_waiver ?? 0,
    existing?.second_home ?? null,
    completionStatus(p) ?? existing?.completion_status ?? null,
    // La fecha de entrega solo viene en el detalle; las tarjetas de búsqueda no
    // deben borrarla.
    p.project?.delivery_date ?? existing?.handover_date ?? null,
    saleType(p) ?? existing?.sale_type ?? null,
    p.listed_date ?? existing?.listed_date ?? null,
    existing?.cooling_type_override ?? null,
    // La disponibilidad la escribe setListingAvailability tras leer isAvailable
    // de la página; un re-scrape no puede borrar la marca de retirado.
    existing?.unavailable_at ?? null,
    existing?.availability_checked_at ?? null
  );
  return getListing(p.id)!;
}

/**
 * Off-plan comparables para estimar revalorización: anuncios off-plan
 * guardados en la misma comunidad, o a menos de `radiusM` metros si la
 * comunidad no coincide/falta.
 */
export interface OffplanComp {
  price_per_sqft: number;
  handover_date: string | null;
  size_sqft: number | null;
  sale_type: string | null;
  listed_date: string | null;
}

export function offplanNeighbors(
  l: { id: string; community_slug: string | null; lat: number | null; lon: number | null },
  radiusM = 3000
): OffplanComp[] {
  const rows = getDb()
    .prepare(
      `SELECT id, price_per_sqft, handover_date, community_slug, lat, lon, size_sqft, sale_type, listed_date
       FROM listings
       WHERE completion_status = 'offplan' AND price_per_sqft IS NOT NULL AND id != ?`
    )
    .all(l.id) as ({
    id: string;
    community_slug: string | null;
    lat: number | null;
    lon: number | null;
  } & OffplanComp)[];
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  return rows.filter((o) => {
    if (l.community_slug && o.community_slug && o.community_slug === l.community_slug) return true;
    if (l.lat == null || l.lon == null || o.lat == null || o.lon == null) return false;
    const dLat = toRad(o.lat - l.lat);
    const dLon = toRad(o.lon - l.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(l.lat)) * Math.cos(toRad(o.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a)) <= radiusM;
  });
}

/**
 * Campos financieros editables por anuncio (sobreviven al re-scrape).
 * El service charge es una propiedad del EDIFICIO (Mollak), no del anuncio:
 * al fijarlo se propaga a todos los listings de la misma torre. DLD waiver y
 * 2ª vivienda sí son del trato concreto y quedan solo en este anuncio.
 * Devuelve los ids afectados (para recomputarlos).
 */
/** Escribe una columna de EDIFICIO en todos los anuncios de la misma torre. */
function setTowerScoped(
  col: "service_charge_override" | "cooling_type_override",
  id: string,
  value: unknown,
  affected: Set<string>
) {
  const db = getDb();
  const l = getListing(id);
  if (l?.tower_id != null || l?.tower_slug != null) {
    const rows = db
      .prepare(
        `UPDATE listings SET ${col} = ?
         WHERE (tower_id IS NOT NULL AND tower_id = ?) OR (tower_slug IS NOT NULL AND tower_slug = ?)
         RETURNING id`
      )
      .all(value, l.tower_id, l.tower_slug) as { id: string }[];
    for (const r of rows) affected.add(r.id);
  } else {
    db.prepare(`UPDATE listings SET ${col} = ? WHERE id = ?`).run(value, id);
  }
}

export function setListingFinanceFlags(
  id: string,
  f: {
    service_charge_override?: number | null;
    dld_waiver?: boolean;
    second_home?: boolean | null;
    cooling_type_override?: string | null;
  }
): string[] {
  const db = getDb();
  const affected = new Set<string>([id]);
  if (f.service_charge_override !== undefined) {
    setTowerScoped("service_charge_override", id, f.service_charge_override, affected);
  }
  if (f.cooling_type_override !== undefined) {
    setTowerScoped("cooling_type_override", id, f.cooling_type_override, affected);
  }
  if (f.dld_waiver !== undefined) {
    db.prepare(`UPDATE listings SET dld_waiver = ? WHERE id = ?`).run(f.dld_waiver ? 1 : 0, id);
  }
  if (f.second_home !== undefined) {
    db.prepare(`UPDATE listings SET second_home = ? WHERE id = ?`).run(
      f.second_home == null ? null : f.second_home ? 1 : 0,
      id
    );
  }
  return [...affected];
}

/**
 * Resolve the community for listings scraped before community_slug existed,
 * via the locations table: the tower's dotted path ("1.86.1198.4328") has the
 * community id at index 1. Returns how many listings were backfilled.
 */
export function backfillCommunities(): number {
  const db = getDb();
  const pending = db
    .prepare(`SELECT id, tower_id FROM listings WHERE community_slug IS NULL AND tower_id IS NOT NULL`)
    .all() as { id: string; tower_id: string }[];
  if (!pending.length) return 0;
  const locByExactId = db.prepare(`SELECT path, slug, name FROM locations WHERE id = ?`);
  const upd = db.prepare(`UPDATE listings SET community_slug = ?, community_name = ? WHERE id = ?`);
  let updated = 0;
  for (const l of pending) {
    const tower = locByExactId.get(l.tower_id) as { path: string } | undefined;
    const communityId = tower?.path?.split(".")[1];
    if (!communityId) continue;
    const community = locByExactId.get(communityId) as { slug: string; name: string } | undefined;
    if (!community?.name) continue;
    const slug =
      community.slug ||
      community.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
    upd.run(slug, community.name, l.id);
    updated++;
  }
  return updated;
}

export function getListing(id: string): ListingRow | null {
  return (getDb().prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as ListingRow) ?? null;
}

// --- Disponibilidad en PF + búsqueda de recambio ---------------------------

/**
 * Registra el resultado de comprobar si el anuncio sigue publicado.
 * `unavailable_at` guarda la PRIMERA detección de retirada (las comprobaciones
 * siguientes no la pisan, para saber desde cuándo está caído) y vuelve a NULL
 * si el anuncio reaparece.
 */
export function setListingAvailability(id: string, available: boolean) {
  const ts = now();
  getDb()
    .prepare(
      `UPDATE listings
       SET availability_checked_at = ?,
           unavailable_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(unavailable_at, ?) END
       WHERE id = ?`
    )
    .run(ts, available ? 1 : 0, ts, id);
}

export function saveReplacement(
  listingId: string,
  r: { search_url: string; scope: string; found_n: number; candidates: ReplacementCandidate[] }
): ReplacementInfo {
  const searched_at = now();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO listing_replacements
       (listing_id, search_url, scope, found_n, candidates_json, searched_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(listingId, r.search_url, r.scope, r.found_n, JSON.stringify(r.candidates), searched_at);
  return { ...r, searched_at };
}

function parseReplacement(row: ReplacementRow | undefined): ReplacementInfo | null {
  if (!row) return null;
  let candidates: ReplacementCandidate[] = [];
  try {
    candidates = JSON.parse(row.candidates_json);
  } catch {}
  return {
    search_url: row.search_url,
    scope: row.scope,
    found_n: row.found_n,
    candidates,
    searched_at: row.searched_at,
  };
}

interface ReplacementRow {
  search_url: string;
  scope: string;
  found_n: number;
  candidates_json: string;
  searched_at: string;
}

export function getReplacement(listingId: string): ReplacementInfo | null {
  return parseReplacement(
    getDb().prepare(`SELECT * FROM listing_replacements WHERE listing_id = ?`).get(listingId) as
      | ReplacementRow
      | undefined
  );
}

/** Recambios de todos los anuncios retirados, para servirlos junto a la lista. */
export function replacementsByListing(): Map<string, ReplacementInfo> {
  const rows = getDb().prepare(`SELECT * FROM listing_replacements`).all() as (ReplacementRow & {
    listing_id: string;
  })[];
  const m = new Map<string, ReplacementInfo>();
  for (const r of rows) {
    const info = parseReplacement(r);
    if (info) m.set(r.listing_id, info);
  }
  return m;
}

export function clearReplacement(listingId: string) {
  getDb().prepare(`DELETE FROM listing_replacements WHERE listing_id = ?`).run(listingId);
}

export function saveAnalysis(
  listingId: string,
  y: YieldResult,
  gym: { gym_name: string | null; distance_m: number | null },
  fin: FinanceResult = EMPTY_FINANCE,
  str: StrResult | null = null,
  app: AppreciationResult | null = null,
  live: ResidencePlanResult | null = null,
  trend: { trend_psqft: number | null; discount_vs_trend: number | null } | null = null,
  cooling: { type: string | null; source: string; monthly: number } | null = null,
  basis: ReformBasis | null = null
) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO analyses
       (listing_id, gross_yield, asking_yield, median_rent, median_sale_price,
        rent_p25, rent_p75, sale_p25, sale_p75,
        rent_n, buy_n, gym_distance_m, gym_name, computed_at,
        service_charge_rate, service_charge_source, service_charges_annual, net_yield,
        loan_amount, monthly_payment, cash_upfront, cash_on_cash, dbr_ok,
        str_slug, str_annual_revenue_aed, str_vs_rent, str_hybrid_income_aed, str_pct_mortgage_covered,
        offplan_n, offplan_psqft, offplan_handover, future_psqft, appreciation_pct_yr,
        appreciation_pct_yr_bear, resale_premium, resale_dom_days, offplan_primary_psqft, offplan_resale_psqft,
        live_monthly_cost, live_monthly_delta, months_to_next, str_breakeven_adr,
        median_sale_psqft, sale_psqft_n, price_vs_median, price_vs_median_basis,
        trend_psqft, discount_vs_trend,
        cooling_type, cooling_source, cooling_monthly_applied,
        rent_psqft_p25, rent_psqft_median, rent_psqft_p75, rent_psqft_n, rent_basis_months)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      listingId,
      y.gross_yield,
      y.asking_yield,
      y.median_rent,
      y.median_sale_price,
      y.rent_p25,
      y.rent_p75,
      y.sale_p25,
      y.sale_p75,
      y.rent_n,
      y.buy_n,
      gym.distance_m,
      gym.gym_name,
      now(),
      fin.service_charge_rate,
      fin.service_charge_source ?? null,
      fin.service_charges_annual,
      fin.net_yield,
      fin.loan_amount,
      fin.monthly_payment,
      fin.cash_upfront,
      fin.cash_on_cash,
      fin.dbr_ok == null ? null : fin.dbr_ok ? 1 : 0,
      str?.str_slug ?? null,
      str?.str_annual_revenue_aed ?? null,
      str?.str_vs_rent ?? null,
      str?.str_hybrid_income_aed ?? null,
      str?.str_pct_mortgage_covered ?? null,
      app?.offplan_n ?? null,
      app?.offplan_psqft ?? null,
      app?.offplan_handover ?? null,
      app?.future_psqft ?? null,
      app?.appreciation_pct_yr ?? null,
      app?.appreciation_pct_yr_bear ?? null,
      app?.resale_premium ?? null,
      app?.resale_dom_days ?? null,
      app?.offplan_primary_psqft ?? null,
      app?.offplan_resale_psqft ?? null,
      live?.monthly_cost ?? null,
      live?.monthly_delta ?? null,
      live?.months_to_next ?? null,
      str?.str_breakeven_adr ?? null,
      y.median_sale_psqft,
      y.sale_psqft_n,
      y.price_vs_median,
      y.price_vs_median_basis,
      trend?.trend_psqft ?? null,
      trend?.discount_vs_trend ?? null,
      cooling?.type ?? null,
      cooling?.source ?? null,
      cooling?.monthly ?? null,
      basis?.rent_psqft_p25 ?? null,
      basis?.rent_psqft_median ?? null,
      basis?.rent_psqft_p75 ?? null,
      basis?.rent_psqft_n ?? 0,
      basis?.rent_basis_months ?? null
    );
}

export function getAnalysis(listingId: string): AnalysisRow | null {
  return (getDb().prepare(`SELECT * FROM analyses WHERE listing_id = ?`).get(listingId) as AnalysisRow) ?? null;
}

export interface AnalyzedListing extends ListingRow, Omit<AnalysisRow, "listing_id" | "computed_at"> {
  computed_at: string | null;
}

export function isFavorite(listingId: string): boolean {
  return getDb().prepare(`SELECT 1 FROM favorites WHERE listing_id = ?`).get(listingId) != null;
}

export function addFavorite(listingId: string) {
  getDb()
    .prepare(`INSERT OR IGNORE INTO favorites (listing_id, notes, added_at) VALUES (?, '', ?)`)
    .run(listingId, now());
}

export function removeFavorite(listingId: string) {
  getDb().prepare(`DELETE FROM favorites WHERE listing_id = ?`).run(listingId);
  // La búsqueda de recambio solo existe para avisar en la lista: sin favorito
  // no hay a quién avisar.
  clearReplacement(listingId);
}

export function setFavoriteNotes(listingId: string, notes: string) {
  getDb().prepare(`UPDATE favorites SET notes = ? WHERE listing_id = ?`).run(notes, listingId);
}

// --- Manual gyms (curated by the user via Google Maps links) ---------------

export interface GymRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  url: string | null;
  added_at: string;
}

export function addGym(g: { name: string; lat: number; lon: number; url?: string | null }): GymRow {
  const id = createHash("md5").update(`${g.lat.toFixed(5)},${g.lon.toFixed(5)}`).digest("hex").slice(0, 12);
  getDb()
    .prepare(`INSERT OR REPLACE INTO gyms (id, name, lat, lon, url, added_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, g.name, g.lat, g.lon, g.url ?? null, now());
  return { id, name: g.name, lat: g.lat, lon: g.lon, url: g.url ?? null, added_at: now() };
}

export function listGyms(): GymRow[] {
  return getDb().prepare(`SELECT * FROM gyms ORDER BY name COLLATE NOCASE`).all() as GymRow[];
}

export function removeGym(id: string) {
  getDb().prepare(`DELETE FROM gyms WHERE id = ?`).run(id);
}

/** Nearest user-saved gym to a point, by straight-line distance. */
export function nearestManualGym(lat: number, lon: number): { gym_name: string | null; distance_m: number | null } {
  const gyms = listGyms();
  if (!gyms.length) return { gym_name: null, distance_m: null };
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let best: { name: string; d: number } | null = null;
  for (const g of gyms) {
    const dLat = toRad(g.lat - lat);
    const dLon = toRad(g.lon - lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(g.lat)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    if (!best || d < best.d) best = { name: g.name, d };
  }
  return best ? { gym_name: best.name, distance_m: Math.round(best.d) } : { gym_name: null, distance_m: null };
}

export interface FavoriteListing extends AnalyzedListing {
  notes: string;
  added_at: string;
  /** Grupos del pipeline a los que pertenece ('favoritos' incluido). */
  group_ids: string[];
}

/** Column list shared by every listings ⋈ analyses read path. */
const ANALYSIS_COLS = `a.gross_yield, a.asking_yield, a.median_rent, a.median_sale_price,
              a.rent_p25, a.rent_p75, a.sale_p25, a.sale_p75,
              a.rent_n, a.buy_n, a.gym_distance_m, a.gym_name, a.computed_at,
              a.service_charge_rate, a.service_charge_source, a.service_charges_annual, a.net_yield,
              a.loan_amount, a.monthly_payment, a.cash_upfront, a.cash_on_cash, a.dbr_ok,
              a.str_slug, a.str_annual_revenue_aed, a.str_vs_rent, a.str_hybrid_income_aed, a.str_pct_mortgage_covered,
              a.offplan_n, a.offplan_psqft, a.offplan_handover, a.future_psqft, a.appreciation_pct_yr,
              a.appreciation_pct_yr_bear, a.resale_premium, a.resale_dom_days, a.offplan_primary_psqft, a.offplan_resale_psqft,
              a.live_monthly_cost, a.live_monthly_delta, a.months_to_next, a.str_breakeven_adr,
              a.median_sale_psqft, a.sale_psqft_n, a.price_vs_median, a.price_vs_median_basis,
              a.trend_psqft, a.discount_vs_trend,
              a.cooling_type, a.cooling_source, a.cooling_monthly_applied,
              a.rent_psqft_p25, a.rent_psqft_median, a.rent_psqft_p75, a.rent_psqft_n, a.rent_basis_months`;

/** listing_id → grupos del pipeline a los que pertenece. */
function groupIdsByListing(): Map<string, string[]> {
  const rows = getDb().prepare(`SELECT group_id, listing_id FROM pipeline_group_listings`).all() as {
    group_id: string;
    listing_id: string;
  }[];
  const m = new Map<string, string[]>();
  for (const g of rows) {
    const arr = m.get(g.listing_id) ?? [];
    arr.push(g.group_id);
    m.set(g.listing_id, arr);
  }
  return m;
}

export function listFavorites(): FavoriteListing[] {
  const groups = groupIdsByListing();
  const rows = getDb()
    .prepare(
      `SELECT l.*, ${ANALYSIS_COLS},
              f.notes, f.added_at
       FROM favorites f
       JOIN listings l ON l.id = f.listing_id
       LEFT JOIN analyses a ON a.listing_id = f.listing_id
       ORDER BY a.asking_yield DESC NULLS LAST`
    )
    .all() as FavoriteListing[];
  return rows.map((r) => ({ ...r, group_ids: groups.get(r.id) ?? [] }));
}

/**
 * Average annual liquidity per tower: DLD transactions of `kind` PER YEAR, over
 * the full stored history (total count ÷ years spanned by min→max date). Scraping
 * caps each tower at ~100 tx, so the *rate* — not the raw count — is what compares
 * a busy tower to a quiet one: 100 sales across 1 year is far more liquid than 100
 * across 4. Returned as tower_slug → transactions/year.
 */
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
export function annualLiquidityByTower(kind: "buy" | "rent"): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT tower_slug, COUNT(*) n, MIN(date) mn, MAX(date) mx
       FROM transactions WHERE kind = ? GROUP BY tower_slug`
    )
    .all(kind) as { tower_slug: string; n: number; mn: string; mx: string }[];
  const m = new Map<string, number>();
  for (const r of rows) {
    const spanY = (Date.parse(r.mx) - Date.parse(r.mn)) / MS_PER_YEAR;
    // Floor the span so a burst of transactions in a short window can't explode the rate.
    const years = Math.max(spanY, 0.5);
    m.set(r.tower_slug, r.n / years);
  }
  return m;
}

export function listAnalyzed(): AnalyzedListing[] {
  return getDb()
    .prepare(
      `SELECT l.*, ${ANALYSIS_COLS}
       FROM listings l JOIN analyses a ON a.listing_id = l.id
       ORDER BY a.asking_yield DESC NULLS LAST`
    )
    .all() as AnalyzedListing[];
}

// --- Pipeline de trabajo de campo ------------------------------------------

export type { PipelineStatus } from "./pipeline";
export const PIPELINE_STATUS_IDS: PipelineStatus[] = ["pendiente", "contactado", "visitado", "oferta", "adquirido", "descartado"];

export function setFavoriteStatus(listingId: string, status: PipelineStatus) {
  getDb()
    .prepare(`UPDATE favorites SET status = ?, status_changed_at = ? WHERE listing_id = ?`)
    .run(status, now(), listingId);
}

export interface PipelineCard extends FavoriteListing {
  status: PipelineStatus;
  status_changed_at: string | null;
  group_ids: string[];
  last_activity_at: string | null;
  last_activity_type: string | null;
  activity_count: number;
  last_offer_amount: number | null;
  final_price: number | null;
}

export function listPipeline(): PipelineCard[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.*, ${ANALYSIS_COLS},
              f.notes, f.added_at, f.status, f.status_changed_at
       FROM favorites f
       JOIN listings l ON l.id = f.listing_id
       LEFT JOIN analyses a ON a.listing_id = f.listing_id
       ORDER BY a.asking_yield DESC NULLS LAST`
    )
    .all() as (FavoriteListing & { status: PipelineStatus; status_changed_at: string | null })[];

  const groupsByListing = groupIdsByListing();

  const actRows = db
    .prepare(`SELECT listing_id, type, amount, offer_kind, happened_at FROM activities ORDER BY happened_at ASC, created_at ASC`)
    .all() as { listing_id: string; type: string; amount: number | null; offer_kind: string | null; happened_at: string }[];
  const actSummary = new Map<
    string,
    { last_at: string; last_type: string; count: number; last_offer: number | null; final: number | null }
  >();
  for (const t of actRows) {
    const s = actSummary.get(t.listing_id) ?? { last_at: "", last_type: "", count: 0, last_offer: null, final: null };
    s.count += 1;
    s.last_at = t.happened_at;
    s.last_type = t.type;
    if (t.type === "oferta" && t.amount != null) {
      s.last_offer = t.amount;
      if (t.offer_kind === "final") s.final = t.amount;
    }
    actSummary.set(t.listing_id, s);
  }

  return rows.map((r) => {
    const s = actSummary.get(r.id);
    return {
      ...r,
      group_ids: groupsByListing.get(r.id) ?? [],
      last_activity_at: s?.last_at || null,
      last_activity_type: s?.last_type || null,
      activity_count: s?.count ?? 0,
      last_offer_amount: s?.last_offer ?? null,
      final_price: s?.final ?? null,
    };
  });
}

// --- Grupos manuales del pipeline ------------------------------------------

/** Grupo fijo sembrado en la migración: destino del ★ en mapa y ficha. */
export const FAVORITES_GROUP_ID = "favoritos";

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  count: number;
}

export function listGroups(): GroupRow[] {
  return getDb()
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM pipeline_group_listings pl WHERE pl.group_id = g.id) count
       FROM pipeline_groups g ORDER BY (g.id = '${FAVORITES_GROUP_ID}') DESC, g.created_at`
    )
    .all() as GroupRow[];
}

export function listingGroupIds(listingId: string): string[] {
  return (
    getDb().prepare(`SELECT group_id FROM pipeline_group_listings WHERE listing_id = ?`).all(listingId) as {
      group_id: string;
    }[]
  ).map((r) => r.group_id);
}

export function createGroup(name: string): GroupRow {
  const id = crypto.randomUUID();
  getDb().prepare(`INSERT INTO pipeline_groups (id, name, created_at) VALUES (?, ?, ?)`).run(id, name, now());
  return { id, name, created_at: now(), count: 0 };
}

export function renameGroup(id: string, name: string) {
  if (id === FAVORITES_GROUP_ID) throw new Error("El grupo Favoritos no se puede renombrar");
  getDb().prepare(`UPDATE pipeline_groups SET name = ? WHERE id = ?`).run(name, id);
}

export function deleteGroup(id: string) {
  if (id === FAVORITES_GROUP_ID) throw new Error("El grupo Favoritos no se puede eliminar");
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM pipeline_group_listings WHERE group_id = ?`).run(id);
    db.prepare(`DELETE FROM pipeline_groups WHERE id = ?`).run(id);
  })();
}

export function setListingGroups(listingId: string, groupIds: string[]) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM pipeline_group_listings WHERE listing_id = ?`).run(listingId);
    const ins = db.prepare(`INSERT OR IGNORE INTO pipeline_group_listings (group_id, listing_id, added_at) VALUES (?, ?, ?)`);
    for (const g of groupIds) ins.run(g, listingId, now());
  })();
}

// --- Historial de actividad ------------------------------------------------

export type ActivityType = "llamada" | "visita" | "oferta" | "nota";
export type OfferKind = "oferta" | "contraoferta" | "final";

export interface ActivityRow {
  id: string;
  listing_id: string;
  type: ActivityType;
  note: string;
  amount: number | null;
  offer_kind: OfferKind | null;
  happened_at: string;
  created_at: string;
}

export function listActivities(listingId: string): ActivityRow[] {
  return getDb()
    .prepare(`SELECT * FROM activities WHERE listing_id = ? ORDER BY happened_at DESC, created_at DESC`)
    .all(listingId) as ActivityRow[];
}

export function addActivity(a: {
  listing_id: string;
  type: ActivityType;
  note?: string;
  amount?: number | null;
  offer_kind?: OfferKind | null;
  happened_at?: string;
}): ActivityRow {
  const row: ActivityRow = {
    id: crypto.randomUUID(),
    listing_id: a.listing_id,
    type: a.type,
    note: a.note ?? "",
    amount: a.amount ?? null,
    offer_kind: a.type === "oferta" ? a.offer_kind ?? "oferta" : null,
    happened_at: a.happened_at || now().slice(0, 10),
    created_at: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO activities (id, listing_id, type, note, amount, offer_kind, happened_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(row.id, row.listing_id, row.type, row.note, row.amount, row.offer_kind, row.happened_at, row.created_at);
  return row;
}

export function deleteActivity(id: string) {
  getDb().prepare(`DELETE FROM activities WHERE id = ?`).run(id);
}
