"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Board from "@/components/pipeline/Board";
import CardDrawer from "@/components/pipeline/CardDrawer";
import GroupBar from "@/components/pipeline/GroupBar";
import { GroupDto, PipelineCardDto, PipelineStatus } from "@/lib/pipeline";
import { PIN_METRICS, PinMetric, pinData } from "@/lib/metrics";

type SortId = "metric" | "neta" | "bruta" | "coc" | "precio-asc" | "precio-desc" | "psqft" | "actividad" | "added";

const SORTS: { id: SortId; label: string }[] = [
  { id: "metric", label: "Métrica mostrada" },
  { id: "neta", label: "Rent. neta" },
  { id: "bruta", label: "Rent. bruta" },
  { id: "coc", label: "CoC" },
  { id: "precio-asc", label: "Precio ↑" },
  { id: "precio-desc", label: "Precio ↓" },
  { id: "psqft", label: "AED/sqft ↑" },
  { id: "actividad", label: "Actividad reciente" },
  { id: "added", label: "Añadido" },
];

// La tarjeta ya es una ficha: esa métrica combinada no aplica aquí.
const CARD_METRICS = PIN_METRICS.filter((m) => m.id !== "ficha");

/** Mayor = antes en la columna; null = al final. */
function sortValue(c: PipelineCardDto, sortBy: SortId, metric: PinMetric): number | null {
  switch (sortBy) {
    case "metric":
      return pinData(c, metric).v;
    case "neta":
      return c.net_yield;
    case "bruta":
      return c.asking_yield;
    case "coc":
      return c.cash_on_cash;
    case "precio-asc":
      return -c.price;
    case "precio-desc":
      return c.price;
    case "psqft":
      return c.price_per_sqft != null ? -c.price_per_sqft : null;
    case "actividad":
      return c.last_activity_at ? Date.parse(c.last_activity_at) : null;
    case "added":
      return Date.parse(c.added_at);
  }
}

