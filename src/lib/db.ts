import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

let db: Database.Database | null = null;

/**
 * Stable per-user location so data survives no matter how the app is launched
 * (including `npx`, which runs from an ephemeral cache). Override with BRICKWISE_DB.
 * One-time migrates a legacy ./brickwise.db from earlier local runs.
 */
function resolveDbPath(): string {
  if (process.env.BRICKWISE_DB) return process.env.BRICKWISE_DB;
  const dir = path.join(os.homedir(), ".brickwise");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "brickwise.db");
  if (!fs.existsSync(target)) {
    const legacy = path.join(process.cwd(), "brickwise.db");
    if (fs.existsSync(legacy)) {
      try {
        fs.copyFileSync(legacy, target);
      } catch {
        /* start fresh if the copy fails */
      }
    }
  }
  return target;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path_name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  city_slug TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL,
  size_sqft REAL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  property_type TEXT NOT NULL DEFAULT '',
  tower_id TEXT,
  tower_slug TEXT,
  tower_name TEXT,
  city_slug TEXT,
  lat REAL,
  lon REAL,
  images_json TEXT NOT NULL DEFAULT '[]',
  amenities_json TEXT NOT NULL DEFAULT '[]',
  agent_json TEXT NOT NULL DEFAULT '{}',
  price_per_sqft REAL,
  description TEXT,
  first_seen_at TEXT NOT NULL,
  last_scraped_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tower_slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('buy','rent')),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  size_sqft REAL,
  price_per_sqft REAL,
  bedrooms INTEGER,
  unit TEXT,
  scraped_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_tower ON transactions(tower_slug, kind);

CREATE TABLE IF NOT EXISTS tx_sync (
  tower_slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (tower_slug, kind)
);

CREATE TABLE IF NOT EXISTS gym_cache (
  geo_key TEXT PRIMARY KEY,
  gym_name TEXT,
  gym_lat REAL,
  gym_lon REAL,
  distance_m REAL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gyms_list_cache (
  geo_key TEXT PRIMARY KEY,
  gyms_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS poi_list_cache (
  geo_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (geo_key, kind)
);

CREATE TABLE IF NOT EXISTS favorites (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id),
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL
);

-- User-curated gyms (added by pasting a Google Maps link), not OSM.
CREATE TABLE IF NOT EXISTS gyms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  url TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id),
  gross_yield REAL,
  yield_vs_market REAL,
  market_value_est REAL,
  median_rent REAL,
  median_buy_psqft REAL,
  rent_n INTEGER NOT NULL DEFAULT 0,
  buy_n INTEGER NOT NULL DEFAULT 0,
  premium_pct REAL,
  gym_distance_m REAL,
  gym_name TEXT,
  computed_at TEXT NOT NULL
);

-- Carpetas manuales del pipeline de trabajo de campo (un inmueble puede estar en varias).
CREATE TABLE IF NOT EXISTS pipeline_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_group_listings (
  group_id TEXT NOT NULL REFERENCES pipeline_groups(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (group_id, listing_id)
);

-- Historial de campo por inmueble; las ofertas son entradas con amount + offer_kind.
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  type TEXT NOT NULL CHECK (type IN ('llamada','visita','oferta','nota')),
  note TEXT NOT NULL DEFAULT '',
  amount REAL,
  offer_kind TEXT CHECK (offer_kind IN ('oferta','contraoferta','final')),
  happened_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_listing ON activities(listing_id, happened_at);

-- Constantes [CONFIG] editables desde /settings; una fila por clave, valor JSON.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Service charge estimado por comunidad (AED/sqft/año), editable en /settings.
CREATE TABLE IF NOT EXISTS zone_service_charges (
  community_slug TEXT PRIMARY KEY,
  community_name TEXT NOT NULL DEFAULT '',
  aed_per_sqft REAL NOT NULL,
  updated_at TEXT NOT NULL
);

-- Datos de mercado STR (AirROI) por submercado; valores en USD, peg fijo al mostrar.
CREATE TABLE IF NOT EXISTS str_market (
  slug TEXT PRIMARY KEY,
  adr_usd REAL,
  occupancy REAL,
  revpar_usd REAL,
  annual_revenue_usd REAL,
  peak_adr_usd REAL,
  peak_occupancy REAL,
  monthly_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL
);

-- Búsqueda de recambio para un anuncio retirado: se lanza en PF al detectar que
-- ya no está disponible y guarda el enlace + los primeros candidatos.
CREATE TABLE IF NOT EXISTS listing_replacements (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id),
  search_url TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  found_n INTEGER NOT NULL DEFAULT 0,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  searched_at TEXT NOT NULL
);

