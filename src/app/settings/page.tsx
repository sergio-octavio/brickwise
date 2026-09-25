"use client";

import { useEffect, useState } from "react";

interface AppConfig {
  [key: string]: number | boolean | PersonalExpense[];
}

interface ZoneRow {
  community_slug: string;
  community_name: string;
  aed_per_sqft: number;
  updated_at: string;
}

interface StrMapRow {
  community_slug: string;
  airroi_slug: string;
}

interface StrMarket {
  slug: string;
  adr_usd: number | null;
  occupancy: number | null;
  annual_revenue_usd: number | null;
  fetched_at: string;
}

interface PersonalExpense {
  name: string;
  amount: number;
}

interface MollakStatus {
  buildings: number;
  rows: number;
  latest_year: number | null;
  fetched_at: string | null;
}

const AIRROI_SLUGS = ["business-bay", "deira", "dubai", "dubai-marina", "emaar-beachfront"];

type FieldKind = "pct" | "aed" | "num" | "bool";

interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
}

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "Hipoteca",
    fields: [
      { key: "mortgage_rate", label: "Tipo de interés anual", kind: "pct", hint: "Referencia jul-2026: 3,9–4,6%" },
      { key: "mortgage_term_years", label: "Plazo (años)", kind: "num", hint: "Máx. 25; edad máx. 65 a vencimiento" },
      { key: "ltv_first", label: "LTV 1ª vivienda", kind: "pct", hint: "Máx. 80% (expat, <5M)" },
      { key: "ltv_second", label: "LTV 2ª vivienda", kind: "pct", hint: "Máx. 65% — clave para el 2º piso" },
      { key: "mortgage_reg_pct", label: "Registro hipoteca (% préstamo)", kind: "pct" },
      { key: "mortgage_reg_fixed", label: "Registro hipoteca (fijo)", kind: "aed" },
      { key: "valuation_fee", label: "Valoración del banco", kind: "aed" },
      { key: "arrangement_fee_pct", label: "Arrangement fee (% préstamo)", kind: "pct", hint: "0–1%, negociable" },
      { key: "life_insurance_pct", label: "Seguro de vida (% saldo/año)", kind: "pct" },
    ],
  },
  {
    title: "Costes de compra",
    fields: [
      { key: "dld_pct", label: "DLD transfer fee", kind: "pct", hint: "Impuesto de transmisión del Dubai Land Department (el \"ITP\" de Dubái). Lo paga el comprador salvo waiver" },
      { key: "dld_admin_fee", label: "DLD admin (fijo)", kind: "aed", hint: "Tasa administrativa fija del DLD por emitir el nuevo título de propiedad" },
      { key: "trustee_fee_below_500k", label: "Trustee (<500K)", kind: "aed", hint: "La \"notaría\" de Dubái: oficina autorizada donde se firma la compraventa. Tarifa fija según precio" },
      { key: "trustee_fee_above_500k", label: "Trustee (≥500K)", kind: "aed" },
      { key: "trustee_vat_pct", label: "VAT trustee", kind: "pct" },
      { key: "agent_fee_pct", label: "Comisión agente", kind: "pct", hint: "0 si compra directa a developer" },
      { key: "agent_vat_pct", label: "VAT agente", kind: "pct" },
    ],
  },
  {
    title: "Explotación",
    fields: [
      { key: "maintenance_pct", label: "Mantenimiento (% renta)", kind: "pct", hint: "5% edificio nuevo / 8-10% si es antiguo (más de ~8-10 años): averías de AC, fontanería y riesgo de derramas" },
      { key: "home_insurance_annual", label: "Seguro hogar (AED/año)", kind: "aed" },
      { key: "vacancy_pct", label: "Vacancia anual", kind: "pct", hint: "% del año que el piso está VACÍO entre un inquilino y el siguiente (sin cobrar renta mientras buscas inquilino nuevo). 6% ≈ 3 semanas/año, o 1 mes cada año y medio. Solo aplica al alquiler tradicional — nada que ver con STR ni con uso propio" },
      { key: "service_charge_default", label: "Service charge default (AED/sqft/año)", kind: "num", hint: "Si la zona no está en la tabla" },
      { key: "dewa_monthly", label: "DEWA: luz + agua (AED/mes)", kind: "aed", hint: "Lo paga QUIEN VIVE: cuenta solo si vives tú, no cuando lo alquilas (lo paga el inquilino)" },
      { key: "cooling_monthly", label: "Aire / chiller (AED/mes)", kind: "aed", hint: "District cooling lo paga el ocupante. Pon 0 si el edificio es chiller-free (va incluido en el service charge)" },
    ],
  },
  {
    title: "Tu perfil",
    fields: [
      { key: "monthly_salary", label: "Sueldo mensual", kind: "aed" },
      { key: "dbr_max", label: "DBR máximo", kind: "pct", hint: "Debt Burden Ratio: norma del Banco Central UAE — el banco no te da la hipoteca si TODAS tus cuotas juntas superan este % de tu sueldo. Con 16.000 AED al 50% → máx 8.000 AED/mes; cada hipoteca consume capacidad para la siguiente" },
      { key: "existing_monthly_payments", label: "Cuotas existentes (AED/mes)", kind: "aed" },
      { key: "second_home_default", label: "Analizar como 2ª vivienda", kind: "bool", hint: "LTV 65% y ~41% de cash upfront" },
    ],
  },
  {
    title: "Plan: vivo primero, alquilo después",
    fields: [
      { key: "strategy_residence", label: "Compro para vivir yo primero", kind: "bool", hint: "Cambia el criterio ✓ Compra: en vez de exigir cash-on-cash (que no existe sin inquilino), exige que vivir ahí salga más barato que tu alquiler actual y que sea rentable al alquilarlo después" },
      { key: "residence_years", label: "Años que vivirías en él", kind: "num", hint: "Durante esa fase no hay renta: el CoC clásico no aplica" },
      { key: "current_rent_monthly", label: "Tu alquiler actual (AED/mes)", kind: "aed", hint: "La referencia para saber si vivir en el piso te ahorra o te cuesta" },
      { key: "reform_furnish_cost", label: "Reforma + amueblado (AED)", kind: "aed", hint: "Se suma al cash invertido en el CoC diferido" },
      { key: "reform_rent_uplift", label: "Subida de renta tras reformar", kind: "pct", hint: "Spec: 5-10% por reforma cosmética + 10-15% por amueblado" },
    ],
  },
  {
    title: "Umbrales de decisión",
    fields: [
      { key: "net_yield_good", label: "Yield neto objetivo", kind: "pct" },
      { key: "coc_good", label: "Cash-on-cash objetivo", kind: "pct" },
      { key: "new_build_discount", label: "Descuento 2ª mano vs obra nueva", kind: "pct", hint: "Para la revalorización estimada: al entregarse el off-plan colindante, la 2ª mano converge hacia su precio menos este descuento" },
      { key: "price_premium_bad", label: "Sobreprecio vs mediana", kind: "pct", hint: "Pedir este % o más por encima de la mediana de ventas comparables se marca en rojo (spec §7.2: +10% = sobreprecio)" },
      { key: "price_discount_good", label: "Chollo vs mediana", kind: "pct", hint: "Pedir este % o más por DEBAJO de la mediana se marca en verde" },
      { key: "price_min_sale_n", label: "Ventas mínimas para juzgar precio", kind: "num", hint: "Con menos comparables la señal es ruido: se muestra 'n=X' en gris en vez de un porcentaje" },
      { key: "momentum_min_projects", label: "Proyectos mínimos para momentum", kind: "num", hint: "El veredicto ✓✓ Compra + momentum exige revalorización positiva con al menos este nº de off-plan comparables" },
      { key: "supply_pressure_bear", label: "Caída en escenario bajista", kind: "pct", hint: "Si la demanda no acompaña, la entrega del pipeline colindante presiona el precio a la baja. Este es el % de caída total (hasta la entrega mediana) del escenario pesimista" },
    ],
  },
  {
    title: "STR / Airbnb",
    fields: [
      { key: "usd_to_aed", label: "USD → AED", kind: "num", hint: "Peg fijo 3,6725" },
      { key: "str_peak_nights", label: "Noches pico/año (modo híbrido)", kind: "num", hint: "Semanas que alquilarías viviendo en el piso" },
      { key: "str_mgmt_pct", label: "Gestión STR (% ingresos)", kind: "pct", hint: "0 autogestión / 15-25% profesional" },
      { key: "tourism_dirham_per_night", label: "Tourism Dirham (AED/noche)", kind: "aed" },
      { key: "dtcm_permit_annual", label: "Permiso DET/DTCM (AED/año)", kind: "aed" },
      { key: "str_utilities_monthly", label: "Utilities+wifi (AED/mes)", kind: "aed" },
    ],
  },
];

