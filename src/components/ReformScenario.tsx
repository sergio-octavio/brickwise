"use client";

import { useState } from "react";
import { fmtAED, fmtPct } from "@/lib/format";
import { AnalysisRow } from "@/lib/types";
import {
  computeReform,
  defaultReformState,
  FurnitureType,
  REFORM_ITEMS,
  ReformState,
  SIZE_TOLERANCE,
} from "@/lib/reform";



interface Props {
  listingId: string;
  price: number;
  sizeSqft: number | null;
  analysis: AnalysisRow;
}

/**
 * Itemized reform model. The rent uplift you can claim depends on the SCOPE of
 * the reform (which items you do), not on the money you type in: each item
 * captures a share ("weight") of the median→P75 spread. Costs only affect the
 * payback. This prevents "cheap reform + full P75 rent" from inflating yields.
 *
 * Default costs are rough Dubai light-reform figures per sqft; edit them freely.
 */
// Modelo compartido con la métrica "Reforma" del mapa (src/lib/reform.ts):
// así la ficha y el pin nunca dan números distintos del mismo piso.
const ITEMS = REFORM_ITEMS;
const defaultState = defaultReformState;

const REFORM_HELP =
  "Comparamos los alquileres de pisos de TAMAÑO SIMILAR (±20%) del mismo edificio (24 meses). " +
  "P25 = piso sin reformar; P75 = bien reformado; mediana = el típico. La reforma solo puede capturar " +
  "el margen mediana→P75, y CADA PARTIDA captura una parte: mobiliario 40% (50% si es a medida), " +
  "suelo 25%, paredes 20%, techos 10%. Marcar o desmarcar partidas cambia la renta esperada; " +
  "el coste que escribas solo cambia el payback — así una reforma barata no infla la rentabilidad.";

