"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import YieldBadge from "@/components/YieldBadge";
import GroupsMenu from "@/components/GroupsMenu";
import TransactionsTable from "@/components/TransactionsTable";
import PsqftChart from "@/components/PsqftChart";
import ReformScenario from "@/components/ReformScenario";
import { fmtAED, fmtDist, fmtPct, fmtSqft } from "@/lib/format";
import { AnalysisRow, ReplacementInfo } from "@/lib/types";
import { computeFinance, computeResidencePlan, demandSignal, meetsBuyCriteria } from "@/lib/finance";
import { isPriceOutlier, OUTLIER_HELP, priceSignalColor, priceSignalText, priceVerdict } from "@/lib/priceSignal";
import { COOLING_HELP, COOLING_LABEL, CoolingType } from "@/lib/coolingTypes";
import type { AppConfig } from "@/lib/config";
import { TxRow } from "@/lib/pf/transactions";
import { discountVsTrend, psqftTrend } from "@/lib/trend";

interface Detail {
  listing: {
    id: string;
    url: string;
    title: string;
    price: number;
    size_sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    property_type: string;
    tower_name: string | null;
    tower_slug: string | null;
    community_slug: string | null;
    community_name: string | null;
    service_charge_override: number | null;
    dld_waiver: number;
    second_home: number | null;
    completion_status: string | null;
    handover_date: string | null;
    sale_type: string | null;
    listed_date: string | null;
    cooling_type_override: string | null;
    lat: number | null;
    lon: number | null;
    description: string | null;
    unavailable_at: string | null;
    images: { small: string; medium: string }[];
    amenities: string[];
  };
  analysis: AnalysisRow;
  /** Búsqueda de recambio en PF; solo llega si el anuncio está retirado. */
  replacement: ReplacementInfo | null;
  strMarket: {
    slug: string;
    adr_usd: number | null;
    occupancy: number | null;
    annual_revenue_usd: number | null;
    peak_adr_usd: number | null;
    peak_occupancy: number | null;
    fetched_at: string;
  } | null;
  attractors: { cafes_1km: number; supers_1km: number } | null;
  config: AppConfig;
  transactions: { buy: TxRow[]; rent: TxRow[] } | null;
}

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [faved, setFaved] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  const addFavorite = async () => {
    if (!data) return;
    setFavError(null);
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: data.listing.url }),
    });
    if (!res.ok) {
      // 409 = retirado de PF: no se guarda y se dice por qué (antes se marcaba
      // "Guardado" aunque el alta hubiese fallado).
      const j = await res.json().catch(() => ({}));
      setFavError(j.error || `No se pudo guardar (HTTP ${res.status})`);
      return;
    }
    setFaved(true);
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/listing/${id}?tx=1`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (!alive) return;
        setData(j);
        // Los atractores vienen solo de caché; si faltan, se piden aparte
        // (Overpass tarda >10 s en frío) y se rellenan al llegar.
        if (j.attractors == null) {
          fetch(`/api/attractors/${id}`)
            .then((r2) => r2.json())
            .then((a) => {
              if (alive && a?.attractors) setData((d) => (d ? { ...d, attractors: a.attractors } : d));
            })
            .catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  // Discount of the asking price vs the sale trend (same trend line as the chart).
  const discount = useMemo(() => {
    if (!data) return null;
    const { listing, transactions } = data;
    const trend = psqftTrend(transactions?.buy ?? [], listing.size_sqft, listing.bedrooms);
    const askingPsqft = listing.size_sqft ? listing.price / listing.size_sqft : null;
    return discountVsTrend(trend, askingPsqft);
  }, [data]);

  if (error)
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">Error: {error}</div>
      </div>
    );
  if (!data)
    return (
      <p className="mx-auto w-full max-w-7xl animate-pulse px-4 py-6 text-neutral-500">
        Cargando análisis (scrapeando si es necesario)…
      </p>
    );

  const { listing, analysis, strMarket, attractors, config, transactions } = data;
  const images = listing.images || [];
  const signal = demandSignal(analysis.resale_premium, analysis.resale_dom_days);
  const priceOpts = {
    premiumBad: config.price_premium_bad,
    discountGood: config.price_discount_good,
    minN: config.price_min_sale_n,
  };
  const verdict = meetsBuyCriteria(analysis, config);
  // Momentum: revalorización estimada positiva con suficientes off-plan
  // comparables. Solo mejora un "✓ Compra" — nunca convierte un piso con mal
  // cash-flow en compra.
  const momentum =
    verdict === true &&
    analysis.appreciation_pct_yr != null &&
    analysis.appreciation_pct_yr > 0 &&
    (analysis.offplan_n ?? 0) >= config.momentum_min_projects &&
    signal !== "debil";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      {listing.unavailable_at != null && (
        // El análisis de abajo sigue siendo válido como referencia de la zona,
        // pero este anuncio concreto ya no se puede comprar: el ⚠ lleva a la
        // búsqueda equivalente en PF.
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <a
            href={data.replacement?.search_url ?? listing.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Buscar el recambio en Property Finder (pestaña nueva)"
            className="text-xl leading-none text-amber-600 hover:scale-110 dark:text-amber-400"
          >
            ⚠
          </a>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              Property Finder ya no publica este anuncio
            </p>
            <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
              {data.replacement
                ? `${data.replacement.found_n} anuncio${data.replacement.found_n === 1 ? "" : "s"} equivalente${data.replacement.found_n === 1 ? "" : "s"}: ${data.replacement.scope}`
                : "Los números siguen sirviendo como referencia de la zona, pero esta unidad ya no está a la venta."}
            </p>
          </div>
          {data.replacement && (
            <a
              href={data.replacement.search_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-font rounded bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
            >
              Buscar recambio en PF ↗
            </a>
          )}
        </div>
      )}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{listing.title}</h1>
          <YieldBadge value={analysis.asking_yield} n={analysis.rent_n} />
          {verdict != null && (
            <span
              className={`btn-font rounded-full px-2.5 py-0.5 text-xs font-bold ${
                momentum
                  ? "bg-purple-600/15 text-purple-700 dark:text-purple-400"
                  : verdict
                    ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400"
              }`}
              title={
                (config.strategy_residence
                  ? `Modo "vivo primero" (editable en Ajustes): neta ≥ ${(config.net_yield_good * 100).toFixed(0)}% al alquilarlo Y que vivir ahí salga más barato que tu alquiler actual. El cash-on-cash no entra: mientras vives dentro no hay inquilino ni renta.`
                  : `Modo inversión: neta ≥ ${(config.net_yield_good * 100).toFixed(0)}% y cash-on-cash ≥ ${(config.coc_good * 100).toFixed(0)}% (editable en Ajustes).`) +
                (momentum
                  ? ` Momentum: además la zona tiene revalorización estimada positiva (+${((analysis.appreciation_pct_yr ?? 0) * 100).toFixed(1)} %/año) con ≥${config.momentum_min_projects} off-plan comparables y demanda sana.`
                  : verdict && signal === "debil"
                    ? " Sin momentum: la demanda de la zona es débil (las reventas off-plan se ofrecen por debajo del precio de lista o llevan >90 días — ver sección Revalorización)."
                    : verdict
                      ? " Sin momentum: no hay suficientes off-plan comparables con revalorización positiva cerca (ver sección Revalorización)."
                      : "")
              }
            >
              {momentum ? "✓✓ Compra + momentum" : verdict ? "✓ Compra" : "✗ No cumple umbrales"}
            </span>
          )}
          {listing.completion_status === "offplan" &&
            (() => {
              const t = listing.handover_date ? Date.parse(listing.handover_date) : NaN;
              const suspicious = !Number.isFinite(t) || t <= NOW_MS;
              return (
                <span
                  className="btn-font rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400"
                  title={
                    suspicious
                      ? "Marcado como off-plan en PF pero sin fecha de entrega futura: probablemente mal etiquetado por el agente (edificio ya entregado). Excluido de la estimación de revalorización — compruébalo en las fotos."
                      : (listing.sale_type === "primary"
                          ? "Venta nueva directa del developer (new sale / new project): precio de lista, normalmente con payment plan. "
                          : listing.sale_type === "resale"
                            ? "Reventa de una unidad comprada sobre plano (off-plan resale): el precio ya lleva la prima o descuento del mercado. "
                            : "") +
                        "No genera renta hasta la entrega; su precio alimenta la revalorización estimada de los ready de la zona."
                  }
                >
                  OFF-PLAN
                  {listing.sale_type === "primary" ? " · developer" : listing.sale_type === "resale" ? " · resale" : ""}
                  {suspicious ? " · ⚠ sin entrega futura" : ` · entrega ${listing.handover_date!.slice(0, 7)}`}
                </span>
              );
            })()}
        </div>
        <div className="mt-1 flex items-center gap-4">
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Ver anuncio en Property Finder ↗
          </a>
          {listing.lat != null && listing.lon != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${listing.lat},${listing.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Google Maps ↗
            </a>
          )}
          <button
            onClick={addFavorite}
            disabled={faved}
            className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {faved ? "Guardado" : "Guardar en favoritos"}
          </button>
          {/* key: al guardar se remonta y reconsulta la membresía (antes no estaba guardado). */}
          <GroupsMenu key={String(faved)} listingId={id} onSavedState={(s) => s && setFaved(true)} />
          {favError && <span className="text-sm font-medium text-amber-700 dark:text-amber-400">⚠ {favError}</span>}
        </div>
      </div>

      {images.length > 0 && (
        <div className="grid gap-2 lg:grid-cols-[2fr_1fr]">
          <div className="relative overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[imgIdx]?.medium} alt={listing.title} className="aspect-[3/2] w-full object-cover" />
            {images.length > 1 && (
              <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-3">
                <button
                  onClick={() => setImgIdx((imgIdx - 1 + images.length) % images.length)}
                  className="rounded-full bg-black/50 px-3 py-1 text-white"
                >
                  ‹
                </button>
                <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                  {imgIdx + 1}/{images.length}
                </span>
                <button
                  onClick={() => setImgIdx((imgIdx + 1) % images.length)}
                  className="rounded-full bg-black/50 px-3 py-1 text-white"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-auto">
            {images.slice(0, 12).map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.small}
                alt=""
                onClick={() => setImgIdx(i)}
                className={`aspect-[3/2] w-full cursor-pointer rounded-lg object-cover ${i === imgIdx ? "ring-2 ring-blue-500" : ""}`}
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}

      {/* -------- Datos básicos (raw property facts) ------------------------ */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">Datos básicos</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-bold" style={{ color: "var(--accent)" }}>{fmtAED(listing.price)}</span>
            {listing.size_sqft ? (
              <span className="text-sm text-neutral-500">· {Math.round(listing.price / listing.size_sqft)} AED/sqft</span>
            ) : null}
            {/* Dos señales de precio distintas: la mediana es un estadístico de
                24 meses sin ponderar; la tendencia pondera por recencia. Si
                discrepan, la discrepancia mide la deriva del mercado. */}
            {priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) != null ? (
              <span
                className="btn-font ml-1 self-center rounded px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ background: priceSignalColor(analysis.price_vs_median, priceOpts) }}
                title={`AED/sqft de este anuncio frente a la MEDIANA de ${analysis.sale_psqft_n} ventas comparables (±20% de tamaño, últimos 24 meses, sin ponderar por fecha).${
                  analysis.price_vs_median_basis === "absoluto" ? " Sin superficie: comparado sobre precio absoluto." : ""
                }${isPriceOutlier(analysis.price_vs_median) ? ` ⚠ ${OUTLIER_HELP}` : ""}`}
              >
                vs mediana {priceSignalText(analysis.price_vs_median)}
              </span>
            ) : (
              <span
                className="btn-font ml-1 self-center rounded bg-neutral-500/20 px-2 py-0.5 text-[11px] font-bold text-neutral-500"
                title={`Solo ${analysis.sale_psqft_n ?? 0} ventas comparables: por debajo de ${priceOpts.minN} la mediana es ruido. No sabemos si está en precio.`}
              >
                vs mediana · n={analysis.sale_psqft_n ?? 0}
              </span>
            )}
            {/* Refrigeración: el desconocido SE PINTA, para que se note que falta. */}
            <a
              href="#datos-anuncio"
              className={`btn-font self-center rounded px-2 py-0.5 text-[11px] font-bold ${
                analysis.cooling_type === "chiller_free"
                  ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                  : analysis.cooling_type === "district"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : analysis.cooling_type === "dewa"
                      ? "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400"
                      : "border border-dashed border-neutral-400 text-neutral-500"
              }`}
              title={
                analysis.cooling_type
                  ? `${COOLING_LABEL[analysis.cooling_type as CoolingType]} · fuente: ${analysis.cooling_source}. ${
                      COOLING_HELP[analysis.cooling_type as CoolingType]
                    }`
                  : "Sin dato de refrigeración. Afecta a lo que te cuesta vivir ahí (chiller-free = 0 de chiller). Pulsa para fijarlo — se aplica a todo el edificio."
              }
            >
              ❄ {analysis.cooling_type ? COOLING_LABEL[analysis.cooling_type as CoolingType] : "Aire: sin dato"}
            </a>
            {discount != null && (
              <span
                className="btn-font self-center rounded px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ background: discount >= 0 ? "#059669" : "#dc2626" }}
                title="Precio del anuncio frente a la CURVA de tendencia de AED/sqft del edificio (media móvil ponderada por recencia, evaluada en la fecha de la última venta comparable). Puede discrepar del 'vs mediana': esa diferencia es la deriva del mercado."
              >
                vs tendencia {discount >= 0 ? "▼" : "▲"} {Math.abs(discount * 100).toFixed(0)}%
              </span>
            )}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Superficie" value={fmtSqft(listing.size_sqft)} />
            <Fact label="Habitaciones" value={listing.bedrooms === 0 ? "Studio" : listing.bedrooms != null ? String(listing.bedrooms) : "—"} />
            <Fact label="Baños" value={listing.bathrooms != null ? String(listing.bathrooms) : "—"} />
            <Fact label="Tipo" value={listing.property_type || "—"} />
            <Fact label="AED/sqft" value={listing.size_sqft ? `${Math.round(listing.price / listing.size_sqft)}` : "—"} />
            <Fact label="Edificio" value={listing.tower_name || "—"} />
            {(() => {
              if (!listing.listed_date) return null;
              const days = Math.floor((NOW_MS - Date.parse(listing.listed_date)) / 86400000);
              if (!Number.isFinite(days) || days < 0) return null;
              return (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">En mercado</div>
                  <div className={`mt-0.5 text-sm font-medium ${days > 90 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                    {days} días{days > 90 ? " · negociable" : ""}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* -------- Análisis (computed metrics) ------------------------------- */}
      <section>
        <h2 className="mb-2 flex items-center text-sm font-bold uppercase tracking-wide text-neutral-500">
          Análisis
          <InfoList items={ANALYSIS_HELP} href="/guia#rentabilidad" />
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Precio vs mediana del mercado"
            value={
              priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) != null
                ? priceSignalText(analysis.price_vs_median)
                : "sin datos"
            }
            sub={
              priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) != null
                ? `${
                    analysis.price_vs_median_basis === "psqft" && listing.size_sqft
                      ? `${Math.round(listing.price / listing.size_sqft)} AED/sqft de este anuncio vs ${Math.round(analysis.median_sale_psqft ?? 0)} de mediana`
                      : `${fmtAED(listing.price)} vs ${fmtAED(analysis.median_sale_price)} de mediana (sin superficie: base absoluta)`
                  } en ${analysis.sale_psqft_n} ventas comparables (±20%, 24 meses)${
                    isPriceOutlier(analysis.price_vs_median) ? ` · ⚠ ${OUTLIER_HELP}` : ""
                  }`
                : `solo ${analysis.sale_psqft_n ?? 0} ventas comparables: por debajo de ${priceOpts.minN} no es fiable`
            }
            accent={
              // Un extremo sospechoso no se pinta de verde: no es un chollo.
              isPriceOutlier(analysis.price_vs_median)
                ? "bad"
                : priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) === "caro"
                  ? "bad"
                  : priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) === "chollo"
                    ? "good"
                    : undefined
            }
          />
          <Stat
            label="Rentabilidad sobre tu compra"
            value={fmtPct(analysis.asking_yield)}
            sub={`renta anual mediana de alquileres similares ÷ el precio de este anuncio (${fmtAED(listing.price)})`}
            accent={analysis.asking_yield != null && analysis.asking_yield >= config.net_yield_good ? "good" : undefined}
          />
          <Stat
            label="Se alquila por (año, mediana)"
            value={fmtAED(analysis.median_rent)}
            sub={`${analysis.rent_n} alquiler${analysis.rent_n === 1 ? "" : "es"} de tamaño similar (±20%, 24 meses)${
              analysis.rent_p25 != null && analysis.rent_p75 != null
                ? ` · rango ${fmtAED(analysis.rent_p25)}–${fmtAED(analysis.rent_p75)}`
                : ""
            }`}
          />
          <Stat
            label="Rentabilidad de mercado (edificio)"
            value={fmtPct(analysis.gross_yield)}
            sub="renta anual mediana ÷ precio de venta mediano de comparables. Si tu rentabilidad sobre la compra es MENOR que esta, estás pagando por encima de la mediana"
          />
          <Stat
            label="Se vende por (mediana)"
            value={fmtAED(analysis.median_sale_price)}
            sub={`${analysis.buy_n} venta${analysis.buy_n === 1 ? "" : "s"} de tamaño similar (±20%, 24 meses)${
              priceVerdict(analysis.price_vs_median, analysis.sale_psqft_n, priceOpts) != null
                ? ` · este anuncio pide ${analysis.price_vs_median! >= 0 ? "+" : ""}${(analysis.price_vs_median! * 100).toFixed(0)}%`
                : ""
            }${analysis.sale_p25 != null ? ` · objetivo compra p/ reformar ≈ ${fmtAED(analysis.sale_p25)} (P25)` : ""}`}
          />
          <Stat
            label="Gimnasio guardado más cercano"
            value={fmtDist(analysis.gym_distance_m)}
            sub={analysis.gym_name ?? undefined}
          />
        </div>
      </section>

      {/* -------- Finanzas (yield neto, hipoteca, cash-on-cash) ------------- */}
      <section>
        <h2 className="mb-2 flex items-center text-sm font-bold uppercase tracking-wide text-neutral-500">
          Finanzas
          <InfoList items={FINANCE_HELP} href="/guia#service-charge" />
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Rentabilidad neta"
            value={fmtPct(analysis.net_yield)}
            sub={
              analysis.service_charge_rate != null
                ? `tras service charges (${analysis.service_charge_rate} AED/sqft — ${
                    analysis.service_charge_source ?? "sin fuente"
                  }), mantenimiento, seguro y vacancia`
                : "faltan datos (superficie o renta)"
            }
            accent={
              analysis.net_yield == null
                ? undefined
                : analysis.net_yield >= config.net_yield_good
                  ? "good"
                  : "bad"
            }
          />
          <Stat
            label="Cash-on-cash"
            value={fmtPct(analysis.cash_on_cash)}
            sub="lo que rinde cada dirham que pones de tu bolsillo, con hipoteca — la métrica reina del modelo apalancado"
            accent={
              analysis.cash_on_cash == null ? undefined : analysis.cash_on_cash >= config.coc_good ? "good" : "bad"
            }
          />
          <Stat
            label="Cuota hipoteca"
            value={analysis.monthly_payment != null ? `${fmtAED(analysis.monthly_payment)}/mes` : "—"}
            sub={
              analysis.dbr_ok === 0
                ? `⚠ el banco no la concedería: supera tu tope de cuotas (DBR, máx ${fmtAED(config.monthly_salary * config.dbr_max - config.existing_monthly_payments)}/mes) — ver "?"`
                : analysis.loan_amount != null
                  ? `préstamo ${fmtAED(analysis.loan_amount)} · financiable con tu sueldo (DBR ok)`
                  : undefined
            }
            accent={analysis.dbr_ok === 0 ? "bad" : undefined}
          />
          <Stat
            label="Cash necesario (upfront)"
            value={fmtAED(analysis.cash_upfront)}
            sub={`entrada + DLD${listing.dld_waiver ? " (waiver ✓)" : ""} + trustee + agente + fees hipoteca${
              listing.second_home ? " · como 2ª vivienda (LTV 65%)" : ""
            }`}
          />
        </div>
        <FinanceEditor
          listing={listing}
          coolingSource={analysis.cooling_type ? analysis.cooling_source : null}
          onSaved={(l, a) => setData((d) => (d ? { ...d, listing: { ...d.listing, ...l }, analysis: a } : d))}
        />
      </section>

      {/* -------- Plan: vivo primero, alquilo después ---------------------- */}
      {analysis.monthly_payment != null && listing.completion_status !== "offplan" && (
        <ResidencePlan analysis={analysis} price={listing.price} config={config} />
      )}

      {/* -------- STR / alquiler vacacional --------------------------------- */}
      {analysis.str_slug && (
        <section>
          <h2 className="mb-2 flex items-center text-sm font-bold uppercase tracking-wide text-neutral-500">
            Alquiler vacacional (STR)
            <InfoList items={STR_HELP} href="/guia#str" />
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Necesitas cobrar (para igualar la renta larga)"
              value={
                analysis.str_breakeven_adr != null ? `${fmtAED(analysis.str_breakeven_adr)}/noche` : "—"
              }
              sub={`al ${strMarket?.occupancy != null ? fmtPct(strMarket.occupancy) : "—"} de ocupación · compruébalo mirando Airbnb en la zona: es el único número que no depende de datos prestados`}
              accent="good"
            />
            <Stat
              label="ADR del submercado"
              value={
                strMarket?.adr_usd != null ? `${fmtAED(strMarket.adr_usd * config.usd_to_aed)}/noche` : "—"
              }
              sub={
                analysis.str_slug === "dubai"
                  ? "⚠ media de TODO Dubái (dominada por Marina/Downtown/Business Bay): no representa esta zona"
                  : strMarket?.peak_adr_usd != null
                    ? `pico ${fmtAED(strMarket.peak_adr_usd * config.usd_to_aed)}/noche`
                    : undefined
              }
              accent={analysis.str_slug === "dubai" ? "bad" : undefined}
            />
            <Stat
              label="Ingresos STR estimados/año"
              value={fmtAED(analysis.str_annual_revenue_aed)}
              sub={
                (config.str_mgmt_pct > 0
                  ? `con gestión al ${(config.str_mgmt_pct * 100).toFixed(0)}% · `
                  : "autogestión (0% de gestión) · ") +
                (analysis.str_vs_rent != null
                  ? `×${analysis.str_vs_rent.toFixed(2)} vs alquiler anual`
                  : "neto de permiso, tourism dirham y utilities")
              }
              accent={
                analysis.str_slug === "dubai"
                  ? undefined
                  : analysis.str_vs_rent != null && analysis.str_vs_rent > 1
                    ? "good"
                    : undefined
              }
            />
            <Stat
              label="Cuota cubierta (modo híbrido)"
              value={fmtPct(analysis.str_pct_mortgage_covered)}
              sub={`viviendo tú y alquilando solo ${config.str_peak_nights} noches pico → ${fmtAED(analysis.str_hybrid_income_aed)}/año`}
            />
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            Fuente: AirROI ({analysis.str_slug}
            {analysis.str_slug === "dubai" ? " — agregado de la ciudad, sin dato específico de la zona" : ""}) ·
            actualizado {strMarket?.fetched_at?.slice(0, 10) ?? "—"} · requiere edificio con permiso holiday home
            (DET/DTCM)
          </p>
        </section>
      )}

      {/* -------- Revalorización estimada por off-plan colindante ----------- */}
      {listing.completion_status !== "offplan" && (
        <section>
          <h2 className="mb-2 flex items-center text-sm font-bold uppercase tracking-wide text-neutral-500">
            Revalorización estimada (off-plan colindante)
            <InfoList items={APPRECIATION_HELP} href="/guia#revalorizacion" />
          </h2>
          {!analysis.offplan_n ? (
            <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
              Sin proyectos off-plan comparables en tus favoritos (misma comunidad o a &lt;3 km, tamaño ±30%, con fecha
              de entrega futura). Guarda proyectos off-plan de la zona en tus Guardados de Property Finder y tráelos con
              &quot;Sincronizar con PF&quot; — con ellos se estima aquí la revalorización y se activa el veredicto ✓✓
              momentum.
            </div>
          ) : (
          <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Proyectos comparables"
              value={String(analysis.offplan_n)}
              sub={
                analysis.offplan_primary_psqft != null || analysis.offplan_resale_psqft != null
                  ? `${analysis.offplan_primary_psqft != null ? `developer ${Math.round(analysis.offplan_primary_psqft)}` : "developer —"} · ${analysis.offplan_resale_psqft != null ? `resale ${Math.round(analysis.offplan_resale_psqft)}` : "resale —"} AED/sqft`
                  : "misma comunidad o <3 km, tamaño ±30%"
              }
            />
            <Stat
              label="Señal de demanda"
              value={SIGNAL_LABEL[signal ?? "null"]}
              sub={
                analysis.resale_premium != null
                  ? `reventas ${analysis.resale_premium >= 0 ? "+" : ""}${(analysis.resale_premium * 100).toFixed(0)}% vs precio de lista${analysis.resale_dom_days != null ? ` · ${analysis.resale_dom_days}d en mercado` : ""}`
                  : "faltan reventas o precios de lista para medirla"
              }
              accent={signal === "fuerte" ? "good" : signal === "debil" ? "bad" : undefined}
            />
            <Stat
              label="Escenario alcista"
              value={
                analysis.appreciation_pct_yr != null
                  ? `${analysis.appreciation_pct_yr >= 0 ? "+" : ""}${(analysis.appreciation_pct_yr * 100).toFixed(1)} %/año`
                  : "—"
              }
              sub={`converge hacia ${analysis.future_psqft != null ? Math.round(analysis.future_psqft) + " AED/sqft" : "—"} (obra nueva − ${(config.new_build_discount * 100).toFixed(0)}%) a la entrega`}
              accent={analysis.appreciation_pct_yr != null && analysis.appreciation_pct_yr > 0 ? "good" : undefined}
            />
            <Stat
              label="Escenario bajista"
              value={
                analysis.appreciation_pct_yr_bear != null
                  ? `${analysis.appreciation_pct_yr_bear >= 0 ? "+" : ""}${(analysis.appreciation_pct_yr_bear * 100).toFixed(1)} %/año`
                  : "—"
              }
              sub={`choque de oferta al entregarse el pipeline (−${(config.supply_pressure_bear * 100).toFixed(0)}% total, editable)`}
              accent="bad"
            />
          </div>
          {attractors != null && (
            <p className="mt-2 text-xs text-neutral-500">
              Atractores a &lt;1 km: <b>{attractors.cafes_1km}</b> cafeterías · <b>{attractors.supers_1km}</b> súper/mall.{" "}
              {attractors.cafes_1km + attractors.supers_1km >= 8
                ? "Zona ya consolidada: absorbe mejor la oferta nueva (favorece el alcista)."
                : "Zona poco servida: la revalorización depende de que llegue población y, tras ella, los negocios (más incierto)."}
            </p>
          )}
          <p className="mt-1.5 text-xs text-neutral-400">
            ⚠ Dos escenarios, no una promesa: la entrega del pipeline colindante puede empujar el precio arriba
            (convergencia con obra nueva) o abajo (sobreoferta). La señal de demanda y los atractores te dicen cuál es
            más probable; el juicio final (mall confirmado, metro, atractivo de la zona) lo pones tú.
          </p>
          </>
          )}
        </section>
      )}

      {listing.amenities?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {listing.amenities.map((a) => (
            <span key={a} className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs dark:bg-neutral-800">
              {a}
            </span>
          ))}
        </div>
      )}

      <ReformScenario
        listingId={listing.id}
        price={listing.price}
        sizeSqft={listing.size_sqft}
        analysis={analysis}
      />

      {transactions && (transactions.buy.length > 0 || transactions.rent.length > 0) && (
        <PsqftChart
          buy={transactions.buy}
          rent={transactions.rent}
          listingBedrooms={listing.bedrooms}
          listingSizeSqft={listing.size_sqft}
          listingPsqft={listing.size_sqft ? listing.price / listing.size_sqft : null}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <TransactionsTable
          title={`Transacciones de venta en ${listing.tower_name ?? "el edificio"}`}
          rows={transactions?.buy ?? []}
          kind="buy"
        />
        <TransactionsTable
          title={`Contratos de alquiler en ${listing.tower_name ?? "el edificio"}`}
          rows={transactions?.rent ?? []}
          kind="rent"
        />
      </div>

      {listing.description && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm whitespace-pre-line dark:border-neutral-800 dark:bg-neutral-900">
          {listing.description}
        </div>
      )}
    </div>
  );
}

