import { fetchPfPage } from "./client";
import { extractPageProps } from "./parse";
import { PfProperty } from "../types";

export interface ListingDetail {
  property: PfProperty;
  citySlug: string;
  /** false = PF ya no sirve el anuncio como activo (retirado/vendido). */
  available: boolean;
}

export interface ListingPage {
  property: PfProperty | null;
  citySlug: string;
  available: boolean;
}

/**
 * Descarga la ficha SIN exigir que el anuncio siga vivo.
 *
 * PF sigue devolviendo 200 y el `property` completo de un anuncio retirado; lo
 * que cambia es `pageProps.isAvailable = false` (y `propertyResult.meta
 * .deleted_property` trae la búsqueda equivalente). Un id inexistente ni
 * siquiera llega aquí: PF redirige a una página de búsqueda, así que no hay
 * `propertyResult` — también cuenta como no disponible.
 */
export async function fetchListingPage(url: string): Promise<ListingPage> {
  const html = await fetchPfPage(url);
  const pp = extractPageProps(html);
  const property = pp.propertyResult?.property ?? null;
  return {
    property,
    citySlug: pp.citySlug || "dubai",
    available: property != null && pp.isAvailable !== false,
  };
}

export async function scrapeListing(url: string): Promise<ListingDetail> {
  const page = await fetchListingPage(url);
  if (!page.property) throw new Error(`propertyResult.property missing for ${url}`);
  return { property: page.property, citySlug: page.citySlug, available: page.available };
}
