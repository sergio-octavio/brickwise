import { NextRequest, NextResponse } from "next/server";
import { parseAgentJson } from "@/lib/agent";
import {
  PIPELINE_STATUS_IDS,
  PipelineStatus,
  listGroups,
  listPipeline,
  replacementsByListing,
  setFavoriteStatus,
  setListingGroups,
} from "@/lib/store";

export async function GET() {
  try {
    const replacements = replacementsByListing();
    const results = listPipeline().map((r) => ({
      ...r,
      images: JSON.parse(r.images_json),
      contact: parseAgentJson(r.agent_json),
      replacement: r.unavailable_at ? replacements.get(r.id) ?? null : null,
    }));
    return NextResponse.json({ results, groups: listGroups() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || "");
    if (!id) throw new Error("id requerido");
    if (body.status != null) {
      const status = String(body.status) as PipelineStatus;
      if (!PIPELINE_STATUS_IDS.includes(status)) throw new Error("Estado no válido");
      setFavoriteStatus(id, status);
    }
    if (Array.isArray(body.groupIds)) {
      setListingGroups(id, body.groupIds.map(String));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
