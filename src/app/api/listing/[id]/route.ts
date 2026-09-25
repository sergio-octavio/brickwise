import { NextRequest, NextResponse } from "next/server";
import { analyzeListing } from "@/lib/analyze";
import { getTransactions } from "@/lib/pf/transactions";
import { getAnalysis, getListing, getReplacement, nearestManualGym, setListingFinanceFlags } from "@/lib/store";
import { recomputeOne } from "@/lib/recompute";
import { getCachedStrMarket } from "@/lib/airroi";
import { getConfig } from "@/lib/config";
import { cachedPoisNear } from "@/lib/pois";
import { parseCoolingType } from "@/lib/coolingTypes";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = req.nextUrl.searchParams.get("url") || undefined;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const withTx = req.nextUrl.searchParams.get("tx") === "1";
  try {
    const { listing, analysis } = await analyzeListing(id, url, { force });
    // Nearest gym reflects the user's current saved gyms live (the analysis is
    // cached, so recompute it here instead of showing a stale value).
    const gym =
      listing.lat != null && listing.lon != null
        ? nearestManualGym(listing.lat, listing.lon)
        : { gym_name: null, distance_m: null };
    // Atractores a <1 km: SOLO de caché. Una consulta fría a Overpass tarda
    // >10 s y bloquearía la ficha entera; si falta, el cliente la pide aparte
    // a /api/attractors/[id] y la rellena cuando llega.
    let attractors: { cafes_1km: number; supers_1km: number } | null = null;
    if (listing.lat != null && listing.lon != null) {
      const cafes = cachedPoisNear(listing.lat, listing.lon, "cafe");
      const supers = cachedPoisNear(listing.lat, listing.lon, "super");
      if (cafes && supers) {
        attractors = {
          cafes_1km: cafes.filter((p) => p.distance_m <= 1000).length,
          supers_1km: supers.filter((p) => p.distance_m <= 1000).length,
        };
      }
    }
    return NextResponse.json({
      listing: {
        ...listing,
        images: JSON.parse(listing.images_json),
        amenities: JSON.parse(listing.amenities_json),
      },
      analysis: { ...analysis, gym_name: gym.gym_name, gym_distance_m: gym.distance_m },
      // Solo tiene sentido si el anuncio está retirado: es la búsqueda de recambio.
      replacement: listing.unavailable_at ? getReplacement(listing.id) : null,
      strMarket: analysis.str_slug ? getCachedStrMarket(analysis.str_slug) : null,
      attractors,
      config: getConfig(),
      transactions:
        withTx && listing.tower_slug
          ? {
              buy: getTransactions(listing.tower_slug, "buy"),
              rent: getTransactions(listing.tower_slug, "rent"),
            }
          : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Edita los campos financieros del anuncio y recalcula su análisis al vuelo. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as {
      service_charge_override?: number | null;
      dld_waiver?: boolean;
      second_home?: boolean | null;
      cooling_type_override?: unknown;
    };
    if (!getListing(id)) return NextResponse.json({ error: "listing not found" }, { status: 404 });
    const affected = setListingFinanceFlags(id, {
      service_charge_override: body.service_charge_override,
      dld_waiver: body.dld_waiver,
      second_home: body.second_home,
      // Nunca escribir en BD un string arbitrario del cliente.
      ...(body.cooling_type_override !== undefined
        ? { cooling_type_override: parseCoolingType(body.cooling_type_override) }
        : {}),
    });
    for (const a of affected) recomputeOne(a);
    return NextResponse.json({ listing: getListing(id), analysis: getAnalysis(id), affected: affected.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