export default function PipelinePage() {
  const [cards, setCards] = useState<PipelineCardDto[] | null>(null);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkAbort = useRef(false);
  // Persistidas como la métrica de los pines del mapa: sobreviven recargas.
  const [metric, setMetric] = useState<PinMetric>(() => {
    if (typeof window === "undefined") return "neta";
    const saved = localStorage.getItem("bw-pipeline-metric") as PinMetric | null;
    return saved && CARD_METRICS.some((m) => m.id === saved) ? saved : "neta";
  });
  const [sortBy, setSortBy] = useState<SortId>(() => {
    if (typeof window === "undefined") return "metric";
    const saved = localStorage.getItem("bw-pipeline-sort") as SortId | null;
    return saved && SORTS.some((s) => s.id === saved) ? saved : "metric";
  });
  useEffect(() => {
    localStorage.setItem("bw-pipeline-metric", metric);
  }, [metric]);
  useEffect(() => {
    localStorage.setItem("bw-pipeline-sort", sortBy);
  }, [sortBy]);

  const load = useCallback(
    () =>
      fetch("/api/pipeline")
        .then((r) => r.json())
        .then((data) => {
          setCards(data.results ?? []);
          setGroups(data.groups ?? []);
        }),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const moveCard = useCallback(
    async (id: string, status: PipelineStatus) => {
      let prev: PipelineStatus | undefined;
      setCards((cs) =>
        cs?.map((c) => {
          if (c.id !== id) return c;
          prev = c.status;
          return { ...c, status };
        }) ?? null
      );
      const res = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok && prev) {
        const rollback = prev;
        setCards((cs) => cs?.map((c) => (c.id === id ? { ...c, status: rollback } : c)) ?? null);
      }
    },
    []
  );

  const setCardGroups = useCallback(async (id: string, groupIds: string[]) => {
    setCards((cs) => cs?.map((c) => (c.id === id ? { ...c, group_ids: groupIds } : c)) ?? null);
    await fetch("/api/pipeline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, groupIds }),
    });
    // Refresca contadores de grupos sin recargar el tablero entero.
    const res = await fetch("/api/pipeline");
    const data = await res.json();
    setGroups(data.groups ?? []);
  }, []);

  const refreshContact = useCallback(async (id: string) => {
    setRefreshingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/listing/${id}?force=1`);
      if (res.ok) {
        const fresh = await fetch("/api/pipeline").then((r) => r.json());
        setCards(fresh.results ?? []);
      }
    } finally {
      setRefreshingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }, []);

  /** Soltar una tarjeta sobre el chip de un grupo la añade (sin quitarla de otros). */
  const assignToGroup = useCallback(
    (groupId: string, listingId: string) => {
      const card = cards?.find((c) => c.id === listingId);
      if (!card || card.group_ids.includes(groupId)) return;
      setCardGroups(listingId, [...card.group_ids, groupId]);
    },
    [cards, setCardGroups]
  );

  const visible = useMemo(() => {
    const filtered = (cards ?? []).filter((c) => activeGroupId === null || c.group_ids.includes(activeGroupId));
    // Descendente, nulls al final; el desempate mantiene el orden de la API.
    return filtered
      .map((c, i) => ({ c, v: sortValue(c, sortBy, metric), i }))
      .sort((a, b) => {
        if (a.v == null && b.v == null) return a.i - b.i;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return b.v - a.v || a.i - b.i;
      })
      .map((x) => x.c);
  }, [cards, activeGroupId, sortBy, metric]);
  // Sin contacto rico O sin el token del WhatsApp oficial: ambos se re-scrapean.
  const staleIds = useMemo(
    () => visible.filter((c) => !c.contact.hasRichContact || !c.contact.pf_token).map((c) => c.id),
    [visible]
  );

  const refreshAllContacts = useCallback(async () => {
    bulkAbort.current = false;
    setBulkProgress({ done: 0, total: staleIds.length });
    setRefreshingIds(new Set(staleIds));
    let done = 0;
    for (const id of staleIds) {
      if (bulkAbort.current) break;
      try {
        await fetch(`/api/listing/${id}?force=1`);
      } catch {}
      done += 1;
      setBulkProgress({ done, total: staleIds.length });
      setRefreshingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await new Promise((r) => setTimeout(r, 500));
    }
    setRefreshingIds(new Set());
    setBulkProgress(null);
    await load();
  }, [staleIds, load]);

  useEffect(() => () => void (bulkAbort.current = true), []);

  async function createGroup(name: string) {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) setGroups((gs) => [...gs, data.group]);
  }

  async function renameGroup(id: string, name: string) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name } : g)));
    await fetch("/api/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
  }

  async function deleteGroup(id: string) {
    setGroups((gs) => gs.filter((g) => g.id !== id));
    setActiveGroupId((v) => (v === id ? null : v));
    setCards((cs) => cs?.map((c) => ({ ...c, group_ids: c.group_ids.filter((g) => g !== id) })) ?? null);
    await fetch(`/api/groups?id=${id}`, { method: "DELETE" });
  }

  const drawerCard = drawerId ? cards?.find((c) => c.id === drawerId) ?? null : null;

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-[1800px] flex-col px-4 pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">Pipeline</h1>
        <GroupBar
          groups={groups}
          activeGroupId={activeGroupId}
          onSelect={setActiveGroupId}
          onCreate={createGroup}
          onRename={renameGroup}
          onDelete={deleteGroup}
          onDropListing={assignToGroup}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          Ver
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as PinMetric)}
            className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs font-medium outline-none dark:border-neutral-700 dark:bg-neutral-950"
          >
            {CARD_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          Orden
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortId)}
            className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs font-medium outline-none dark:border-neutral-700 dark:bg-neutral-950"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto">
          {bulkProgress ? (
            <span className="text-xs text-neutral-500">
              Refrescando contactos… {bulkProgress.done}/{bulkProgress.total}
            </span>
          ) : (
            staleIds.length > 0 && (
              <button
                onClick={refreshAllContacts}
                className="btn-font rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Refrescar contactos ({staleIds.length})
              </button>
            )
          )}
        </div>
      </div>

      {cards === null ? (
        <p className="py-10 text-center text-sm text-neutral-400">Cargando…</p>
      ) : cards.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">
          No hay inmuebles en el pipeline. Añade favoritos desde «Favoritos + Mapa» y aparecerán aquí como Pendiente.
        </p>
      ) : (
        <Board
          cards={visible}
          metric={metric}
          refreshingIds={refreshingIds}
          onMove={moveCard}
          onOpen={setDrawerId}
          onRefreshContact={refreshContact}
        />
      )}

      {drawerCard && (
        <CardDrawer
          card={drawerCard}
          groups={groups}
          onClose={() => setDrawerId(null)}
          onSetGroups={(ids) => setCardGroups(drawerCard.id, ids)}
          onActivityChanged={load}
        />
      )}
    </div>
  );
}
