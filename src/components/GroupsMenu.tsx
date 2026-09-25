"use client";

import { useEffect, useRef, useState } from "react";

export const FAVORITES_GROUP_ID = "favoritos";

interface Group {
  id: string;
  name: string;
  count: number;
}

/**
 * ★ (grupo fijo Favoritos) + dropdown de grupos del pipeline, para usar fuera
 * del tablero (mapa y ficha). Con `groupIds` funciona sin red al montar; sin él,
 * consulta la membresía (y si el listing ni siquiera está guardado, no pinta nada).
 */
export default function GroupsMenu({
  listingId,
  groupIds,
  onChanged,
  onSavedState,
}: {
  listingId: string;
  groupIds?: string[];
  onChanged?: (ids: string[]) => void;
  /** Informa si el listing está en favoritos (solo en modo auto-consulta). */
  onSavedState?: (saved: boolean) => void;
}) {
  // Estado derivado: la mutación local pisa a la prop, y la prop a lo consultado.
  const [override, setOverride] = useState<string[] | null>(null);
  const [fetched, setFetched] = useState<{ ids: string[]; saved: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [newName, setNewName] = useState("");
  const fetchedRef = useRef(false);

  const ids = override ?? groupIds ?? fetched?.ids ?? null;
  const saved = groupIds != null || (fetched?.saved ?? false);

  // Sin groupIds (ficha): membresía + saved en una llamada.
  useEffect(() => {
    if (groupIds != null || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch(`/api/groups?listingId=${listingId}`)
      .then((r) => r.json())
      .then((j) => {
        setFetched({ ids: j.memberIds ?? [], saved: Boolean(j.saved) });
        setGroups(j.results ?? []);
        onSavedState?.(Boolean(j.saved));
      })
      .catch(() => {});
  }, [groupIds, listingId, onSavedState]);

  const loadGroups = () =>
    fetch("/api/groups")
      .then((r) => r.json())
      .then((j) => setGroups(j.results ?? []))
      .catch(() => {});

  const persist = (next: string[]) => {
    setOverride(next);
    onChanged?.(next);
    fetch("/api/pipeline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: listingId, groupIds: next }),
    });
  };

  const toggle = (gid: string) => {
    if (ids == null) return;
    persist(ids.includes(gid) ? ids.filter((x) => x !== gid) : [...ids, gid]);
  };

  const createAndAssign = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json();
    if (res.ok && j.group) {
      setGroups((gs) => [...(gs ?? []), j.group]);
      if (ids != null) persist([...ids, j.group.id]);
    }
  };

  if (!saved || ids == null) return null;
  const isFav = ids.includes(FAVORITES_GROUP_ID);

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        onClick={() => toggle(FAVORITES_GROUP_ID)}
        title={isFav ? "Quitar de Favoritos" : "Añadir a Favoritos"}
        className={`text-sm leading-none transition ${
          isFav ? "text-amber-500 hover:text-amber-600" : "text-neutral-400 hover:text-amber-500"
        }`}
      >
        {isFav ? "★" : "☆"}
      </button>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!groups) loadGroups();
        }}
        title="Grupos del pipeline"
        className="btn-font rounded-md px-1 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        Grupos{ids.length > 0 ? ` (${ids.length})` : ""} ▾
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-1.5 text-left shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {groups == null ? (
              <p className="px-2 py-1 text-[11px] text-neutral-400">Cargando…</p>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <input type="checkbox" checked={ids.includes(g.id)} onChange={() => toggle(g.id)} />
                    <span className="min-w-0 flex-1 truncate">
                      {g.id === FAVORITES_GROUP_ID ? "★ " : ""}
                      {g.name}
                    </span>
                    <span className="text-[10px] text-neutral-400">{g.count}</span>
                  </label>
                ))}
              </div>
            )}
            <form
              className="mt-1 flex gap-1 border-t border-neutral-100 pt-1.5 dark:border-neutral-800"
              onSubmit={(e) => {
                e.preventDefault();
                createAndAssign();
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nuevo grupo…"
                className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-1 text-[11px] outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Crear
              </button>
            </form>
          </div>
        </>
      )}
    </span>
  );
}