// Congelada al cargar el módulo: solo decide si una entrega quedó atrás.
const NOW_MS = Date.now();

const SIGNAL_LABEL: Record<string, string> = {
  fuerte: "Fuerte",
  neutral: "Neutral",
  debil: "Débil",
  null: "sin datos",
};

const ANALYSIS_HELP: { term: string; desc: string }[] = [
  {
    term: "Rentabilidad sobre tu compra",
    desc: "Renta anual mediana de alquileres de tamaño similar (±20%, mismo edificio, últimos 24 meses) ÷ el precio de ESTE anuncio (lo que vas a pagar). Es la rentabilidad que obtendrías tú comprándolo a ese precio. Es la métrica principal.",
  },
  {
    term: "Se alquila por (año, mediana)",
    desc: "Mediana de los contratos de alquiler anuales de unidades de tamaño similar (±20%) del edificio, últimos 24 meses. El rango es P25–P75: lo que pagan los pisos peor y mejor acondicionados.",
  },
  {
    term: "Rentabilidad de mercado (edificio)",
    desc: "Renta anual mediana ÷ precio de venta mediano de unidades comparables. Es la rentabilidad de referencia del edificio, NO depende del precio de este anuncio — sirve para comparar el anuncio con la media.",
  },
  {
    term: "Se vende por (mediana)",
    desc: "Mediana de las ventas registradas en el DLD de tamaño similar (±20%), últimos 24 meses. El P25 es el tramo bajo del mercado ≈ precio objetivo de compra para reformar.",
  },
  {
    term: "Precio vs mediana (¿caro o barato?)",
    desc: "AED/sqft de este anuncio frente a la MEDIANA de las ventas comparables (±20% de tamaño, últimos 24 meses). +10% o más = sobreprecio; −10% o menos = chollo (umbrales en Ajustes). Es matemáticamente lo mismo que comparar tu rentabilidad sobre la compra con la de mercado: si la tuya es menor, pagas por encima de la mediana. Con pocas ventas comparables se muestra 'n=X' en gris: no saber no es lo mismo que estar en precio.",
  },
  {
    term: "vs tendencia (y por qué puede discrepar)",
    desc: "La otra señal de precio: AED/sqft frente a la CURVA de tendencia del edificio (media móvil ponderada por recencia, la del gráfico). Diferencias con la mediana: la mediana trata igual una venta de hace 23 meses y una de la semana pasada; la tendencia pondera por recencia pero se evalúa en la fecha de la última venta comparable, que puede tener meses. Si las dos discrepan, la discrepancia mide la DERIVA del mercado: 'caro vs mediana pero barato vs tendencia' significa que el edificio se ha revalorizado dentro de esos 24 meses.",
  },
  {
    term: "Gimnasio guardado más cercano",
    desc: "Distancia en línea recta al más cercano de los gimnasios que has guardado manualmente (desde el mapa, pegando su enlace de Google Maps).",
  },
];

