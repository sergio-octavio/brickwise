import { NextResponse } from "next/server";
import { mollakStatus, syncMollak } from "@/lib/mollak";
import { recomputeAll } from "@/lib/recompute";

export async function GET() {
  return NextResponse.json({ status: mollakStatus() });
}

/** Descarga el dataset Mollak de Dubai Pulse (o su snapshot) y recalcula. */
export async function POST() {
  try {
    const result = await syncMollak();
    const updated = recomputeAll();
    return NextResponse.json({ ...result, updated, status: mollakStatus() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
