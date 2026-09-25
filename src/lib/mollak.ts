import { getDb, now } from "./db";

/**
 * Service charges oficiales por edificio del sistema Mollak (aprobados por
 * RERA), publicados como dataset abierto en Dubai Pulse
 * (dld_oa_service_charges). Cada fila del CSV es (edificio/OA, uso, año,
 * categoría de servicio) con el coste en AED/sqft; el total por edificio-año
 * es la suma de las categorías por sqft del uso Residential.
 *
 * Dubai Pulse geobloquea/expulsa tráfico de fuera de UAE con frecuencia, así
 * que si la descarga en vivo falla se usa el último snapshot de archive.org
 * (el dataset se actualiza una vez al año, el coste de ir un año por detrás
 * es bajo).
 */

const LIVE_URL =
  "https://www.dubaipulse.gov.ae/dataset/7eadb901-4b01-4910-bc1b-a5e330da9f7c/resource/23eeac6a-f498-491a-a93b-6b16badf708b/download/oa_service_charges.csv";
// "2id_" = último snapshot disponible, contenido original sin reescribir.
const ARCHIVE_URL =
  "https://web.archive.org/web/2id_/https://www.dubaipulse.gov.ae/dataset/7eadb901-4b01-4910-bc1b-a5e330da9f7c/resource/23eeac6a-f498-491a-a93b-6b16badf708b/download/oa_service_charges.csv";

/**
 * Tarifas por UNIDAD, no por sqft: no pueden sumarse al AED/sqft del edificio.
 * Se distinguen por la escala de sus importes en el CSV real: Parking mediana
 * 948 y Meter Installation 1.273, frente a 2-25 de las categorías por sqft.
 *
 * OJO: "Unit A/C (Charges)" NO está aquí a pesar del nombre. Verificado sobre
 * el dataset completo (n=954 filas residenciales): min 0, mediana 5, max 21 —
 * la misma escala que las categorías por sqft. Excluirla infravaloraba el
 * service charge de 212 edificios (12,2%) en ~5 AED/sqft de mediana.
 */
const PER_UNIT_CATEGORIES = new Set(["Parking", "Meter Installation", "Storage Units", "Hotel Services"]);

/** Categorías de aire acondicionado: pista (débil) de que el chiller va dentro. */
export const AC_CATEGORIES = new Set(["Unit A/C (Charges)", "Unit A/C (Sq.Ft)"]);

// Totales fuera de este rango son datos sucios (p.ej. un "Parking 500" colado
// como sqft): se guardan pero no se usan para resolver.
const MIN_PLAUSIBLE = 2;
const MAX_PLAUSIBLE = 100;

export interface MollakRow {
  property_group_id: string;
  budget_year: number;
  building_name: string;
  master_community: string;
  aed_per_sqft: number;
  plausible: number;
  fetched_at: string;
}

export interface MollakStatus {
  buildings: number;
  rows: number;
  latest_year: number | null;
  fetched_at: string | null;
}

export function mollakStatus(): MollakStatus {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT COUNT(DISTINCT property_group_id) buildings, COUNT(*) rows, MAX(budget_year) latest_year, MAX(fetched_at) fetched_at
       FROM mollak_service_charges`
    )
    .get() as { buildings: number; rows: number; latest_year: number | null; fetched_at: string | null };
  return r;
}

// --- CSV --------------------------------------------------------------------

/** Parser RFC-4180 mínimo (campos entrecomillados con comas y comillas dobladas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchCsv(): Promise<{ text: string; source: "dubai-pulse" | "archive" }> {
  try {
    const res = await fetch(LIVE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return { text: await res.text(), source: "dubai-pulse" };
  } catch {}
  const res = await fetch(ARCHIVE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Dubai Pulse y archive.org fallaron (HTTP ${res.status})`);
  return { text: await res.text(), source: "archive" };
}

