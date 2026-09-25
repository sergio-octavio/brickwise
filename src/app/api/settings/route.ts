import { NextRequest, NextResponse } from "next/server";
import { AppConfig, getConfig, resetConfig, saveConfig } from "@/lib/config";
import { recomputeAll } from "@/lib/recompute";

export async function GET() {
  return NextResponse.json({ config: getConfig() });
}

/** Guarda un parche de config y recalcula todos los análisis con los nuevos valores. */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { reset?: boolean; patch?: Partial<AppConfig> };
    const config = body.reset ? resetConfig() : saveConfig(body.patch ?? {});
    const updated = recomputeAll();
    return NextResponse.json({ config, updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