/** Small "?" badge with a hover tooltip. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle normal-case">
      <span className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-neutral-400 text-[10px] font-bold text-neutral-500 dark:border-neutral-500">
        ?
      </span>
      <span className="pointer-events-none absolute left-0 top-5 z-30 w-72 rounded-md border border-neutral-200 bg-white p-2.5 text-[11px] font-normal leading-snug text-neutral-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        {text}
      </span>
    </span>
  );
}

export default function ReformScenario({ listingId, price, sizeSqft, analysis }: Props) {
  const [state, setState] = useState<ReformState>(() => {
    const fallback = defaultState(sizeSqft);
    if (typeof window === "undefined") return fallback;
    try {
      const saved = JSON.parse(localStorage.getItem(`bw-reform-${listingId}`) ?? "");
      // Older versions stored a plain number — ignore those.
      if (saved && typeof saved === "object" && saved.mobiliario) return saved as ReformState;
    } catch {}
    return fallback;
  });

  const { rent_p25, rent_p75, median_rent, rent_n, asking_yield } = analysis;
  if (rent_p25 == null || rent_p75 == null || median_rent == null || rent_n < 3) return null;

  const update = (next: ReformState) => {
    setState(next);
    localStorage.setItem(`bw-reform-${listingId}`, JSON.stringify(next));
  };

  // Base preferente: rentas por sqft con ventana de 12 meses, reescaladas a
  // este piso. Evita que el margen venga de mezclar tamaños o de la inflación
  // de rentas de 24 meses. Sin ella se usa la base absoluta de siempre.
  const psqftBasis =
    analysis.rent_psqft_median != null && analysis.rent_psqft_p75 != null && sizeSqft
      ? {
          median: analysis.rent_psqft_median * sizeSqft,
          p75: analysis.rent_psqft_p75 * sizeSqft,
          p25: (analysis.rent_psqft_p25 ?? analysis.rent_psqft_median) * sizeSqft,
          n: analysis.rent_psqft_n,
          months: analysis.rent_basis_months,
        }
      : null;
  const baseMedian = psqftBasis?.median ?? median_rent;
  const baseP75 = psqftBasis?.p75 ?? rent_p75;
  const baseP25 = psqftBasis?.p25 ?? rent_p25;

  const uplift = baseP75 - baseMedian; // margen total de una reforma completa
  const { scope, totalCost, expectedRent, capturedUplift, postReformYield, paybackYears } = computeReform({
    state,
    price,
    medianRent: baseMedian,
    upliftFull: uplift,
  });
  const spread = (baseP75 - baseP25) / baseMedian;
  const medianPct =
    rent_p75 > rent_p25 ? Math.min(96, Math.max(4, ((median_rent - rent_p25) / (rent_p75 - rent_p25)) * 100)) : 50;

  const spreadReading =
    spread >= 0.15
      ? { txt: "El interior mueve mucho la renta en este edificio: hay margen real para la reforma.", cls: "text-emerald-700 dark:text-emerald-400" }
      : spread >= 0.08
        ? { txt: "Margen moderado: la reforma ayuda, pero no esperes milagros en este edificio.", cls: "text-amber-700 dark:text-amber-400" }
        : { txt: "El edificio capa la renta: los comparables se alquilan casi igual estén como estén. La reforma difícilmente se paga aquí.", cls: "text-red-700 dark:text-red-400" };

  const band = sizeSqft
    ? `${Math.round(sizeSqft * (1 - SIZE_TOLERANCE))}–${Math.round(sizeSqft * (1 + SIZE_TOLERANCE))} sqft`
    : null;

  const rowCls = "flex items-center gap-2 py-1";
  const inputCls =
    "w-24 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-950";

  const itemRow = (
    key: "suelo" | "paredes" | "techos",
    label: string,
    weight: number
  ) => (
    <label className={rowCls}>
      <input
        type="checkbox"
        checked={state[key].on}
        onChange={(e) => update({ ...state, [key]: { ...state[key], on: e.target.checked } })}
        className="h-3.5 w-3.5 accent-blue-600"
      />
      <span className="flex-1 text-xs">{label}</span>
      <span className="text-[10px] text-neutral-400">+{Math.round(weight * 100)}%</span>
      <input
        type="number"
        min={0}
        step={1000}
        disabled={!state[key].on}
        value={state[key].cost}
        suppressHydrationWarning
        onChange={(e) => update({ ...state, [key]: { ...state[key], cost: Number(e.target.value) } })}
        className={inputCls}
      />
    </label>
  );

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-sm font-bold">
        Escenario de reforma
        <InfoTip text={REFORM_HELP} />{" "}
        <span className="font-normal text-neutral-500">
          ({rent_n} alquileres comparables{band ? ` · ${band}` : ""})
        </span>
      </h3>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto_1.15fr]">
        {/* Rent range of comparables */}
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-neutral-500">
            <span>P25 (sin reformar)</span>
            <span>mediana</span>
            <span>P75 (reformado)</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
            {rent_p75 > rent_p25 && (
              <>
                {/* upside captured by the CURRENT scope */}
                <div
                  className="absolute inset-y-0 rounded-r-full bg-emerald-400 dark:bg-emerald-600"
                  style={{ left: `${medianPct}%`, width: `${(100 - medianPct) * scope}%` }}
                  title={`Margen capturado por esta reforma (${Math.round(scope * 100)}%)`}
                />
                <span
                  className="absolute -top-[3px] h-[17px] w-[3px] -translate-x-1/2 rounded bg-neutral-900 dark:bg-white"
                  style={{ left: `${medianPct}%` }}
                  title={`mediana ${fmtAED(median_rent)}`}
                />
              </>
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-xs font-semibold">
            <span>{fmtAED(rent_p25)}</span>
            <span className="text-neutral-500">{fmtAED(median_rent)}</span>
            <span>{fmtAED(rent_p75)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="inline-block h-2 w-3 rounded-sm bg-emerald-400 dark:bg-emerald-600" />
            margen capturado por esta reforma ({Math.round(scope * 100)}% del total)
          </div>
          <p className={`mt-2 text-xs ${spreadReading.cls}`}>
            Dispersión {fmtPct(spread, 0)} de la mediana — {spreadReading.txt}
          </p>
        </div>

        <div className="hidden w-px bg-neutral-200 lg:block dark:bg-neutral-800" />

        {/* Itemized reform */}
        <div className="text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Partidas de la reforma</span>
            <span className="text-[10px] text-neutral-400">% del margen · coste AED</span>
          </div>

          {/* Mobiliario: checkbox + type selector */}
          <label className={rowCls}>
            <input
              type="checkbox"
              checked={state.mobiliario.on}
              onChange={(e) => update({ ...state, mobiliario: { ...state.mobiliario, on: e.target.checked } })}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            <span className="text-xs">Mobiliario</span>
            <select
              disabled={!state.mobiliario.on}
              value={state.mobiliario.tipo}
              onChange={(e) => {
                const tipo = e.target.value as FurnitureType;
                const cost = sizeSqft ? Math.round(sizeSqft * ITEMS.mobiliario.defaults[tipo]) : state.mobiliario.cost;
                update({ ...state, mobiliario: { ...state.mobiliario, tipo, cost } });
              }}
              className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="comprado">comprado</option>
              <option value="medida">a medida</option>
            </select>
            <span className="flex-1" />
            <span className="text-[10px] text-neutral-400">
              +{Math.round(ITEMS.mobiliario.weights[state.mobiliario.tipo] * 100)}%
            </span>
            <input
              type="number"
              min={0}
              step={1000}
              disabled={!state.mobiliario.on}
              value={state.mobiliario.cost}
              suppressHydrationWarning
              onChange={(e) => update({ ...state, mobiliario: { ...state.mobiliario, cost: Number(e.target.value) } })}
              className={inputCls}
            />
          </label>

          {itemRow("suelo", "Suelo", ITEMS.suelo.weight)}
          {itemRow("paredes", "Paredes (pintura y arreglos)", ITEMS.paredes.weight)}
          {itemRow("techos", "Techos (falso techo, iluminación)", ITEMS.techos.weight)}

          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-neutral-200 pt-2 text-xs dark:border-neutral-800">
            <span className="text-neutral-500">Coste total</span>
            <b>{fmtAED(totalCost)}</b>
            <span className="text-neutral-500">Renta esperada post-reforma</span>
            <b>
              {fmtAED(Math.round(expectedRent))}
              <span className="ml-1 font-normal text-neutral-400">({Math.round(scope * 100)}% del margen)</span>
            </b>
            <span className="text-neutral-500">Yield actual (mediana / precio)</span>
            <b>{fmtPct(asking_yield)}</b>
            <span className="text-neutral-500">Yield post-reforma</span>
            <b className={postReformYield > (asking_yield ?? 0) ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
              {fmtPct(postReformYield)}
            </b>
            <span className="text-neutral-500">Renta extra al año</span>
            <b>{fmtAED(Math.round(capturedUplift))}</b>
            <span className="text-neutral-500">Payback de la reforma</span>
            <b>{paybackYears != null ? `${paybackYears.toFixed(1)} años` : "—"}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