const FINANCE_HELP: { term: string; desc: string }[] = [
  {
    term: "Rentabilidad neta",
    desc: "Renta anual (con vacancia descontada) menos service charges (sqft × AED/sqft de la zona o del edificio), mantenimiento y seguro de hogar, dividido por el precio del anuncio. Es la rentabilidad real de explotación, no la bruta.",
  },
  {
    term: "Vacancia",
    desc: "El % del año que el piso está vacío ENTRE inquilinos en el alquiler tradicional: acaba un contrato y pasan semanas hasta que entra el siguiente (búsqueda, visitas, pintura). Ese tiempo no cobras renta, así que se descuenta de la renta anual antes de calcular la neta y el cash-on-cash. Con el 6% por defecto ≈ 3 semanas vacío al año. No es el alquiler vacacional (eso va en la sección STR) ni el uso propio.",
  },
  {
    term: "Cash-on-cash",
    desc: "(Renta efectiva − service charges − 12 cuotas de hipoteca − seguros) ÷ cash total que pones (entrada + DLD + fees). Compara inmuebles mejor que el yield porque castiga los que exigen más entrada. Objetivo del modelo: ≥ 8%.",
  },
  {
    term: "Cuota hipoteca",
    desc: "Cuota mensual PMT con el tipo, plazo y LTV configurados en Ajustes (80% 1ª vivienda / 65% 2ª).",
  },
  {
    term: "DBR (Debt Burden Ratio)",
    desc: "Norma del Banco Central UAE: el banco NO te concede la hipoteca si la suma de TODAS tus cuotas mensuales (esta + las que ya tengas) supera el 50% de tu sueldo. Con 16.000 AED/mes tu tope son 8.000 AED en cuotas. Si el análisis marca que supera tu DBR, ese piso no es financiable para ti a ese precio — y cada hipoteca que firmes consume capacidad para la siguiente (amortizar libera DBR). Sueldo y cuotas existentes se editan en Ajustes.",
  },
  {
    term: "Cash necesario (upfront)",
    desc: "Entrada + DLD 4% + AED 580 (0 si el vendedor asume el DLD) + trustee + comisión de agente + registro de hipoteca + valoración + arrangement fee. Regla rápida: ~26-27% del precio en 1ª vivienda, ~41% en 2ª.",
  },
  {
    term: "Datos del anuncio (editar)",
    desc: "El service charge lo fija cada EDIFICIO. Prioridad de fuentes: lo que pongas aquí a mano (se aplica a toda la torre) → dato oficial Mollak del edificio (descargado de Dubai Pulse en Ajustes) → estimación por zona → default. DLD waiver y 2ª vivienda son del trato concreto y solo afectan a este anuncio.",
  },
];

