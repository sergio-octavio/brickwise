/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchListingPage } from "./pf/listing";
import { buildSearchUrl, scrapeSearchPage } from "./pf/search";
import { getDb } from "./db";
import {
  clearReplacement,
  getListing,
  getReplacement,
  saveReplacement,
  setListingAvailability,
} from "./store";
import { ListingRow, PfProperty, ReplacementCandidate, ReplacementInfo, SearchFilters } from "./types";

/** Banda de precio de la búsqueda de recambio alrededor del anuncio caído. */
const PRICE_BAND = 0.15;
const MAX_CANDIDATES = 6;

export interface AvailabilityCheck {
  id: string;
  /** true = sigue anunciado · false = retirado · null = no se pudo comprobar. */
  available: boolean | null;
  error?: string;
  unavailable_at?: string | null;
  replacement?: ReplacementInfo | null;
}

/** Error de "el anuncio ya no existe" que corta el alta de un favorito nuevo. */
export class ListingUnavailableError extends Error {
  readonly listingId: string;
  constructor(listingId: string) {
    super("El anuncio ya no está disponible en Property Finder");
    this.name = "ListingUnavailableError";
    this.listingId = listingId;
  }
}

function bedLabel(b: number | null): string {
  if (b == null) return "cualquier nº de hab";
  return b === 0 ? "Studio" : `${b} hab`;
}

function kFmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}K`;
}

/** PF devuelve price_per_area como número o como {price, unit} según la vista. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as { value?: unknown; price?: unknown };
    return toNum(o.value ?? o.price);
  }
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function sizeOf(p: PfProperty): number | null {
  const s: any = p.size;
  if (s == null) return null;
  const n = typeof s === "number" ? s : parseFloat(String(s.value ?? s));
  return Number.isFinite(n) ? n : null;
}

function bedsOf(p: PfProperty): number | null {
  if (p.bedrooms == null) return null;
  const s = String(p.bedrooms).toLowerCase();
  if (s === "studio") return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function propertyUrl(p: PfProperty): string {
  return p.share_url || `https://www.propertyfinder.ae${p.details_path || ""}`;
}

/**
 * Id de la comunidad (zona) del anuncio: el `path` de la torre es "1.109.9594…"
 * y el índice 1 es la comunidad. Sirve para ensanchar la búsqueda cuando en el
 * edificio no queda nada a la venta.
 */
function communityLocationId(l: ListingRow): string | null {
  const db = getDb();
  if (l.tower_id) {
    const tower = db.prepare(`SELECT path FROM locations WHERE id = ?`).get(l.tower_id) as
      | { path: string }
      | undefined;
    const communityId = tower?.path?.split(".")[1];
    if (communityId) return communityId;
  }
  if (l.community_slug) {
    const byslug = db.prepare(`SELECT id FROM locations WHERE slug = ? LIMIT 1`).get(l.community_slug) as
      | { id: string }
      | undefined;
    if (byslug?.id) return byslug.id;
  }
  return null;
}

function filtersFor(l: ListingRow, locationId: string): SearchFilters {
  return {
    locationId,
    minPrice: l.price > 0 ? Math.round(l.price * (1 - PRICE_BAND)) : undefined,
    maxPrice: l.price > 0 ? Math.round(l.price * (1 + PRICE_BAND)) : undefined,
    bedrooms: l.bedrooms != null ? [String(l.bedrooms)] : undefined,
  };
}

function scopeLabel(l: ListingRow, where: string): string {
  const band = l.price > 0 ? ` · ${kFmt(l.price * (1 - PRICE_BAND))}–${kFmt(l.price * (1 + PRICE_BAND))} AED` : "";
  return `${where} · ${bedLabel(l.bedrooms)}${band}`;
}

