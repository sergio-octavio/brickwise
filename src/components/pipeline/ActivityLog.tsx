"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtAED, fmtDate } from "@/lib/format";

interface Activity {
  id: string;
  type: "llamada" | "visita" | "oferta" | "nota";
  note: string;
  amount: number | null;
  offer_kind: "oferta" | "contraoferta" | "final" | null;
  happened_at: string;
}

const TYPE_META: Record<Activity["type"], { label: string; icon: string }> = {
  llamada: { label: "Llamada", icon: "📞" },
  visita: { label: "Visita", icon: "🏠" },
  oferta: { label: "Oferta", icon: "💰" },
  nota: { label: "Nota", icon: "📝" },
};

const OFFER_KIND_LABEL = { oferta: "Oferta", contraoferta: "Contraoferta", final: "Precio final" };

export default function ActivityLog({
  listingId,
  onChanged,
}: {
  listingId: string;
  /** Notify the board so card summaries (last activity, offer) stay in sync. */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [type, setType] = useState<Activity["type"]>("llamada");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [offerKind, setOfferKind] = useState<"oferta" | "contraoferta" | "final">("oferta");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/activities?listingId=${listingId}`)
        .then((r) => r.json())
        .then((data) => setItems(data.results ?? [])),
    [listingId]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          type,
          note,
          happenedAt: date,
          ...(type === "oferta" ? { amount: Number(amount), offerKind } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      setNote("");
      setAmount("");
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/activities?id=${id}`, { method: "DELETE" });
    await load();
    onChanged();
  }

  const input =
    "rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950";

  return (
    <div>
      <form onSubmit={submit} className="rounded-xl border border-neutral-200 p-2.5 dark:border-neutral-800">
        <div className="flex gap-1.5">
          {(Object.keys(TYPE_META) as Activity["type"][]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`btn-font rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                type === t
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          {type === "oferta" && (
            <>
              <input
                type="number"
                min="1"
                placeholder="Importe AED"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className={`${input} w-28 min-w-0 flex-1`}
              />
              <select value={offerKind} onChange={(e) => setOfferKind(e.target.value as typeof offerKind)} className={input}>
                <option value="oferta">Oferta</option>
                <option value="contraoferta">Contraoferta</option>
                <option value="final">Precio final</option>
              </select>
            </>
          )}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={type === "oferta" ? "Detalles de la oferta…" : "¿Qué ha pasado?…"}
          className={`${input} mt-2 h-14 w-full resize-none`}
        />
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || (type === "oferta" && !amount)}
          className="mt-2 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Registrar {TYPE_META[type].label.toLowerCase()}
        </button>
      </form>

      <div className="mt-3 flex flex-col gap-1.5">
        {items === null && <p className="text-xs text-neutral-400">Cargando…</p>}
        {items?.length === 0 && <p className="text-xs text-neutral-400">Sin actividad todavía.</p>}
        {items?.map((a) => (
          <div key={a.id} className="group flex items-start gap-2 rounded-lg bg-neutral-50 px-2.5 py-2 dark:bg-neutral-950">
            <span className="text-sm leading-5">{TYPE_META[a.type].icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold">
                {a.type === "oferta" && a.offer_kind
                  ? OFFER_KIND_LABEL[a.offer_kind]
                  : TYPE_META[a.type].label}
                {a.amount != null && <span className="text-amber-600 dark:text-amber-400"> · {fmtAED(a.amount)}</span>}
                <span className="ml-1.5 font-normal text-neutral-400">{fmtDate(a.happened_at)}</span>
              </p>
              {a.note && <p className="mt-0.5 whitespace-pre-line text-[11px] text-neutral-600 dark:text-neutral-300">{a.note}</p>}
            </div>
            <button
              onClick={() => remove(a.id)}
              title="Eliminar"
              className="hidden text-xs text-neutral-400 hover:text-red-500 group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
