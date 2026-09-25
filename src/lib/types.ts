export interface PfImage {
  small: string;
  medium: string;
}

export interface PfLocation {
  id: string;
  full_name: string;
  coordinates?: { lat: number; lon: number };
  slug: string;
  path: string;
  type: string;
  name: string;
  path_name: string;
}

export interface PfAgent {
  id?: string | number;
  name?: string;
  email?: string;
  position?: string;
  avg_whatsapp_response_time?: number | string;
  years_of_experience?: number;
  review_count?: number;
  avg_score?: number;
  detail_url?: string;
}

export interface PfBroker {
  id?: string | number;
  name?: string;
  email?: string;
  phone?: string;
  logo?: string;
  address?: string;
  license_number?: string;
}

export interface PfContactOption {
  type: "email" | "phone" | "whatsapp";
  value?: string;
  link?: string;
}

export interface PfProperty {
  id: string;
  /** Token ULID del anuncio (p.ej. E1RT2C0X…): base del enlace /go/ del WhatsApp oficial. */
  listing_id?: string;
  title: string;
  /** "completed" | "completed_primary" | "off_plan" | "off_plan_primary" */
  completion_status?: string;
  /** Solo en la página de detalle de anuncios off-plan. */
  project?: { delivery_date?: string; title?: string };
  price: { value: number; currency: string; period: string };
  size?: { value: number; unit: string } | number;
  bedrooms?: number | string;
  bathrooms?: number | string;
  property_type: string;
  images: PfImage[];
  share_url: string;
  details_path: string;
  location: PfLocation;
  location_tree?: PfLocation[];
  amenity_names?: string[];
  amenities?: string[];
  price_per_area?: number;
  description?: string;
  listed_date?: string;
  broker?: PfBroker;
  agent?: PfAgent;
  contact_options?: PfContactOption[];
  similar_price_transactions?: {
    buy: SimilarTransaction[];
    rent: SimilarTransaction[];
  };
}

export interface SimilarTransaction {
  date: string;
  amount: string;
  size: number;
}

export interface PfTransaction {
  id: string;
  transactionDate: string;
  price: number;
  propertySize: number;
  pricePerSqft: number;
  bedrooms: number | string;
  propertyNumber: string;
  propertyType: string;
  locationName: string;
  contractStartDate?: string;
  contractEndDate?: string;
}

export interface SearchFilters {
  locationId?: string;
  locationLabel?: string;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  bedrooms?: string[];
  bathrooms?: string[];
  propertyTypeId?: string;
  amenities?: string[];
  maxGymDistanceM?: number;
  maxPages?: number;
}

export interface ListingRow {
  id: string;
  url: string;
  title: string;
  price: number;
  size_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: string;
  tower_id: string | null;
  tower_slug: string | null;
  tower_name: string | null;
  city_slug: string | null;
  lat: number | null;
  lon: number | null;
  images_json: string;
  amenities_json: string;
  agent_json: string;
  price_per_sqft: number | null;
  description: string | null;
  first_seen_at: string;
  last_scraped_at: string;
  community_slug: string | null;
  community_name: string | null;
  /** AED/sqft/año conocido del edificio; pisa el default de zona. */
  service_charge_override: number | null;
  /** 0/1 — el vendedor/developer asume el 4% de DLD. */
  dld_waiver: number;
  /** 0/1/null — null usa el default de config (LTV 65% si es 2ª vivienda). */
  second_home: number | null;
  /** "ready" | "offplan" | null (anuncios scrapeados antes de capturarlo). */
  completion_status: string | null;
  /** Fecha de entrega (ISO) de PF project.delivery_date; solo off-plan. */
  handover_date: string | null;
  /** "primary" (venta nueva del developer) | "resale" | null. */
  sale_type: string | null;
  /** Fecha de publicación del anuncio en PF (ISO) — days on market. */
  listed_date: string | null;
  /** "chiller_free" | "district" | "dewa" | null — propiedad del edificio. */
  cooling_type_override: string | null;
  /** ISO de la primera comprobación que dio el anuncio por retirado; null = vivo. */
  unavailable_at: string | null;
  /** ISO de la última comprobación de disponibilidad (haya salido viva o no). */
  availability_checked_at: string | null;
}

/** Anuncio vivo que puede sustituir a uno retirado (resultado de la búsqueda). */
export interface ReplacementCandidate {
  id: string;
  url: string;
  title: string;
  price: number;
  size_sqft: number | null;
  bedrooms: number | null;
  price_per_sqft: number | null;
  image: string | null;
}

export interface ReplacementInfo {
  /** Búsqueda equivalente en propertyfinder.ae (se abre en pestaña nueva). */
  search_url: string;
  /** Qué se buscó, en texto: "Torre X · Studio · 340-460k". */
  scope: string;
  /** Total de anuncios que devuelve esa búsqueda en PF. */
  found_n: number;
  candidates: ReplacementCandidate[];
  searched_at: string;
}

export interface AnalysisRow {
  listing_id: string;
  gross_yield: number | null;
  asking_yield: number | null;
  median_rent: number | null;
  median_sale_price: number | null;
  rent_p25: number | null;
  rent_p75: number | null;
  sale_p25: number | null;
  sale_p75: number | null;
  rent_n: number;
  buy_n: number;
  gym_distance_m: number | null;
  gym_name: string | null;
  computed_at: string;
  service_charge_rate: number | null;
  service_charge_source: string | null;
  service_charges_annual: number | null;
  net_yield: number | null;
  loan_amount: number | null;
  monthly_payment: number | null;
  cash_upfront: number | null;
  cash_on_cash: number | null;
  /** 1/0/null — null cuando no se pudo evaluar. */
  dbr_ok: number | null;
  str_slug: string | null;
  str_annual_revenue_aed: number | null;
  str_vs_rent: number | null;
  str_hybrid_income_aed: number | null;
  str_pct_mortgage_covered: number | null;
  offplan_n: number | null;
  offplan_psqft: number | null;
  offplan_handover: string | null;
  future_psqft: number | null;
  appreciation_pct_yr: number | null;
  appreciation_pct_yr_bear: number | null;
  resale_premium: number | null;
  resale_dom_days: number | null;
  offplan_primary_psqft: number | null;
  offplan_resale_psqft: number | null;
  live_monthly_cost: number | null;
  live_monthly_delta: number | null;
  months_to_next: number | null;
  str_breakeven_adr: number | null;
  median_sale_psqft: number | null;
  sale_psqft_n: number;
  price_vs_median: number | null;
  price_vs_median_basis: string | null;
  /** AED/sqft de la curva de tendencia hoy, y descuento del anuncio frente a ella. */
  trend_psqft: number | null;
  discount_vs_trend: number | null;
  cooling_type: string | null;
  cooling_source: string | null;
  cooling_monthly_applied: number | null;
  rent_psqft_p25: number | null;
  rent_psqft_median: number | null;
  rent_psqft_p75: number | null;
  rent_psqft_n: number;
  rent_basis_months: number | null;
}

export interface YieldResult {
  gross_yield: number | null;
  asking_yield: number | null;
  median_rent: number | null;
  median_sale_price: number | null;
  median_sale_psqft: number | null;
  sale_psqft_n: number;
  /** + = pides por encima de la mediana de comparables; − = por debajo. */
  price_vs_median: number | null;
  /** "psqft" (normalizado, preferido) | "absoluto" (sin superficie) | null. */
  price_vs_median_basis: string | null;
  rent_p25: number | null;
  rent_p75: number | null;
  sale_p25: number | null;
  sale_p75: number | null;
  rent_n: number;
  buy_n: number;
}