const APPRECIATION_HELP: { term: string; desc: string }[] = [
  {
    term: "Cómo funciona",
    desc: "Los proyectos off-plan que guardes en favoritos (desde tus Guardados de Property Finder, como cualquier anuncio) marcan a qué AED/sqft se está vendiendo la zona 'a futuro' y cuándo se entrega. La tesis: al entregarse, la 2ª mano de la zona converge hacia ese nivel de precios.",
  },
  {
    term: "Señal de demanda",
    desc: "El voto del mercado sobre qué escenario gana. Compara el AED/sqft de las REVENTAS off-plan con el de las ventas nuevas del developer (precio de lista). Si la gente revende por encima de lista (+5% o más) = demanda fuerte, la zona convence. Si revende 'below OP' (−5% o más) o los anuncios llevan >90 días sin venderse = demanda débil, el mercado descuenta sobreoferta. Fuerte/débil colorea el veredicto y el escenario probable.",
  },
  {
    term: "Escenario alcista",
    desc: "Tasa anual compuesta que llevaría el AED/sqft de ESTE anuncio hasta el precio futuro estimado (mediana de la obra nueva colindante − 15% por 2ª mano, editable) en el tiempo hasta la entrega mediana. Es la convergencia si la demanda acompaña.",
  },
  {
    term: "Escenario bajista",
    desc: "El otro lado (spec §7.2): al entregarse el pipeline, la oferta de la zona sube de golpe y, si la demanda no acompaña, el precio cae. Modela una caída total configurable (10% por defecto) anualizada hasta la entrega. NO depende del precio del off-plan, solo del volumen que llega y de cuándo.",
  },
  {
    term: "Atractores a <1 km",
    desc: "Cafeterías y súper/mall del entorno (OpenStreetMap). Los negocios siguen a la POBLACIÓN, no a la construcción: una zona ya servida absorbe la oferta nueva rápido (bache corto, favorece el alcista); una zona vacía depende de que la gente se mude de verdad y los negocios lleguen detrás — más lento e incierto. Contexto para tu juicio, no una métrica.",
  },
];

