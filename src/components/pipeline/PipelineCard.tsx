"use client";

import { fmtAED } from "@/lib/format";
import { PinMetric, pinData } from "@/lib/metrics";
import {
  PIPELINE_STATUSES,
  PipelineCardDto,
  PipelineStatus,
  emailLink,
  phoneLink,
  relDate,
  whatsappLink,
} from "@/lib/pipeline";

const WA_SVG = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.5.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4 0-.2 0-.3-.1-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9s.8 2.2 1 2.4a9 9 0 0 0 3.4 3c.5.2.9.3 1.2.4.5.2 1 .1 1.3.1.4-.1 1.5-.6 1.7-1.2.2-.6.2-1 .1-1.2 0 0-.2-.1-.3-.1Z" />
  </svg>
);
const PHONE_SVG = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);
const MAIL_SVG = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </svg>
);

const ACTIVITY_LABEL: Record<string, string> = {
  llamada: "Llamada",
  visita: "Visita",
  oferta: "Oferta",
  nota: "Nota",
};

export default function PipelineCard({
  card,
  metric,
  refreshing,
  onOpen,
  onMove,
  onRefreshContact,
}: {
  card: PipelineCardDto;
  metric: PinMetric;
  refreshing: boolean;
  onOpen: () => void;
  onMove: (status: PipelineStatus) => void;
  onRefreshContact: () => void;
}) {
  const c = card.contact;
  const m = pinData(card, metric);
  const wa = whatsappLink(c);
  const tel = phoneLink(c);
  const mail = emailLink(c);
  const discount = card.last_offer_amount != null && card.price > 0 ? (card.price - card.last_offer_amount) / card.price : null;

  const contactBtn =
    "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold transition";

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
      onClick={onOpen}
      className="cursor-pointer rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm transition hover:border-neutral-300 hover:shadow dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
    >
      <div className="flex gap-2.5">
        {card.images?.[0]?.small && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.images[0].small}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
            draggable={false}
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold" title={card.title}>
            {card.title}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-neutral-500">
            {card.tower_name || "—"}
            {card.bedrooms != null && ` · ${card.bedrooms === 0 ? "Estudio" : `${card.bedrooms} hab`}`}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className="font-bold">{fmtAED(card.price)}</span>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ background: m.color }}
            >
              {m.text}
            </span>
            {card.unavailable_at && (
              // Retirado de PF: no tiene sentido llamar al agente por él. El ⚠
              // abre la búsqueda del recambio en otra pestaña.
              <a
                href={card.replacement?.search_url ?? card.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Ya no está publicado en Property Finder${card.replacement ? ` · ${card.replacement.found_n} equivalentes: ${card.replacement.scope}` : ""}. Pulsa para buscar el recambio.`}
                className="btn-font rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/30 dark:text-amber-400"
              >
                ⚠ Retirado
              </a>
            )}
          </p>
          {(card.net_yield != null || card.cash_on_cash != null) && (
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {card.net_yield != null && `neta ${(card.net_yield * 100).toFixed(1)}%`}
              {card.net_yield != null && card.cash_on_cash != null && " · "}
              {card.cash_on_cash != null && `CoC ${(card.cash_on_cash * 100).toFixed(1)}%`}
            </p>
          )}
        </div>
      </div>

      {/* Realtor + contacto */}
      <div className="mt-2 flex items-center gap-1.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
        <p className="min-w-0 flex-1 truncate text-[11px] text-neutral-600 dark:text-neutral-300">
          {c.agent.name || "Agente desconocido"}
          {c.broker.name && <span className="text-neutral-400"> · {c.broker.name}</span>}
        </p>
        {c.hasRichContact ? (
          <span className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" title="WhatsApp" className={`${contactBtn} bg-green-600/10 text-green-700 hover:bg-green-600/20 dark:text-green-400`}>
                {WA_SVG}
              </a>
            )}
            {tel && (
              <a href={tel} title="Llamar" className={`${contactBtn} bg-blue-600/10 text-blue-700 hover:bg-blue-600/20 dark:text-blue-400`}>
                {PHONE_SVG}
              </a>
            )}
            {mail && (
              <a href={mail} title="Email" className={`${contactBtn} bg-neutral-500/10 text-neutral-600 hover:bg-neutral-500/20 dark:text-neutral-300`}>
                {MAIL_SVG}
              </a>
            )}
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshContact();
            }}
            disabled={refreshing}
            className="shrink-0 rounded-md bg-blue-600/10 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-600/20 disabled:opacity-50 dark:text-blue-400"
          >
            {refreshing ? "Actualizando…" : "Actualizar contacto"}
          </button>
        )}
      </div>

      {/* Pie: estado + actividad + oferta */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500" onClick={(e) => e.stopPropagation()}>
        <select
          value={card.status}
          onChange={(e) => onMove(e.target.value as PipelineStatus)}
          className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[10px] outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          {PIPELINE_STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {card.last_activity_at && (
          <span className="truncate">
            {ACTIVITY_LABEL[card.last_activity_type || ""] || "Actividad"} {relDate(card.last_activity_at)}
          </span>
        )}
        {card.last_offer_amount != null && (
          <span className="ml-auto shrink-0 font-semibold text-amber-600 dark:text-amber-400">
            {fmtAED(card.last_offer_amount)}
            {discount != null && ` (−${(discount * 100).toFixed(1)}%)`}
          </span>
        )}
      </div>
    </div>
  );
}
