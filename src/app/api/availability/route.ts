import { NextRequest, NextResponse } from "next/server";
import { AvailabilityCheck, checkListingAvailability } from "@/lib/availability";
import { getListing } from "@/lib/store";

/**
 * Comprueba en PF si los anuncios siguen publicados. El cliente manda lotes
 * pequeños y va pintando el progreso: cada comprobación es una descarga de la
 * ficha y el cliente de PF está limitado a 1 petición/s, así que una tanda de
 * 400 favoritos son minutos, no segundos.
 */
const MAX_IDS = 10;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, MAX_IDS) : [];
    if (!ids.length) throw new Error("ids requerido");
    const results: AvailabilityCheck[] = [];
    for (const id of ids) {
      results.push(await checkListingAvailability(id));
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Estado guardado (sin tocar la red) de un anuncio concreto. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const l = getListing(id);
  if (!l) return NextResponse.json({ error: "listing not found" }, { status: 404 });
  return NextResponse.json({
    id,
    available: l.unavailable_at == null,
    unavailable_at: l.unavailable_at,
    checked_at: l.availability_checked_at,
  });
}
