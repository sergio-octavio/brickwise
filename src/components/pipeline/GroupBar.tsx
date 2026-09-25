"use client";

import { useState } from "react";
import { FAVORITES_GROUP_ID } from "@/components/GroupsMenu";
import { GroupDto } from "@/lib/pipeline";

export default function GroupBar({
  groups,
  activeGroupId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropListing,
}: {
  groups: GroupDto[];
  activeGroupId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Soltar una tarjeta del tablero sobre un chip la añade a ese grupo. */
  onDropListing: (groupId: string, listingId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const chip = (active: boolean) =>
    `btn-font rounded-full px-3 py-1 text-xs font-medium transition ${
      active
        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={chip(activeGroupId === null)} onClick={() => onSelect(null)}>
        Todos
      </button>
      {groups.map((g) =>
        editingId === g.id ? (
          <form
            key={g.id}
            onSubmit={(e) => {
              e.preventDefault();
              if (editName.trim()) onRename(g.id, editName.trim());
              setEditingId(null);
            }}
          >
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => setEditingId(null)}
              onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
              className="w-36 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </form>
        ) : (
          <button
            key={g.id}
            className={`group/chip flex items-center gap-1.5 ${chip(activeGroupId === g.id)} ${
              dragOverId === g.id ? "ring-2 ring-blue-500" : ""
            }`}
            onClick={() => onSelect(activeGroupId === g.id ? null : g.id)}
            onDoubleClick={() => {
              if (g.id === FAVORITES_GROUP_ID) return; // grupo fijo: ni renombrar ni eliminar
              setEditingId(g.id);
              setEditName(g.name);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverId(g.id);
            }}
            onDragLeave={() => setDragOverId((v) => (v === g.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onDropListing(g.id, id);
            }}
            title={
              g.id === FAVORITES_GROUP_ID
                ? "Grupo fijo: el ★ del mapa y la ficha apuntan aquí · Suelta una tarjeta encima para añadirla"
                : "Doble clic para renombrar · Suelta una tarjeta encima para añadirla"
            }
          >
            {g.id === FAVORITES_GROUP_ID && "★ "}
            {g.name}
            <span className="opacity-60">{g.count}</span>
            {g.id !== FAVORITES_GROUP_ID && (
              <span
                role="button"
                className="hidden text-neutral-400 hover:text-red-500 group-hover/chip:inline"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`¿Eliminar el grupo "${g.name}"? Los inmuebles no se borran.`)) onDelete(g.id);
                }}
              >
                ✕
              </span>
            )}
          </button>
        )
      )}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
            setName("");
            setAdding(false);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setAdding(false)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="Nombre del grupo…"
            className="w-40 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </form>
      ) : (
        <button
          className="btn-font rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          onClick={() => setAdding(true)}
        >
          + Grupo
        </button>
      )}
    </div>
  );
}