-- Comunidad PF → submercado AirROI (solo existen 5 para Dubái; fallback 'dubai').
CREATE TABLE IF NOT EXISTS str_zone_map (
  community_slug TEXT PRIMARY KEY,
  airroi_slug TEXT NOT NULL
);

-- Service charges oficiales por edificio (sistema Mollak/RERA vía Dubai Pulse,
-- dataset dld_oa_service_charges). aed_per_sqft = suma de categorías por sqft
-- del uso Residential; las tarifas por unidad (parking, chiller por cargo) se
-- excluyen al importar.
CREATE TABLE IF NOT EXISTS mollak_service_charges (
  property_group_id TEXT NOT NULL,
  budget_year INTEGER NOT NULL,
  building_name TEXT NOT NULL,
  master_community TEXT NOT NULL DEFAULT '',
  aed_per_sqft REAL NOT NULL,
  plausible INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (property_group_id, budget_year)
);
CREATE INDEX IF NOT EXISTS idx_mollak_name ON mollak_service_charges(building_name);

-- Desglose por categoría del presupuesto Mollak. Permite auditar qué entra en
-- el AED/sqft y detectar edificios con línea de A/C (pista de chiller incluido).
CREATE TABLE IF NOT EXISTS mollak_categories (
  property_group_id TEXT NOT NULL,
  budget_year INTEGER NOT NULL,
  category TEXT NOT NULL,
  cost REAL NOT NULL,
  per_unit INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_group_id, budget_year, category)
);
CREATE INDEX IF NOT EXISTS idx_mollak_cat ON mollak_categories(category);
`;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(resolveDbPath());
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database) {
  const addCol = (table: string, name: string, ddl: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  };
  addCol("analyses", "median_sale_price", "REAL");
  addCol("analyses", "asking_yield", "REAL");
  addCol("analyses", "rent_p25", "REAL");
  addCol("analyses", "rent_p75", "REAL");
  addCol("analyses", "sale_p25", "REAL");
  addCol("analyses", "sale_p75", "REAL");
  addCol("favorites", "status", `TEXT NOT NULL DEFAULT 'pendiente'`);
  addCol("favorites", "status_changed_at", "TEXT");
  // Grupo fijo del pipeline: el ★ del mapa y la ficha apuntan siempre a este id.
  db.prepare(`INSERT OR IGNORE INTO pipeline_groups (id, name, created_at) VALUES ('favoritos', 'Favoritos', ?)`).run(
    new Date().toISOString()
  );
  // Zona + overrides financieros por anuncio (editables, deben sobrevivir al re-scrape).
  addCol("listings", "community_slug", "TEXT");
  addCol("listings", "community_name", "TEXT");
  addCol("listings", "service_charge_override", "REAL");
  addCol("listings", "dld_waiver", "INTEGER NOT NULL DEFAULT 0");
  addCol("listings", "second_home", "INTEGER");
  addCol("listings", "completion_status", "TEXT");
  addCol("listings", "handover_date", "TEXT");
  addCol("listings", "sale_type", "TEXT");
  addCol("listings", "listed_date", "TEXT");
  // Tipo de refrigeración: propiedad del EDIFICIO, se propaga a toda la torre.
  addCol("listings", "cooling_type_override", "TEXT");
  // Disponibilidad en PF: fecha de la primera comprobación que lo dio por
  // retirado (NULL = sigue anunciado) y cuándo se comprobó por última vez.
  addCol("listings", "unavailable_at", "TEXT");
  addCol("listings", "availability_checked_at", "TEXT");
  // Métricas financieras derivadas (yield neto, hipoteca, cash-on-cash, STR).
  addCol("analyses", "service_charge_rate", "REAL");
  addCol("analyses", "service_charges_annual", "REAL");
  addCol("analyses", "net_yield", "REAL");
  addCol("analyses", "loan_amount", "REAL");
  addCol("analyses", "monthly_payment", "REAL");
  addCol("analyses", "cash_upfront", "REAL");
  addCol("analyses", "cash_on_cash", "REAL");
  addCol("analyses", "dbr_ok", "INTEGER");
  addCol("analyses", "service_charge_source", "TEXT");
  addCol("analyses", "str_slug", "TEXT");
  addCol("analyses", "str_annual_revenue_aed", "REAL");
  addCol("analyses", "str_vs_rent", "REAL");
  addCol("analyses", "str_hybrid_income_aed", "REAL");
  addCol("analyses", "str_pct_mortgage_covered", "REAL");
  // Revalorización estimada por off-plan colindante
  addCol("analyses", "offplan_n", "INTEGER");
  addCol("analyses", "offplan_psqft", "REAL");
  addCol("analyses", "offplan_handover", "TEXT");
  addCol("analyses", "future_psqft", "REAL");
  addCol("analyses", "appreciation_pct_yr", "REAL");
  // v2: escenario bajista + señal de demanda por resales
  addCol("analyses", "appreciation_pct_yr_bear", "REAL");
  addCol("analyses", "resale_premium", "REAL");
  addCol("analyses", "resale_dom_days", "REAL");
  addCol("analyses", "offplan_primary_psqft", "REAL");
  addCol("analyses", "offplan_resale_psqft", "REAL");
  // Estrategia "vivo primero": coste de vivir ahí, ahorro vs alquilar y
  // meses hasta poder pagar la entrada del siguiente piso.
  addCol("analyses", "live_monthly_cost", "REAL");
  addCol("analyses", "live_monthly_delta", "REAL");
  addCol("analyses", "months_to_next", "REAL");
  // STR: ADR necesario para igualar la renta larga (verificable a mano).
  addCol("analyses", "str_breakeven_adr", "REAL");
  // Precio vs mercado: ¿pides por encima o por debajo de lo que se paga?
  addCol("analyses", "median_sale_psqft", "REAL");
  addCol("analyses", "sale_psqft_n", "INTEGER NOT NULL DEFAULT 0");
  addCol("analyses", "price_vs_median", "REAL");
  addCol("analyses", "price_vs_median_basis", "TEXT");
  // Descuento vs la curva de tendencia, persistido para que salga del cliente.
  addCol("analyses", "trend_psqft", "REAL");
  addCol("analyses", "discount_vs_trend", "REAL");
  // Refrigeración resuelta (override → Mollak → texto → desconocido).
  addCol("analyses", "cooling_type", "TEXT");
  addCol("analyses", "cooling_source", "TEXT");
  addCol("analyses", "cooling_monthly_applied", "REAL");
  // Base de rentas por sqft para el margen de reforma (ventana preferente 12 m).
  addCol("analyses", "rent_psqft_p25", "REAL");
  addCol("analyses", "rent_psqft_median", "REAL");
  addCol("analyses", "rent_psqft_p75", "REAL");
  addCol("analyses", "rent_psqft_n", "INTEGER NOT NULL DEFAULT 0");
  addCol("analyses", "rent_basis_months", "INTEGER");
}

export function now(): string {
  return new Date().toISOString();
}
