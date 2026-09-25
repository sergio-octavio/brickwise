import { NextResponse } from "next/server";
import { getListing } from "@/lib/store";
import { poisNear } from "@/lib/pois";

/**
 * Atractores (cafeterías y súper/mall) a <1 km del anuncio. Va en su propia
 * ruta porque una consulta fría a Overpass tarda >10 s: la ficha carga al
 * instante con lo cacheado y rellena esto en cuanto llega.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const l = getListing(id);
    if (!l) return NextResponse.json({ error: "listing not found" }, { status: 404 });
    if (l.lat == null || l.lon == null) return NextResponse.json({ attractors: null });
    const [cafes, supers] = await Promise.all([poisNear(l.lat, l.lon, "cafe"), poisNear(l.lat, l.lon, "super")]);
    if (!cafes || !supers) return NextResponse.json({ attractors: null });
    return NextResponse.json({
      attractors: {
        cafes_1km: cafes.filter((p) => p.distance_m <= 1000).length,
        supers_1km: supers.filter((p) => p.distance_m <= 1000).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
