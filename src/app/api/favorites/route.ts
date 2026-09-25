import { NextRequest, NextResponse } from "next/server";
import { analyzeListing } from "@/lib/analyze";
import { ListingUnavailableError, findReplacements } from "@/lib/availability";
import {
  addFavorite,
  getListing,
  listFavorites,
  removeFavorite,
  replacementsByListing,
  setFavoriteNotes,
} from "@/lib/store";
import { recomputeAll } from "@/lib/recompute";

function serialize(rows: ReturnType<typeof listFavorites>) {
  const replacements = replacementsByListing();
  return rows.map((r) => ({
    ...r,
    images: JSON.parse(r.images_json),
    amenities: JSON.parse(r.amenities_json),
    // group_ids ya viene en la fila: el mapa pinta el ★ y el menú de grupos con él.
    replacement: r.unavailable_at ? replacements.get(r.id) ?? null : null,
  }));
}

export async function GET() {
  try {
    return NextResponse.json({ results: serialize(listFavorites()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Accepts any propertyfinder.ae listing URL and extracts the numeric listing id. */
function parseListingUrl(raw: string): { id: string; url: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL no válida");
  }
  if (!/(^|\.)propertyfinder\.ae$/.test(url.hostname)) {
    throw new Error("La URL debe ser de propertyfinder.ae");
  }
  const m = url.pathname.match(/-(\d+)\.html$/) || url.pathname.match(/\/(\d+)(?:\/)?$/);
  if (!m) throw new Error("No encuentro el id del anuncio en la URL (pega el enlace de la ficha del inmueble)");
  return { id: m[1], url: url.origin + url.pathname };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, url } = parseListingUrl(String(body.url || ""));
    // requireAvailable: los "guardados" de PF siguen listando anuncios ya
    // retirados. Se comprueba ANTES de darlo de alta para no meter fantasmas.
    const { listing, analysis } = await analyzeListing(id, url, { requireAvailable: true });
    addFavorite(listing.id);
    // Un off-plan nuevo cambia la revalorización estimada de los READY de su
    // zona: sin esto, sus análisis se quedan desfasados hasta el siguiente
    // recompute manual y unos anuncios muestran la estimación y otros no.
    if (listing.completion_status === "offplan") recomputeAll();
    return NextResponse.json({
      listing: { ...listing, images: JSON.parse(listing.images_json), amenities: JSON.parse(listing.amenities_json) },
      analysis,
    });
  } catch (e) {
    if (e instanceof ListingUnavailableError) {
      // No se añade, pero sí se busca el recambio: el objetivo del usuario no es
      // guardar ese anuncio, es encontrar el que lo sustituye.
      const listing = getListing(e.listingId);
      const replacement = listing ? await findReplacements(listing) : null;
      return NextResponse.json(
        {
          error: e.message,
          unavailable: true,
          id: e.listingId,
          title: listing?.title ?? null,
          replacement,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    setFavoriteNotes(String(body.id), String(body.notes ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new Error("id requerido");
    removeFavorite(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