function toCandidates(props: PfProperty[], excludeId: string): ReplacementCandidate[] {
  return props
    .filter((p) => String(p.id) !== excludeId)
    .slice(0, MAX_CANDIDATES)
    .map((p) => {
      const size = sizeOf(p);
      const price = p.price?.value ?? 0;
      const images: any = p.images;
      const first = (Array.isArray(images) ? images : images?.property || [])[0];
      return {
        id: String(p.id),
        url: propertyUrl(p),
        title: p.title || "",
        price,
        size_sqft: size,
        bedrooms: bedsOf(p),
        price_per_sqft: toNum(p.price_per_area) ?? (size && price ? price / size : null),
        image: first?.small || first?.medium || null,
      };
    });
}

/**
 * Busca en PF anuncios equivalentes al que se ha caído: mismo edificio, mismas
 * habitaciones y ±15 % de precio. Si en el edificio no queda ninguno, ensancha
 * a la comunidad antes de rendirse — un enlace a una búsqueda vacía no sirve de
 * nada. Devuelve null solo si no hay ni torre ni comunidad conocidas.
 */
export async function findReplacements(l: ListingRow): Promise<ReplacementInfo | null> {
  const communityId = communityLocationId(l);
  const scopes: { locationId: string; where: string }[] = [];
  if (l.tower_id) scopes.push({ locationId: l.tower_id, where: l.tower_name || "Mismo edificio" });
  if (communityId && communityId !== l.tower_id) {
    scopes.push({ locationId: communityId, where: l.community_name || "Misma zona" });
  }
  if (!scopes.length) return null;

  let last: ReplacementInfo | null = null;
  for (const s of scopes) {
    const filters = filtersFor(l, s.locationId);
    const search_url = buildSearchUrl(filters, 1);
    const scope = scopeLabel(l, s.where);
    try {
      const res = await scrapeSearchPage(filters, 1);
      last = {
        search_url,
        scope,
        found_n: res.totalCount,
        candidates: toCandidates(res.properties, l.id),
        searched_at: "",
      };
      if (last.found_n > 0) break;
    } catch {
      // PF caído o cambio de layout: al menos deja el enlace de la búsqueda.
      last = last ?? { search_url, scope, found_n: 0, candidates: [], searched_at: "" };
    }
  }
  if (!last) return null;
  return saveReplacement(l.id, {
    search_url: last.search_url,
    scope: last.scope,
    found_n: last.found_n,
    candidates: last.candidates,
  });
}

/**
 * ¿Sigue publicado el anuncio? Descarga su ficha y lee el `isAvailable` de PF.
 * Al detectarlo retirado lanza además la búsqueda de recambio, para que el aviso
 * llegue con alternativas y no solo con un triángulo.
 *
 * No re-guarda los datos del anuncio aunque siga vivo: cambiar precio o tamaño
 * sin recalcular el análisis dejaría la ficha incoherente (eso es trabajo de
 * /api/listing/[id]?force=1).
 */
export async function checkListingAvailability(
  id: string,
  opts: { withReplacement?: boolean } = {}
): Promise<AvailabilityCheck> {
  const listing = getListing(id);
  if (!listing) return { id, available: null, error: "El anuncio no está en la base de datos" };

  let available: boolean;
  try {
    available = (await fetchListingPage(listing.url)).available;
  } catch (e) {
    // 404 = la ficha ya no existe (retirada de verdad). Cualquier otro fallo
    // (red, timeout, bloqueo) NO es prueba de nada: se deja sin marcar.
    if (!(e as { permanent?: boolean }).permanent) {
      return { id, available: null, error: (e as Error).message };
    }
    available = false;
  }

  setListingAvailability(id, available);
  if (available) {
    clearReplacement(id);
    return { id, available: true, unavailable_at: null, replacement: null };
  }

  const replacement =
    opts.withReplacement === false ? getReplacement(id) : await findReplacements(listing);
  return {
    id,
    available: false,
    unavailable_at: getListing(id)?.unavailable_at ?? null,
    replacement,
  };
}
