import { NextRequest, NextResponse } from "next/server";
import {
  deleteZoneServiceCharge,
  listZoneServiceCharges,
  upsertZoneServiceCharge,
} from "@/lib/serviceCharges";
import { listStrZoneMap, upsertStrZoneMap } from "@/lib/airroi";
import { mollakStatus } from "@/lib/mollak";
import { recomputeAll } from "@/lib/recompute";

export async function GET() {
  return NextResponse.json({ zones: listZoneServiceCharges(), strMap: listStrZoneMap(), mollak: mollakStatus() });
}

/** Upserta tasas por zona y/o mapeos STR y recalcula los análisis. */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      zones?: { slug: string; name: string; rate: number }[];
      deleteZones?: string[];
      strMap?: { community_slug: string; airroi_slug: string }[];
    };
    for (const z of body.zones ?? []) {
      if (z.slug && Number.isFinite(z.rate) && z.rate > 0) upsertZoneServiceCharge(z.slug, z.name || z.slug, z.rate);
    }
    for (const slug of body.deleteZones ?? []) deleteZoneServiceCharge(slug);
    for (const m of body.strMap ?? []) {
      if (m.community_slug && m.airroi_slug) upsertStrZoneMap(m.community_slug, m.airroi_slug);
    }
    const updated = recomputeAll();
    return NextResponse.json({ zones: listZoneServiceCharges(), strMap: listStrZoneMap(), updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
