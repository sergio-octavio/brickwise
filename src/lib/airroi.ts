import { getDb, now } from "./db";

/**
 * Datos STR gratuitos de AirROI (airroi.com) por submercado. Las páginas son
 * Astro: los KPIs anuales van en <meta name="description"> y las series
 * mensuales en atributos props de <astro-island>, con cada valor codificado
 * como [0, escalar] | [1, array]. Todo en USD.
 *
 * Solo existen 5 submercados para Dubái: business-bay, deira, dubai (ciudad
 * entera), dubai-marina y emaar-beachfront — cualquier otra zona cae al
 * agregado "dubai".
 */

const BASE = "https://www.airroi.com/airbnb-data/united-arab-emirates/dubai";
const TTL_MS = 30 * 24 * 3600 * 1000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const AIRROI_DUBAI_SLUGS = ["business-bay", "deira", "dubai", "dubai-marina", "emaar-beachfront"] as const;

export interface StrMarketRow {
  slug: string;
  adr_usd: number | null;
  occupancy: number | null;
  revpar_usd: number | null;
  annual_revenue_usd: number | null;
  peak_adr_usd: number | null;
  peak_occupancy: number | null;
  monthly_json: string;
  fetched_at: string;
}

export interface StrMonth {
  month: string;
  adr_usd: number | null;
  occupancy: number | null;
}

const ZONE_MAP_SEED: [community: string, airroi: string][] = [
  ["business-bay", "business-bay"],
  ["dubai-marina", "dubai-marina"],
  ["dubai-marina-and-jbr", "dubai-marina"],
  ["jumeirah-beach-residence", "dubai-marina"],
  ["deira", "deira"],
  ["emaar-beachfront", "emaar-beachfront"],
  ["dubai-harbour", "emaar-beachfront"],
];

function seedZoneMap() {
  const db = getDb();
  const count = (db.prepare(`SELECT COUNT(*) n FROM str_zone_map`).get() as { n: number }).n;
  if (count > 0) return;
  const ins = db.prepare(`INSERT INTO str_zone_map (community_slug, airroi_slug) VALUES (?, ?)`);
  const tx = db.transaction(() => {
    for (const [c, a] of ZONE_MAP_SEED) ins.run(c, a);
  });
  tx();
}

export function listStrZoneMap(): { community_slug: string; airroi_slug: string }[] {
  seedZoneMap();
  return getDb().prepare(`SELECT * FROM str_zone_map ORDER BY community_slug`).all() as {
    community_slug: string;
    airroi_slug: string;
  }[];
}

export function upsertStrZoneMap(communitySlug: string, airroiSlug: string) {
  getDb()
    .prepare(`INSERT OR REPLACE INTO str_zone_map (community_slug, airroi_slug) VALUES (?, ?)`)
    .run(communitySlug.toLowerCase(), airroiSlug);
}

/** Submercado AirROI para una comunidad PF; sin mapeo → agregado de la ciudad. */
export function airroiSlugFor(communitySlug: string | null): string {
  if (communitySlug) {
    seedZoneMap();
    const row = getDb()
      .prepare(`SELECT airroi_slug FROM str_zone_map WHERE community_slug = ?`)
      .get(communitySlug.toLowerCase()) as { airroi_slug: string } | undefined;
    if (row) return row.airroi_slug;
  }
  return "dubai";
}

export function getCachedStrMarket(slug: string): StrMarketRow | null {
  return (getDb().prepare(`SELECT * FROM str_market WHERE slug = ?`).get(slug) as StrMarketRow) ?? null;
}

export function listStrMarkets(): StrMarketRow[] {
  return getDb().prepare(`SELECT * FROM str_market ORDER BY slug`).all() as StrMarketRow[];
}

/** Fetch + parseo con cache TTL; si el fetch/parseo falla, conserva la fila stale. */
export async function getStrMarket(slug: string, force = false): Promise<StrMarketRow | null> {
  const cached = getCachedStrMarket(slug);
  if (!force && cached && Date.now() - Date.parse(cached.fetched_at) < TTL_MS) return cached;

  let html: string | null = null;
  for (let attempt = 0; attempt < 2 && html == null; attempt++) {
    try {
      const res = await fetch(`${BASE}/${slug}`, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) html = await res.text();
      else if (res.status === 404) return cached;
    } catch {}
  }
  if (html == null) return cached;

  const parsed = parseAirroiPage(html);
  if (!parsed) return cached;

  const row: StrMarketRow = { slug, ...parsed, fetched_at: now() };
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO str_market
       (slug, adr_usd, occupancy, revpar_usd, annual_revenue_usd, peak_adr_usd, peak_occupancy, monthly_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.slug,
      row.adr_usd,
      row.occupancy,
      row.revpar_usd,
      row.annual_revenue_usd,
      row.peak_adr_usd,
      row.peak_occupancy,
      row.monthly_json,
      row.fetched_at
    );
  return row;
}

// --- Parseo -----------------------------------------------------------------

/** Desenrolla la codificación de valores de Astro: [0, escalar] | [1, array]. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(v: any): any {
  if (Array.isArray(v) && v.length === 2 && (v[0] === 0 || v[0] === 1)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return v[0] === 1 ? (v[1] as any[]).map(unwrap) : unwrap(v[1]);
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k] = unwrap(val);
    return out;
  }
  return v;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAirroiPage(html: string): Omit<StrMarketRow, "slug" | "fetched_at"> | null {
  // KPIs anuales: "$23,475/year revenue, 40.8% occupancy rate, $244/night ADR, and $99 RevPAR"
  const meta = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const kpi = decodeEntities(meta).match(
    /\$([\d,]+)\/year revenue, ([\d.]+)% occupancy rate, \$([\d,]+)\/night ADR, and \$([\d,]+) RevPAR/
  );
  const num = (s: string) => parseFloat(s.replace(/,/g, ""));

  // Series mensuales en las astro-islands de daily_rate y occupancy_rate.
  const months = new Map<string, StrMonth>();
  for (const m of html.matchAll(/<astro-island[^>]*props="([^"]*)"/g)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = unwrap(JSON.parse(decodeEntities(m[1]))?.data);
    } catch {
      continue;
    }
    if (!data?.months || !Array.isArray(data.months)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of data.months as any[]) {
      if (!row?.month) continue;
      const entry = months.get(row.month) ?? { month: row.month, adr_usd: null, occupancy: null };
      if (typeof row.daily_rate_avg === "number") entry.adr_usd = row.daily_rate_avg;
      if (typeof row.occupancy_rate_avg === "number") entry.occupancy = row.occupancy_rate_avg;
      months.set(row.month, entry);
    }
  }
  const monthly = [...months.values()].filter((m) => m.adr_usd != null || m.occupancy != null);

  if (!kpi && !monthly.length) return null;

  // Mes pico = el de mayor ADR; su ocupación acompaña al modo híbrido del spec.
  let peak: StrMonth | null = null;
  for (const m of monthly) {
    if (m.adr_usd != null && (peak?.adr_usd == null || m.adr_usd > peak.adr_usd)) peak = m;
  }

  return {
    annual_revenue_usd: kpi ? num(kpi[1]) : null,
    occupancy: kpi ? num(kpi[2]) / 100 : null,
    adr_usd: kpi ? num(kpi[3]) : null,
    revpar_usd: kpi ? num(kpi[4]) : null,
    peak_adr_usd: peak?.adr_usd ?? null,
    peak_occupancy: peak?.occupancy ?? null,
    monthly_json: JSON.stringify(monthly),
  };
}
