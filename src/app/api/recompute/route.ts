import { NextResponse } from "next/server";
import { recomputeAll } from "@/lib/recompute";

/** Recompute every stored analysis from cached data (no scraping, no network). */
export async function POST() {
  try {
    return NextResponse.json({ updated: recomputeAll() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
