import { NextRequest, NextResponse } from "next/server";
import { createGroup, deleteGroup, isFavorite, listGroups, listingGroupIds, renameGroup } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const listingId = req.nextUrl.searchParams.get("listingId");
    if (listingId) {
      // Membresía de un listing concreto (para el ★/dropdown de mapa y ficha).
      return NextResponse.json({
        results: listGroups(),
        memberIds: listingGroupIds(listingId),
        saved: isFavorite(listingId),
      });
    }
    return NextResponse.json({ results: listGroups() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) throw new Error("El nombre del grupo no puede estar vacío");
    return NextResponse.json({ group: createGroup(name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!body.id || !name) throw new Error("id y nombre requeridos");
    renameGroup(String(body.id), name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new Error("id requerido");
    deleteGroup(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