const STR_HELP: { term: string; desc: string }[] = [
  {
    term: "ADR / Ocupación",
    desc: "Tarifa media por noche y ocupación anual del submercado AirROI de la zona (gratuito). AirROI solo publica 5 submercados de Dubái; si la zona no tiene el suyo se usa el agregado de la ciudad.",
  },
  {
    term: "Ingresos STR estimados/año",
    desc: "Revenue anual medio por anuncio del submercado, convertido a AED y neto de costes STR: gestión, permiso DET/DTCM, Tourism Dirham (AED 10/noche ocupada) y utilities+wifi que en STR paga el propietario.",
  },
  {
    term: "Cuota cubierta (modo híbrido)",
    desc: "Tu caso de uso: vivir en el piso y alquilarlo solo las noches pico del año (configurable en Ajustes). Ingresos de esas noches (ADR pico × ocupación pico) ÷ las 12 cuotas anuales de la hipoteca.",
  },
  {
    term: "Requisito legal",
    desc: "Solo válido si el edificio permite holiday homes y se registra el permiso DET/DTCM. Verifícalo con la Owners Association antes de contar con estos números.",
  },
];

const RESIDENCE_HELP: { term: string; desc: string }[] = [
  {
    term: "Para qué sirve",
    desc: "El cash-on-cash normal supone que alquilas desde el día uno. Si vas a vivir en el piso primero, esos años no hay renta: el CoC no aplica. Este bloque separa las dos fases — lo que te cuesta vivir ahí, y qué rinde el piso cuando por fin lo alquiles ya reformado.",
  },
  {
    term: "Fase 1 · Coste de vivir ahí",
    desc: "Cuota + service charges + seguro, al mes. Se compara con lo que pagas hoy de alquiler (editable aquí o en Ajustes): si sale negativo, vivir en tu piso te sale MÁS BARATO que alquilar, y encima amortizas.",
  },
  {
    term: "Capital amortizado",
    desc: "La parte de las cuotas que ha ido a reducir deuda durante los años de residencia. No es gasto: es patrimonio tuyo. Es lo que el cash-on-cash nunca refleja.",
  },
  {
    term: "Fase 2 · CoC diferido",
    desc: "El cash-on-cash de cuando lo alquiles, con dos correcciones frente al CoC normal: la renta es la POST-REFORMA (mediana actual + el uplift que configures) y el cash invertido incluye la reforma y el mobiliario. Es el número que de verdad describe tu estrategia.",
  },
  {
    term: "Ojo con el uplift",
    desc: "La subida de renta por reformar y amueblar es fiable (spec: 5-10% cosmética + 10-15% amueblado). Subir el precio de VENTA por sqft es mucho más incierto: el comprador compara tu AED/sqft con las demás unidades del edificio. Mira el payback del Escenario de reforma más abajo.",
  },
];