/** Descarga e importa el dataset entero. Devuelve un resumen para la UI. */
export async function syncMollak(): Promise<{ source: string; rows: number; buildings: number }> {
  const { text, source } = await fetchCsv();
  const parsed = parseCsv(text);
  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iGroup = col("property_group_id");
  const iName = col("property_group_name_en");
  const iCommunity = col("master_community_name_en");
  const iUsage = col("usage_name_en");
  const iYear = col("budget_year");
  const iCost = col("service_cost");
  const iCat = col("service_category_name_en");
  if ([iGroup, iName, iUsage, iYear, iCost, iCat].some((i) => i < 0)) {
    throw new Error("El CSV de Dubai Pulse no tiene las columnas esperadas");
  }

  // Suma de categorías por sqft por (edificio, año), solo uso Residential.
  const totals = new Map<string, { name: string; community: string; year: number; total: number }>();
  // Desglose por categoría: se guarda entero (incluidas las por unidad) para
  // poder auditar qué entra en el AED/sqft y detectar líneas de A/C.
  const cats: { group: string; year: number; category: string; cost: number; perUnit: number }[] = [];
  for (let r = 1; r < parsed.length; r++) {
    const row = parsed[r];
    if (row.length < header.length) continue;
    if (row[iUsage].trim().toLowerCase() !== "residential") continue;
    const cat = row[iCat].trim();
    const year = parseInt(row[iYear], 10);
    const cost = parseFloat(row[iCost]);
    if (!Number.isFinite(year) || !Number.isFinite(cost)) continue;
    const perUnit = PER_UNIT_CATEGORIES.has(cat);
    cats.push({ group: row[iGroup], year, category: cat, cost, perUnit: perUnit ? 1 : 0 });
    if (perUnit) continue;
    const key = `${row[iGroup]}|${year}`;
    const e = totals.get(key) ?? { name: row[iName].trim(), community: (row[iCommunity] ?? "").trim(), year, total: 0 };
    e.total += cost;
    totals.set(key, e);
  }
  if (totals.size === 0) throw new Error("El CSV no contiene filas Residential");

  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO mollak_service_charges
     (property_group_id, budget_year, building_name, master_community, aed_per_sqft, plausible, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insCat = db.prepare(
    `INSERT OR REPLACE INTO mollak_categories (property_group_id, budget_year, category, cost, per_unit)
     VALUES (?, ?, ?, ?, ?)`
  );
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM mollak_service_charges`).run();
    db.prepare(`DELETE FROM mollak_categories`).run();
    for (const [key, e] of totals) {
      const groupId = key.split("|")[0];
      const plausible = e.total >= MIN_PLAUSIBLE && e.total <= MAX_PLAUSIBLE ? 1 : 0;
      ins.run(groupId, e.year, e.name, e.community, Math.round(e.total * 100) / 100, plausible, ts);
    }
    for (const c of cats) insCat.run(c.group, c.year, c.category, c.cost, c.perUnit);
  });
  tx();
  invalidateMatcher();
  const st = mollakStatus();
  return { source, rows: st.rows, buildings: st.buildings };
}

// --- Matching torre PF → edificio Mollak ------------------------------------

const STOP_TOKENS = new Set(["building", "bldg", "tower", "towers", "block", "the", "at", "and"]);

function tokenList(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP_TOKENS.has(t));
}

function tokens(name: string): Set<string> {
  return new Set(tokenList(name));
}

/** Tokens con dígitos ("3", "92", "i11"): discriminan edificios de una serie. */
function digitTokens(s: Set<string>): Set<string> {
  return new Set([...s].filter((t) => /\d/.test(t)));
}

interface MatcherEntry {
  toks: Set<string>;
  first: string | undefined;
  communityToks: Set<string>;
  name: string;
  year: number;
  rate: number;
}

let matcher: MatcherEntry[] | null = null;

function invalidateMatcher() {
  matcher = null;
}

/** Última anualidad plausible de cada edificio, con tokens precalculados. */
function loadMatcher(): MatcherEntry[] {
  if (matcher) return matcher;
  const rows = getDb()
    .prepare(
      `SELECT building_name, master_community, budget_year, aed_per_sqft
       FROM mollak_service_charges m
       WHERE plausible = 1
         AND budget_year = (SELECT MAX(budget_year) FROM mollak_service_charges
                            WHERE property_group_id = m.property_group_id AND plausible = 1)`
    )
    .all() as { building_name: string; master_community: string; budget_year: number; aed_per_sqft: number }[];
  matcher = rows.map((r) => ({
    toks: tokens(r.building_name),
    first: tokenList(r.building_name)[0],
    communityToks: tokens(r.master_community),
    name: r.building_name,
    year: r.budget_year,
    rate: r.aed_per_sqft,
  }));
  return matcher;
}

export interface MollakMatch {
  rate: number;
  building: string;
  year: number;
}

function setEq(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((t) => b.has(t));
}

function subset(a: Set<string>, b: Set<string>) {
  return [...a].every((t) => b.has(t));
}

function overlap(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Busca el edificio Mollak de una torre de PF. Conservador a propósito — un
 * falso positivo mete un service charge de OTRO edificio en el análisis:
 * - igualdad de tokens → vale ("Ritaj A" = "Ritaj - Ritaj Block A");
 * - contención con ≥2 tokens comunes → vale solo si además coinciden el primer
 *   token (la "marca": rechaza "Marina Living" → "Jumeirah Living Marina
 *   Gate"), los tokens numéricos (rechaza "Elite Sports Residence 3" →
 *   "Elite Residence") y la comunidad cuando ambas se conocen;
 * - contención con 1 token solo si ese token ancla identidad con un número
 *   ("Building I11" → "International City-I11", "Building 92" → "Med 92") y la
 *   comunidad casa por subconjunto; un token genérico no basta ("Marina
 *   Living" NUNCA casa con "Marina Tower").
 */
export function mollakRateFor(towerName: string | null, communityName: string | null): MollakMatch | null {
  if (!towerName) return null;
  const t = tokens(towerName);
  if (t.size === 0) return null;
  const first = tokenList(towerName)[0];
  const tDigits = digitTokens(t);
  const communityToks = communityName ? tokens(communityName) : new Set<string>();

  const communityCompatible = (m: MatcherEntry) =>
    communityToks.size === 0 ||
    m.communityToks.size === 0 ||
    subset(communityToks, m.communityToks) ||
    subset(m.communityToks, communityToks);

  let best: { score: number; ov: number; m: MatcherEntry } | null = null;
  for (const m of loadMatcher()) {
    let score = 0;
    if (setEq(t, m.toks)) score = 3;
    else if (subset(t, m.toks) || subset(m.toks, t)) {
      const ov = overlap(t, m.toks);
      const digitsOk = setEq(tDigits, digitTokens(m.toks));
      if (ov >= 2 && digitsOk && first === m.first && communityCompatible(m)) score = 2;
      else if (ov === 1 && tDigits.size > 0 && digitsOk && communityToks.size > 0 && m.communityToks.size > 0 &&
               (subset(communityToks, m.communityToks) || subset(m.communityToks, communityToks))) score = 1;
    }
    if (score === 0) continue;
    const ov = overlap(t, m.toks);
    if (!best || score > best.score || (score === best.score && (ov > best.ov || (ov === best.ov && m.year > best.m.year)))) {
      best = { score, ov, m };
    }
  }
  return best ? { rate: best.m.rate, building: best.m.name, year: best.m.year } : null;
}
