import { NextRequest, NextResponse } from "next/server";
import { ActivityType, OfferKind, addActivity, deleteActivity, listActivities } from "@/lib/store";

const TYPES: ActivityType[] = ["llamada", "visita", "oferta", "nota"];
const OFFER_KINDS: OfferKind[] = ["oferta", "contraoferta", "final"];

export async function GET(req: NextRequest) {
  try {
    const listingId = req.nextUrl.searchParams.get("listingId");
    if (!listingId) throw new Error("listingId requerido");
    return NextResponse.json({ results: listActivities(listingId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const listingId = String(body.listingId || "");
    const type = String(body.type || "") as ActivityType;
    if (!listingId) throw new Error("listingId requerido");
    if (!TYPES.includes(type)) throw new Error("Tipo de actividad no válido");
    let amount: number | null = null;
    let offerKind: OfferKind | null = null;
    if (type === "oferta") {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Importe de la oferta requerido");
      offerKind = OFFER_KINDS.includes(body.offerKind) ? body.offerKind : "oferta";
    }
    const activity = addActivity({
      listing_id: listingId,
      type,
      note: String(body.note ?? ""),
      amount,
      offer_kind: offerKind,
      happened_at: body.happenedAt ? String(body.happenedAt) : undefined,
    });
    return NextResponse.json({ activity });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new Error("id requerido");
    deleteActivity(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
