"use client";

import { useState } from "react";
import PipelineCard from "./PipelineCard";
import { PIPELINE_STATUSES, PipelineCardDto, PipelineStatus } from "@/lib/pipeline";
import { PinMetric } from "@/lib/metrics";

export default function Board({
  cards,
  metric,
  refreshingIds,
  onMove,
  onOpen,
  onRefreshContact,
}: {
  cards: PipelineCardDto[];
  metric: PinMetric;
  refreshingIds: Set<string>;
  onMove: (id: string, status: PipelineStatus) => void;
  onOpen: (id: string) => void;
  onRefreshContact: (id: string) => void;
}) {
  const [dragOverCol, setDragOverCol] = useState<PipelineStatus | null>(null);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
      {PIPELINE_STATUSES.map((col) => {
        const colCards = cards.filter((c) => c.status === col.id);
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol((v) => (v === col.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onMove(id, col.id);
            }}
            className={`flex min-w-[250px] flex-1 basis-0 flex-col rounded-2xl border bg-neutral-50 dark:bg-neutral-950 ${
              dragOverCol === col.id
                ? "border-blue-500"
                : "border-neutral-200 dark:border-neutral-800"
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
              <span className="text-xs font-bold">{col.label}</span>
              <span className="text-xs text-neutral-400">{colCards.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {colCards.map((c) => (
                <PipelineCard
                  key={c.id}
                  card={c}
                  metric={metric}
                  refreshing={refreshingIds.has(c.id)}
                  onOpen={() => onOpen(c.id)}
                  onMove={(status) => onMove(c.id, status)}
                  onRefreshContact={() => onRefreshContact(c.id)}
                />
              ))}
              {colCards.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-neutral-400">
                  Arrastra aquí un inmueble
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
