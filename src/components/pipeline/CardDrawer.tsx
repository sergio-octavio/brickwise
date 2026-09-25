"use client";

import Link from "next/link";
import ActivityLog from "./ActivityLog";
import { fmtAED } from "@/lib/format";
import { GroupDto, PipelineCardDto, emailLink, phoneLink, whatsappLink } from "@/lib/pipeline";

export default function CardDrawer({
  card,
  groups,
  onClose,
  onSetGroups,
  onActivityChanged,
}: {
  card: PipelineCardDto;
  groups: GroupDto[];
  onClose: () => void;
  onSetGroups: (groupIds: string[]) => void;
  onActivityChanged: () => void;
}) {
  const c = card.contact;
  const wa = whatsappLink(c);
  const tel = phoneLink(c);
  const mail = emailLink(c);
  const discount =
    card.last_offer_amount != null && card.price > 0
      ? ((card.price - card.last_offer_amount) / card.price) * 100
      : null;

  const bigBtn =
    "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col overflow-y-auto border-l border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        {/* Cabecera */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-snug">{card.title}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {card.tower_name || "—"} · {fmtAED(card.price)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
            ✕
          </button>
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <Link href={`/listing/${card.id}`} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
            Ver análisis
          </Link>
          <a href={card.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
            Property Finder ↗
          </a>
        </div>

        {/* Contacto */}
        <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Realtor</p>
          <p className="mt-1 text-sm font-semibold">{c.agent.name || "Agente desconocido"}</p>
          <p className="text-xs text-neutral-500">
            {[c.agent.position, c.broker.name].filter(Boolean).join(" · ") || "—"}
          </p>
          {c.agent.whatsapp_response_time != null && (
            <p className="mt-0.5 text-[11px] text-neutral-400">
              Responde WhatsApp en ~{c.agent.whatsapp_response_time} min
            </p>
          )}
          {c.hasRichContact ? (
            <div className="mt-2.5 flex gap-1.5">
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className={`${bigBtn} bg-green-600 text-white hover:bg-green-500`}>
                  WhatsApp
                </a>
              )}
              {tel && (
                <a href={tel} className={`${bigBtn} bg-blue-600 text-white hover:bg-blue-500`}>
                  Llamar
                </a>
              )}
              {mail && (
                <a href={mail} className={`${bigBtn} border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`}>
                  Email
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-neutral-400">
              Sin datos de contacto — usa «Actualizar contacto» en la tarjeta.
            </p>
          )}
        </div>

        {/* Grupos */}
        <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Grupos</p>
          {groups.length === 0 ? (
            <p className="mt-1 text-xs text-neutral-400">Crea un grupo desde la barra superior.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={card.group_ids.includes(g.id)}
                    onChange={(e) =>
                      onSetGroups(
                        e.target.checked
                          ? [...card.group_ids, g.id]
                          : card.group_ids.filter((id) => id !== g.id)
                      )
                    }
                  />
                  {g.name}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Resumen de oferta */}
        {card.last_offer_amount != null && (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Negociación</p>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <span className="text-neutral-500">Asking</span>
              <span className="text-right font-semibold">{fmtAED(card.price)}</span>
              <span className="text-neutral-500">Última oferta</span>
              <span className="text-right font-semibold">{fmtAED(card.last_offer_amount)}</span>
              {discount != null && (
                <>
                  <span className="text-neutral-500">Descuento</span>
                  <span className="text-right font-semibold text-amber-600 dark:text-amber-400">
                    −{discount.toFixed(1)}%
                  </span>
                </>
              )}
              {card.final_price != null && (
                <>
                  <span className="text-neutral-500">Precio final</span>
                  <span className="text-right font-bold text-green-600 dark:text-green-400">{fmtAED(card.final_price)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Actividad */}
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Actividad</p>
          {/* key: remount when switching listings so stale entries never flash */}
          <ActivityLog key={card.id} listingId={card.id} onChanged={onActivityChanged} />
        </div>
      </div>
    </>
  );
}