function toDisplay(v: number | boolean, kind: FieldKind): string {
  if (kind === "bool") return "";
  if (kind === "pct") return String(Math.round((v as number) * 10000) / 100);
  return String(v);
}

function fromDisplay(s: string, kind: FieldKind): number | null {
  const n = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return kind === "pct" ? n / 100 : n;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [strMap, setStrMap] = useState<StrMapRow[]>([]);
  const [markets, setMarkets] = useState<StrMarket[]>([]);
  const [mollak, setMollak] = useState<MollakStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mollakBusy, setMollakBusy] = useState(false);
  const [expenses, setExpenses] = useState<PersonalExpense[] | null>(null);
  const [newExp, setNewExp] = useState({ name: "", amount: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [newZone, setNewZone] = useState({ slug: "", rate: "" });

  const load = () => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setConfig(j.config);
        setDraft({});
        setExpenses(j.config?.personal_expenses ?? []);
      });
    fetch("/api/service-charges")
      .then((r) => r.json())
      .then((j) => {
        setZones(j.zones || []);
        setStrMap(j.strMap || []);
        setMollak(j.mollak || null);
      });
    fetch("/api/str/refresh")
      .then((r) => r.json())
      .then((j) => setMarkets(j.markets || []));
  };
  useEffect(load, []);

  if (!config) return <p className="mx-auto max-w-5xl animate-pulse px-4 py-6 text-neutral-500">Cargando…</p>;

  const displayValue = (f: Field) => {
    if (draft[f.key] !== undefined) return draft[f.key];
    const v = config[f.key];
    // Las partidas de gasto tienen su propio editor, no un campo numérico.
    return Array.isArray(v) ? "" : toDisplay(v, f.kind);
  };

  const save = async (reset = false) => {
    setSaving(true);
    setMsg(null);
    const patch: Record<string, number | boolean> = {};
    for (const s of SECTIONS) {
      for (const f of s.fields) {
        if (f.kind === "bool") continue;
        const raw = draft[f.key];
        if (raw === undefined) continue;
        const v = fromDisplay(raw, f.kind);
        if (v != null) patch[f.key] = v;
      }
    }
    if (draft["second_home_default"] !== undefined) patch["second_home_default"] = draft["second_home_default"] === "1";
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reset ? { reset: true } : { patch }),
    });
    const j = await res.json();
    setSaving(false);
    if (j.error) setMsg(`Error: ${j.error}`);
    else {
      setConfig(j.config);
      setDraft({});
      setMsg(`Guardado — ${j.updated} análisis recalculados`);
    }
  };

  const saveZones = async (body: object) => {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/service-charges", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    setSaving(false);
    if (j.error) setMsg(`Error: ${j.error}`);
    else {
      setZones(j.zones || []);
      setStrMap(j.strMap || []);
      setMsg(`Guardado — ${j.updated} análisis recalculados`);
    }
  };

  const saveExpenses = async (list: PersonalExpense[]) => {
    setExpenses(list);
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { personal_expenses: list } }),
    });
    const j = await res.json();
    setSaving(false);
    if (j.error) setMsg(`Error: ${j.error}`);
    else {
      setConfig(j.config);
      setExpenses(j.config?.personal_expenses ?? []);
      setMsg(`Guardado — ${j.updated} análisis recalculados`);
    }
  };

  const refreshMollak = async () => {
    setMollakBusy(true);
    setMsg(null);
    const res = await fetch("/api/mollak/refresh", { method: "POST" });
    const j = await res.json();
    setMollakBusy(false);
    if (j.error) setMsg(`Error Mollak: ${j.error}`);
    else {
      setMollak(j.status || null);
      setMsg(
        `Mollak: ${j.buildings} edificios importados (fuente: ${j.source === "archive" ? "snapshot archive.org — Dubai Pulse no respondía" : "Dubai Pulse"}) — ${j.updated} análisis recalculados`
      );
    }
  };

  const refreshStr = async () => {
    setRefreshing(true);
    setMsg(null);
    const res = await fetch("/api/str/refresh", { method: "POST" });
    const j = await res.json();
    setRefreshing(false);
    if (j.error) setMsg(`Error: ${j.error}`);
    else {
      setMarkets(j.markets || []);
      setMsg(`AirROI actualizado (${(j.refreshed || []).join(", ")}) — ${j.updated} análisis recalculados`);
    }
  };

  const inputCls =
    "w-28 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-right text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Ajustes del modelo</h1>
        <div className="flex items-center gap-2">
          {msg && <span className="text-sm text-neutral-500">{msg}</span>}
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="btn-font rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Restaurar defaults
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving || Object.keys(draft).length === 0}
            className="btn-font rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar y recalcular"}
          </button>
        </div>
      </div>

      <p className="text-sm text-neutral-500">
        Constantes del modelo financiero (Dubái, jul-2026). Al guardar se recalculan todos los análisis con los nuevos
        valores, sin re-scrapear nada.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <section
            key={s.title}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">{s.title}</h2>
            <div className="flex flex-col gap-2">
              {s.fields.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {f.label}
                    {f.hint && <span className="block text-xs text-neutral-400">{f.hint}</span>}
                  </span>
                  {f.kind === "bool" ? (
                    <input
                      type="checkbox"
                      checked={
                        draft[f.key] !== undefined ? draft[f.key] === "1" : Boolean(config[f.key])
                      }
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked ? "1" : "0" }))}
                      className="h-4 w-4"
                    />
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={displayValue(f)}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        className={inputCls}
                      />
                      <span className="w-8 text-xs text-neutral-400">
                        {f.kind === "pct" ? "%" : f.kind === "aed" ? "AED" : ""}
                      </span>
                    </span>
                  )}
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-neutral-500">
          Presupuesto personal (gastos fuera de la vivienda)
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          Tus gastos mensuales <b>sin contar la casa</b>. Con tu sueldo ({Number(config.monthly_salary).toLocaleString()}{" "}
          AED/mes, en &quot;Tu perfil&quot;) y el coste de la vivienda de cada anuncio, la app calcula lo que te sobra
          al mes y cuánto tardas en juntar la entrada del siguiente piso. Luz, agua y aire NO van aquí: son de la
          vivienda y están en &quot;Explotación&quot;.
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {(expenses ?? []).map((e, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 text-sm">
              <input
                type="text"
                defaultValue={e.name}
                onBlur={(ev) => {
                  const name = ev.target.value.trim();
                  if (name && name !== e.name) {
                    const list = [...(expenses ?? [])];
                    list[idx] = { ...list[idx], name };
                    saveExpenses(list);
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm hover:border-neutral-300 focus:border-blue-500 focus:outline-none dark:hover:border-neutral-700"
              />
              <input
                type="text"
                inputMode="decimal"
                defaultValue={String(e.amount)}
                onBlur={(ev) => {
                  const amount = parseFloat(ev.target.value.replace(",", "."));
                  if (Number.isFinite(amount) && amount >= 0 && amount !== e.amount) {
                    const list = [...(expenses ?? [])];
                    list[idx] = { ...list[idx], amount };
                    saveExpenses(list);
                  }
                }}
                className={inputCls}
              />
              <button
                onClick={() => saveExpenses((expenses ?? []).filter((_, i) => i !== idx))}
                title="Quitar partida"
                className="px-1 text-neutral-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3 text-sm dark:border-neutral-800">
          <input
            type="text"
            placeholder="Nueva partida (p. ej. Seguro médico)"
            value={newExp.name}
            onChange={(e) => setNewExp((n) => ({ ...n, name: e.target.value }))}
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="AED/mes"
            value={newExp.amount}
            onChange={(e) => setNewExp((n) => ({ ...n, amount: e.target.value }))}
            className={inputCls}
          />
          <button
            onClick={() => {
              const amount = parseFloat(newExp.amount.replace(",", "."));
              if (newExp.name.trim() && Number.isFinite(amount) && amount >= 0) {
                saveExpenses([...(expenses ?? []), { name: newExp.name.trim(), amount }]);
                setNewExp({ name: "", amount: "" });
              }
            }}
            className="btn-font rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + Añadir
          </button>
        </div>
        {expenses && expenses.length > 0 && (
          <p className="mt-2 text-sm font-medium">
            Total gastos personales:{" "}
            <b>{expenses.reduce((s, e) => s + e.amount, 0).toLocaleString()} AED/mes</b>
            <span className="ml-2 font-normal text-neutral-500">
              → te quedan{" "}
              {(Number(config.monthly_salary) - expenses.reduce((s, e) => s + e.amount, 0)).toLocaleString()}{" "}
              AED/mes para vivienda y ahorro
            </span>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">
            Service charges oficiales por edificio (Mollak / Dubai Pulse)
          </h2>
          <button
            onClick={refreshMollak}
            disabled={mollakBusy}
            className="btn-font rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {mollakBusy ? "Descargando…" : mollak?.buildings ? "Actualizar datos Mollak" : "Descargar datos Mollak"}
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-400">
          Dataset abierto del DLD (dld_oa_service_charges, sistema Mollak aprobado por RERA): el service charge real de
          cada edificio en AED/sqft/año, sumando las categorías por sqft del uso residencial. Se actualiza una vez al
          año. Si Dubai Pulse no responde (geobloqueo fuera de UAE), se usa el último snapshot de archive.org.
          {mollak?.buildings ? (
            <span className="mt-1 block font-medium text-neutral-500">
              {mollak.buildings} edificios cargados · última anualidad {mollak.latest_year} · descargado{" "}
              {mollak.fetched_at?.slice(0, 10)}
            </span>
          ) : (
            <span className="mt-1 block font-medium text-amber-600 dark:text-amber-500">
              Aún sin datos — pulsa &quot;Descargar datos Mollak&quot;.
            </span>
          )}
        </p>
        <div className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
          <p className="mb-1.5 font-bold uppercase tracking-wide text-neutral-400">
            Consulta manual (si un edificio no sale o quieres el año en curso)
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Abre el{" "}
              <a
                href="https://dubailand.gov.ae/en/eservices/service-charge-index-overview/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                Service Charge Index del DLD ↗
              </a>{" "}
              y pulsa &quot;Access this service&quot; (es el mismo sistema Mollak, pero con el año en curso).
            </li>
            <li>
              Elige la <b>Master Community</b> (la zona: JVC, International City…) y luego el <b>edificio/proyecto</b>.
              Verás el AED/sqft aprobado por RERA, normalmente desglosado en General Fund + Reserve Fund — la suma es lo
              que va en el campo &quot;Service charge real&quot; de la ficha del anuncio.
            </li>
            <li>
              Alternativas: la app <b>Dubai REST</b> (iOS/Android, ficha del edificio → service charges) o el{" "}
              <a
                href="https://www.dubaipulse.gov.ae/data/dld-records/dld_oa_service_charges-open"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                dataset en Dubai Pulse ↗
              </a>{" "}
              (histórico completo, lo que importa esta app). Ambos pueden requerir IP de UAE.
            </li>
          </ol>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-neutral-500">
          Service charges por zona (AED/sqft/año)
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          Estimaciones por comunidad, usadas solo cuando el edificio no aparece en Mollak. Prioridad: override manual →
          Mollak (edificio) → zona → default.
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {zones.map((z) => (
            <div key={z.community_slug} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={z.community_slug}>
                {z.community_name || z.community_slug}
              </span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={String(z.aed_per_sqft)}
                onBlur={(e) => {
                  const rate = parseFloat(e.target.value.replace(",", "."));
                  if (Number.isFinite(rate) && rate > 0 && rate !== z.aed_per_sqft) {
                    saveZones({ zones: [{ slug: z.community_slug, name: z.community_name, rate }] });
                  }
                }}
                className={inputCls}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3 text-sm dark:border-neutral-800">
          <input
            type="text"
            placeholder="slug-de-la-zona"
            value={newZone.slug}
            onChange={(e) => setNewZone((n) => ({ ...n, slug: e.target.value }))}
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="AED/sqft"
            value={newZone.rate}
            onChange={(e) => setNewZone((n) => ({ ...n, rate: e.target.value }))}
            className={inputCls}
          />
          <button
            onClick={() => {
              const rate = parseFloat(newZone.rate.replace(",", "."));
              const slug = newZone.slug.trim().toLowerCase().replace(/\s+/g, "-");
              if (slug && Number.isFinite(rate) && rate > 0) {
                saveZones({ zones: [{ slug, name: newZone.slug.trim(), rate }] });
                setNewZone({ slug: "", rate: "" });
              }
            }}
            className="btn-font rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + Añadir zona
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Datos STR (AirROI)</h2>
          <button
            onClick={refreshStr}
            disabled={refreshing}
            className="btn-font rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {refreshing ? "Actualizando…" : "Actualizar datos AirROI"}
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-400">
          AirROI solo publica 5 submercados de Dubái; las comunidades sin mapeo usan el agregado de la ciudad
          (&quot;dubai&quot;). Valores en USD, convertidos con el peg.
        </p>
        {markets.length > 0 && (
          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-neutral-500">
                <th className="py-1">Submercado</th>
                <th className="py-1 text-right">ADR</th>
                <th className="py-1 text-right">Ocupación</th>
                <th className="py-1 text-right">Revenue/año</th>
                <th className="py-1 text-right">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.slug} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1">{m.slug}</td>
                  <td className="py-1 text-right">{m.adr_usd != null ? `$${Math.round(m.adr_usd)}` : "—"}</td>
                  <td className="py-1 text-right">
                    {m.occupancy != null ? `${(m.occupancy * 100).toFixed(1)} %` : "—"}
                  </td>
                  <td className="py-1 text-right">
                    {m.annual_revenue_usd != null ? `$${Math.round(m.annual_revenue_usd).toLocaleString()}` : "—"}
                  </td>
                  <td className="py-1 text-right text-xs text-neutral-500">{m.fetched_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 className="mb-1 text-xs font-semibold text-neutral-500">Mapeo comunidad → submercado</h3>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {strMap.map((m) => (
            <div key={m.community_slug} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{m.community_slug}</span>
              <select
                value={m.airroi_slug}
                onChange={(e) => saveZones({ strMap: [{ community_slug: m.community_slug, airroi_slug: e.target.value }] })}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {AIRROI_SLUGS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
