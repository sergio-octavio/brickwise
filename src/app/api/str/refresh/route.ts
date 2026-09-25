import { NextRequest, NextResponse } from "next/server";
import { AIRROI_DUBAI_SLUGS, getStrMarket, listStrMarkets, listStrZoneMap } from "@/lib/airroi";
import { recomputeAll } from "@/lib/recompute";

export async function GET() {
  return NextResponse.json({ markets: listStrMarkets() });
}

/** Refresca los datos AirROI (uno o todos los submercados) y recalcula. */
export async function POST(req: NextRequest) {
  try {
    const only = req.nextUrl.searchParams.get("slug");
    const slugs = only
      ? [only]
      : [...new Set([...AIRROI_DUBAI_SLUGS, ...listStrZoneMap().map((m) => m.airroi_slug)])];
    const refreshed: string[] = [];
    for (const slug of slugs) {
      const row = await getStrMarket(slug, true);
      if (row) refreshed.push(slug);
    }
    const updated = recomputeAll();
    return NextResponse.json({ refreshed, updated, markets: listStrMarkets() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