function ResidencePlan({
  analysis,
  price,
  config,
}: {
  analysis: AnalysisRow;
  price: number;
  config: AppConfig;
}) {
  const [years, setYears] = useState(String(config.residence_years));
  const [rentNow, setRentNow] = useState(String(config.current_rent_monthly));
  const [reform, setReform] = useState(String(config.reform_furnish_cost));
  const [uplift, setUplift] = useState(String(Math.round(config.reform_rent_uplift * 100)));

  const num = (s: string, fallback: number) => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const plan = computeResidencePlan({
    // El cooling ya resuelto por edificio (0 si es chiller-free); si no hay
    // dato, el global de config. Sin esto la ficha contradiría al análisis.
    coolingMonthly: analysis.cooling_monthly_applied ?? undefined,
    price,
    monthlyPayment: analysis.monthly_payment ?? 0,
    loanAmount: analysis.loan_amount ?? 0,
    cashUpfront: analysis.cash_upfront ?? 0,
    serviceChargesAnnual: analysis.service_charges_annual,
    annualRent: analysis.median_rent,
    rentP75: analysis.rent_p75,
    residenceYears: num(years, config.residence_years),
    currentRentMonthly: num(rentNow, config.current_rent_monthly),
    reformCost: num(reform, config.reform_furnish_cost),
    rentUplift: num(uplift, config.reform_rent_uplift * 100) / 100,
    // Entrada del siguiente piso: mismo precio pero como 2ª vivienda (LTV
    // menor). Solo depende del precio y la config, no de renta ni superficie.
    nextDepositTarget: computeFinance({
      price,
      sizeSqft: null,
      annualRent: null,
      serviceChargeRate: null,
      dldWaiver: false,
      secondHome: true,
      cfg: config,
    }).cash_upfront,
    cfg: config,
  });
  if (!plan) return null;

  const yearsN = num(years, config.residence_years);
  const inputCls =
    "w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-right text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <section>
      <h2 className="mb-2 flex items-center text-sm font-bold uppercase tracking-wide text-neutral-500">
        Plan: vivo primero, alquilo después
        <InfoList items={RESIDENCE_HELP} href="/guia#plan-residencia" />
      </h2>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm dark:border-neutral-700">
        <label className="flex items-center gap-2">
          Vivo en él
          <input type="text" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} className={inputCls} />
          años
        </label>
        <label className="flex items-center gap-2">
          Mi alquiler hoy
          <input type="text" inputMode="decimal" value={rentNow} onChange={(e) => setRentNow(e.target.value)} className={inputCls} />
          AED/mes
        </label>
        <label className="flex items-center gap-2">
          Reforma + muebles
          <input type="text" inputMode="decimal" value={reform} onChange={(e) => setReform(e.target.value)} className={inputCls} />
          AED
        </label>
        <label className="flex items-center gap-2">
          Sube la renta
          <input type="text" inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value)} className={inputCls} />%
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Fase 1 · Vivir ahí (${yearsN} años)`}
          value={`${fmtAED(plan.monthly_cost_full)}/mes`}
          sub={`cuota + service charges + seguro (${fmtAED(plan.monthly_cost)}) + DEWA y aire (${fmtAED(plan.utilities_monthly)}) · sin renta, el CoC no aplica aquí`}
        />
        <Stat
          label={plan.monthly_delta <= 0 ? "Ahorras frente a alquilar" : "Te cuesta más que alquilar"}
          value={`${plan.monthly_delta <= 0 ? "" : "+"}${fmtAED(plan.monthly_delta)}/mes`}
          sub={`comparando sin DEWA ni aire (los pagas vivas donde vivas) · ${plan.phase1_total_delta <= 0 ? "ahorro" : "sobrecoste"} de ${fmtAED(Math.abs(plan.phase1_total_delta))} en ${yearsN} años · + ${fmtAED(plan.equity_built)} amortizado`}
          accent={plan.monthly_delta <= 0 ? "good" : "bad"}
        />
        <Stat
          label="Hasta el 2º piso"
          value={
            plan.months_to_next != null
              ? plan.months_to_next < 24
                ? `${Math.round(plan.months_to_next)} meses`
                : `${(plan.months_to_next / 12).toFixed(1)} años`
              : "—"
          }
          sub={`te sobran ${fmtAED(plan.savings_capacity)}/mes (${fmtAED(config.monthly_salary)} − ${fmtAED(plan.personal_expenses_total)} de gastos personales − ${fmtAED(plan.monthly_cost_full)} de vivienda) → entrada de una 2ª vivienda`}
          accent={plan.months_to_next != null && plan.months_to_next <= 36 ? "good" : undefined}
        />
        <Stat
          label="Fase 2 · CoC diferido"
          value={fmtPct(plan.deferred_coc)}
          sub={
            plan.post_reform_rent != null
              ? `renta post-reforma ${fmtAED(plan.post_reform_rent)}${plan.rent_capped ? " (techo P75 del edificio)" : ""} · invertido ${fmtAED(plan.total_invested)}`
              : "faltan datos de renta comparable"
          }
          accent={
            plan.deferred_coc == null ? undefined : plan.deferred_coc >= config.coc_good ? "good" : "bad"
          }
        />
      </div>
      {(() => {
        // Conclusión primero: ¿la reforma se paga sola en ESTE edificio?
        const reformCost = num(reform, config.reform_furnish_cost);
        const upliftReal = (plan.post_reform_rent ?? 0) - (analysis.median_rent ?? 0);
        const payback = upliftReal > 0 && reformCost > 0 ? reformCost / upliftReal : null;
        const vale = payback != null && payback <= 10;
        return (
          <div className="mt-2 space-y-1 text-xs">
            <p className={vale ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
              <b>
                {payback == null
                  ? "La reforma no se paga: no hay margen de renta que capturar en este edificio."
                  : vale
                    ? `Reformar aquí compensa: ${fmtAED(reformCost)} para ganar ${fmtAED(upliftReal)}/año → se paga en ${payback.toFixed(1)} años.`
                    : `Reformar aquí no compensa: ${fmtAED(reformCost)} para ganar solo ${fmtAED(upliftReal)}/año → ${payback.toFixed(1)} años en recuperarlo.`}
              </b>{" "}
              {plan.rent_capped && (
                <>
                  El {Math.round(num(uplift, config.reform_rent_uplift * 100))}% que has puesto arriba se recorta al{" "}
                  <b>P75 del edificio ({fmtAED(analysis.rent_p75)})</b>: el techo lo pone la torre, no tu presupuesto
                  — no puedes alquilar por encima del mejor piso de tu mismo edificio.
                </>
              )}
            </p>
            <p className="text-neutral-400">
              Neta post-reforma {fmtPct(plan.deferred_net_yield)} sobre precio + reforma (la de arriba,{" "}
              {fmtPct(analysis.net_yield)}, es sin tocar nada). <b>Esto no afecta al veredicto ✓ Compra</b>, que solo
              mira la neta actual y lo que te cuesta vivir ahí: la reforma es opcional y va aparte.
            </p>
          </div>
        );
      })()}
    </section>
  );
}

function FinanceEditor({
  listing,
  coolingSource,
  onSaved,
}: {
  listing: {
    id: string;
    tower_name: string | null;
    service_charge_override: number | null;
    dld_waiver: number;
    second_home: number | null;
    cooling_type_override: string | null;
  };
  coolingSource: string | null;
  onSaved: (
    listing: { service_charge_override: number | null; dld_waiver: number; second_home: number | null },
    analysis: AnalysisRow
  ) => void;
}) {
  const [sc, setSc] = useState(listing.service_charge_override != null ? String(listing.service_charge_override) : "");
  const [waiver, setWaiver] = useState(!!listing.dld_waiver);
  const [second, setSecond] = useState(!!listing.second_home);
  const [cooling, setCooling] = useState(listing.cooling_type_override ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    const scNum = parseFloat(sc.replace(",", "."));
    const res = await fetch(`/api/listing/${listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_charge_override: Number.isFinite(scNum) && scNum > 0 ? scNum : null,
        dld_waiver: waiver,
        second_home: second,
        cooling_type_override: cooling || null,
      }),
    });
    const j = await res.json();
    setSaving(false);
    if (!j.error && j.listing && j.analysis) {
      onSaved(
        {
          service_charge_override: j.listing.service_charge_override,
          dld_waiver: j.listing.dld_waiver,
          second_home: j.listing.second_home,
        },
        j.analysis
      );
      // El alcance importa: PF trata cada torre como edificio aparte, así que
      // el service charge NO salta a las torres hermanas del mismo complejo.
      const n = j.affected ?? 1;
      setSavedMsg(
        n > 1
          ? `Guardado en ${n} anuncios de ${listing.tower_name ?? "este edificio"}`
          : "Guardado en este anuncio"
      );
    }
  };

  return (
    <div
      id="datos-anuncio"
      className="mt-3 flex scroll-mt-20 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm dark:border-neutral-700"
    >
      <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Datos del anuncio
        <Link
          href="/guia#service-charge"
          title="Guía: cómo buscar el service charge real en el DLD/Mollak y meterlo aquí"
          className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-400 text-[10px] font-bold text-neutral-500 normal-case hover:border-blue-500 hover:text-blue-600 dark:border-neutral-500 dark:hover:text-blue-400"
        >
          ?
        </Link>
      </span>
      <label className="flex items-center gap-2" title="Se aplica a todos los anuncios del mismo edificio">
        Service charge real (todo el edificio)
        <input
          type="text"
          inputMode="decimal"
          placeholder="AED/sqft/año"
          value={sc}
          onChange={(e) => setSc(e.target.value)}
          className="w-28 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-right text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <a
        href="https://dubailand.gov.ae/en/eservices/service-charge-index-overview/"
        target="_blank"
        rel="noopener noreferrer"
        title="Índice oficial de service charges del DLD (datos Mollak/RERA): elige Master Community → edificio/proyecto y verás el AED/sqft aprobado del año en curso. Guía completa en Ajustes."
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        consultar en el DLD ↗
      </a>
      <label className="flex items-center gap-2" title="El tipo de refrigeración es del edificio: se aplica a toda la torre">
        Aire acondicionado
        <select
          value={cooling}
          onChange={(e) => setCooling(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">Sin dato</option>
          <option value="chiller_free">Chiller-free (va en el service charge)</option>
          <option value="district">District cooling (Empower/Emicool)</option>
          <option value="dewa">Split propio (DEWA)</option>
        </select>
        {coolingSource && !listing.cooling_type_override && (
          <span className="text-xs text-neutral-400">detectado: {coolingSource}</span>
        )}
      </label>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} className="h-4 w-4" />
        DLD waiver
      </label>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={second} onChange={(e) => setSecond(e.target.checked)} className="h-4 w-4" />
        2ª vivienda (LTV 65%)
      </label>
      {savedMsg && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{savedMsg}</span>}
      <button
        onClick={save}
        disabled={saving}
        className="btn-font ml-auto rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {saving ? "Recalculando…" : "Guardar y recalcular"}
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

/** Glosario al pasar el ratón; click en el "?" abre la guía completa. */
function InfoList({ items, href = "/guia" }: { items: { term: string; desc: string }[]; href?: string }) {
  return (
    <span className="group relative ml-2 inline-flex align-middle normal-case">
      <Link
        href={href}
        title="Abrir la guía completa"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-400 text-[10px] font-bold text-neutral-500 hover:border-blue-500 hover:text-blue-600 dark:border-neutral-500 dark:hover:text-blue-400"
      >
        ?
      </Link>
      <span className="pointer-events-none absolute left-0 top-6 z-30 w-80 rounded-md border border-neutral-200 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-800">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          Cómo leer cada campo <span className="font-normal normal-case text-neutral-400">· click en ? para la guía</span>
        </span>
        {items.map((it) => (
          <span key={it.term} className="mb-2 block last:mb-0">
            <span className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-200">{it.term}</span>
            <span className="block text-[11px] font-normal leading-snug text-neutral-500 dark:text-neutral-400">{it.desc}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs font-semibold text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-xl font-bold ${
          accent === "good" ? "text-emerald-600 dark:text-emerald-400" : accent === "bad" ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
