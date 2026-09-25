import type { AppConfig } from "./config";

/** Cuota mensual estándar de amortización francesa. */
export function pmt(annualRate: number, years: number, principal: number): number {
  const n = years * 12;
  if (n <= 0 || principal <= 0) return 0;
  if (annualRate === 0) return principal / n;
  const r = annualRate / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export interface FinanceInput {
  price: number;
  sizeSqft: number | null;
  /** Renta anual mediana de comparables (analyses.median_rent). */
  annualRent: number | null;
  /** AED/sqft/año ya resuelto: override → zona → default. */
  serviceChargeRate: number | null;
  dldWaiver: boolean;
  secondHome: boolean;
  cfg: AppConfig;
}

export interface FinanceResult {
  service_charge_rate: number | null;
  /** Etiqueta de la fuente de la tasa ("Mollak: X, 2024", "estimación JVC"…). */
  service_charge_source?: string | null;
  service_charges_annual: number | null;
  net_yield: number | null;
  loan_amount: number | null;
  monthly_payment: number | null;
  cash_upfront: number | null;
  cash_on_cash: number | null;
  dbr_ok: boolean | null;
}

export const EMPTY_FINANCE: FinanceResult = {
  service_charge_rate: null,
  service_charge_source: null,
  service_charges_annual: null,
  net_yield: null,
  loan_amount: null,
  monthly_payment: null,
  cash_upfront: null,
  cash_on_cash: null,
  dbr_ok: null,
};

/**
 * Modelo del spec §2-§4: coste upfront, hipoteca y yields con costes.
 * Hipoteca/upfront/DBR solo necesitan precio; neta y cash-on-cash además
 * exigen renta y service charges (sqft × tasa) — si faltan, quedan a null
 * en vez de inventar un número.
 */
export function computeFinance(i: FinanceInput): FinanceResult {
  const { price, cfg } = i;
  if (!(price > 0)) return EMPTY_FINANCE;

  const ltv = i.secondHome ? cfg.ltv_second : cfg.ltv_first;
  const loan = price * ltv;
  const downPayment = price - loan;
  const dld = i.dldWaiver ? 0 : price * cfg.dld_pct + cfg.dld_admin_fee;
  const trustee =
    (price < 500_000 ? cfg.trustee_fee_below_500k : cfg.trustee_fee_above_500k) * (1 + cfg.trustee_vat_pct);
  const agent = price * cfg.agent_fee_pct * (1 + cfg.agent_vat_pct);
  const mortgageFees =
    loan * cfg.mortgage_reg_pct + cfg.mortgage_reg_fixed + cfg.valuation_fee + loan * cfg.arrangement_fee_pct;
  const cashUpfront = downPayment + dld + trustee + agent + mortgageFees;

  const monthly = pmt(cfg.mortgage_rate, cfg.mortgage_term_years, loan);
  const dbrOk = monthly <= cfg.monthly_salary * cfg.dbr_max - cfg.existing_monthly_payments;

  const scRate = i.serviceChargeRate;
  const scAnnual = i.sizeSqft != null && scRate != null ? i.sizeSqft * scRate : null;

  let netYield: number | null = null;
  let cashOnCash: number | null = null;
  if (i.annualRent != null && scAnnual != null) {
    const effectiveRent = i.annualRent * (1 - cfg.vacancy_pct);
    const maintenance = i.annualRent * cfg.maintenance_pct;
    netYield = (effectiveRent - scAnnual - cfg.home_insurance_annual - maintenance) / price;
    const lifeInsurance = loan * cfg.life_insurance_pct;
    cashOnCash = (effectiveRent - scAnnual - 12 * monthly - cfg.home_insurance_annual - lifeInsurance) / cashUpfront;
  }

  return {
    service_charge_rate: scRate,
    service_charges_annual: scAnnual,
    net_yield: netYield,
    loan_amount: loan,
    monthly_payment: monthly,
    cash_upfront: cashUpfront,
    cash_on_cash: cashOnCash,
    dbr_ok: dbrOk,
  };
}

/**
 * Veredicto de compra según la ESTRATEGIA, no una vara única.
 *
 * - Modo inversión (alquilas desde el día 1): neta ≥ umbral Y cash-on-cash ≥
 *   umbral. El CoC manda porque es lo que rinde tu dinero desde el principio.
 * - Modo residencia (vives tú primero): el CoC no aplica — no hay inquilino ni
 *   renta. Lo que importa es que vivir ahí salga más barato que tu alquiler
 *   actual (así el piso se paga solo mientras amortizas) y que, cuando lo
 *   alquiles, sea rentable de verdad (neta ≥ umbral).
 *
 * null = faltan datos para juzgarlo.
 */
export function meetsBuyCriteria(
  a: { net_yield: number | null; cash_on_cash: number | null; live_monthly_delta: number | null },
  cfg: { net_yield_good: number; coc_good: number; strategy_residence: boolean }
): boolean | null {
  if (a.net_yield == null) return null;
  if (cfg.strategy_residence) {
    if (a.live_monthly_delta == null) return null;
    return a.net_yield >= cfg.net_yield_good && a.live_monthly_delta <= 0;
  }
  if (a.cash_on_cash == null) return null;
  return a.net_yield >= cfg.net_yield_good && a.cash_on_cash >= cfg.coc_good;
}

export interface LeverageBreakeven {
  /** Neta a la que el CoC la iguala. Por encima el apalancamiento amplifica. */
  netYield: number;
  /** Cuota anual como fracción del PRÉSTAMO (el "6,5%"). */
  mortgageAnnualPct: number;
  /** Cash upfront como fracción del PRECIO. */
  cashPct: number;
  /** Costes de compra (todo menos la entrada) como fracción del precio. */
  costsPct: number;
  /** Dónde estaría el cruce si solo pusieras la entrada, sin costes. */
  netYieldNoCosts: number;
}

/**
 * Punto en el que el apalancamiento deja de ayudar: la neta a la que el
 * cash-on-cash la alcanza.
 *
 * La intuición habitual ("si el piso rinde más que el interés, la hipoteca
 * gana") falla porque los tres porcentajes se miden sobre bases distintas: la
 * cuota sobre el PRÉSTAMO, la neta sobre el PRECIO y el CoC sobre el CASH que
 * pones. Los costes de compra (DLD, agente, trustee, fees) no producen renta
 * pero engordan ese cash, y por eso suben el listón varias décimas.
 *
 * Se resuelve numéricamente porque neta y CoC no restan exactamente los mismos
 * gastos (mantenimiento en una, seguro de vida en el otro).
 */
export function leverageBreakeven(
  cfg: AppConfig,
  price = 400_000,
  dldWaiver = false,
  /** Piso de referencia: la banda del usuario, con el service charge por defecto. */
  sizeSqft = 450
): LeverageBreakeven | null {
  const base = {
    price,
    sizeSqft,
    serviceChargeRate: cfg.service_charge_default,
    dldWaiver,
    secondHome: false,
    cfg,
  };
  const solve = (cashOf: (f: FinanceResult) => number) => {
    for (let rent = price * 0.02; rent < price * 0.3; rent += price * 0.00005) {
      const f = computeFinance({ ...base, annualRent: rent });
      if (f.net_yield == null || f.loan_amount == null) continue;
      const effective = rent * (1 - cfg.vacancy_pct);
      const coc =
        (effective -
          (f.service_charges_annual ?? 0) -
          12 * (f.monthly_payment ?? 0) -
          cfg.home_insurance_annual -
          f.loan_amount * cfg.life_insurance_pct) /
        cashOf(f);
      if (coc >= f.net_yield) return f.net_yield;
    }
    return null;
  };

  const ref = computeFinance({ ...base, annualRent: price * 0.08 });
  if (ref.cash_upfront == null || ref.loan_amount == null) return null;
  const downPayment = price - ref.loan_amount;

  const netYield = solve((f) => f.cash_upfront as number);
  const netYieldNoCosts = solve(() => downPayment);
  if (netYield == null || netYieldNoCosts == null) return null;

  return {
    netYield,
    mortgageAnnualPct: (12 * pmt(cfg.mortgage_rate, cfg.mortgage_term_years, 1)) / 1,
    cashPct: ref.cash_upfront / price,
    costsPct: (ref.cash_upfront - downPayment) / price,
    netYieldNoCosts,
  };
}

export interface ResidencePlanInput {
  price: number;
  monthlyPayment: number;
  loanAmount: number;
  cashUpfront: number;
  serviceChargesAnnual: number | null;
  /** Renta anual mediana de comparables HOY (base para la post-reforma). */
  annualRent: number | null;
  /** P75 de rentas del edificio: techo real de lo que da una reforma. */
  rentP75: number | null;
  residenceYears: number;
  currentRentMonthly: number;
  reformCost: number;
  rentUplift: number;
  /** Cash upfront del SIGUIENTE piso (2ª vivienda, LTV menor). */
  nextDepositTarget?: number | null;
  /** Coste de frío del edificio; 0 si es chiller-free. Cae al global si falta. */
  coolingMonthly?: number;
  cfg: AppConfig;
}

export interface ResidencePlanResult {
  // Fase 1 — vives tú (no hay renta)
  /** Cuota + service charges + seguro. Base COMPARABLE con un alquiler:
   *  excluye DEWA y chiller porque los pagarías igual viviendo de alquiler. */
  monthly_cost: number;
  /** Coste real de ocupación: lo anterior + DEWA + chiller. */
  monthly_cost_full: number;
  utilities_monthly: number;
  personal_expenses_total: number;
  /** Ingresos − gastos personales − coste real de la vivienda. */
  savings_capacity: number;
  /** + = vivir ahí te cuesta más que tu alquiler actual; − = ahorras. */
  monthly_delta: number;
  phase1_total_delta: number;
  /** Capital de la hipoteca amortizado durante la residencia (patrimonio). */
  equity_built: number;
  /** Meses para juntar la entrada del siguiente piso viviendo en este. */
  months_to_next: number | null;
  // Fase 2 — lo alquilas, ya reformado y amueblado
  post_reform_rent: number | null;
  /** true = el uplift pedido supera el P75 del edificio y se ha recortado. */
  rent_capped: boolean;
  total_invested: number;
  deferred_net_yield: number | null;
  deferred_coc: number | null;
}

/** Saldo pendiente del préstamo tras `months` cuotas (francés). */
function remainingBalance(principal: number, annualRate: number, years: number, months: number): number {
  const n = years * 12;
  if (n <= 0 || principal <= 0) return 0;
  const m = Math.min(months, n);
  if (annualRate === 0) return principal * (1 - m / n);
  const r = annualRate / 12;
  const pow = (k: number) => Math.pow(1 + r, k);
  return (principal * (pow(n) - pow(m))) / (pow(n) - 1);
}

/**
 * Plan "vivo primero, alquilo después": durante la residencia no hay renta, así
 * que el CoC clásico no aplica — lo que importa es cuánto te cuesta vivir ahí
 * frente a tu alquiler actual, y cuánto capital amortizas. Al mudarte, el CoC
 * se calcula ya con la renta post-reforma y con la reforma incluida en el cash
 * invertido (que es lo que el CoC estándar de la app no hace).
 */
export function computeResidencePlan(i: ResidencePlanInput): ResidencePlanResult | null {
  const { cfg } = i;
  if (!(i.price > 0) || !(i.monthlyPayment > 0)) return null;

  const scMonthly = (i.serviceChargesAnnual ?? 0) / 12;
  // Base comparable con alquilar: DEWA y chiller quedan fuera porque los pagas
  // vivas donde vivas, así que no distinguen comprar de alquilar.
  const monthlyCost = i.monthlyPayment + scMonthly + cfg.home_insurance_annual / 12;
  const monthlyDelta = monthlyCost - i.currentRentMonthly;
  const months = Math.max(0, Math.round(i.residenceYears * 12));

  const utilities = cfg.dewa_monthly + (i.coolingMonthly ?? cfg.cooling_monthly);
  const monthlyCostFull = monthlyCost + utilities;
  const personalTotal = (cfg.personal_expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0);
  const savingsCapacity = cfg.monthly_salary - personalTotal - monthlyCostFull;

  const equityBuilt =
    i.loanAmount > 0
      ? i.loanAmount - remainingBalance(i.loanAmount, cfg.mortgage_rate, cfg.mortgage_term_years, months)
      : 0;

  // El techo lo pone el EDIFICIO, no tu presupuesto: por muy bien que reformes,
  // un estudio no se alquila por encima del mejor estudio de su misma torre.
  const wanted = i.annualRent != null ? i.annualRent * (1 + i.rentUplift) : null;
  const capped = wanted != null && i.rentP75 != null && wanted > i.rentP75;
  const postRent = wanted == null ? null : capped ? (i.rentP75 as number) : wanted;
  const totalInvested = i.cashUpfront + i.reformCost;

  let netYield: number | null = null;
  let coc: number | null = null;
  if (postRent != null && i.serviceChargesAnnual != null) {
    const effective = postRent * (1 - cfg.vacancy_pct);
    const maintenance = postRent * cfg.maintenance_pct;
    // La base del activo tras reformar es precio + lo invertido en la reforma.
    netYield =
      (effective - i.serviceChargesAnnual - cfg.home_insurance_annual - maintenance) / (i.price + i.reformCost);
    const lifeIns = i.loanAmount * cfg.life_insurance_pct;
    coc =
      (effective - i.serviceChargesAnnual - 12 * i.monthlyPayment - cfg.home_insurance_annual - lifeIns) /
      totalInvested;
  }

  // Ritmo real hacia el 2º piso: lo que te sobra cada mes con este piso ya
  // pagado (el alquiler evitado ya está dentro, porque no lo pagas).
  const monthsToNext =
    i.nextDepositTarget != null && i.nextDepositTarget > 0 && savingsCapacity > 0
      ? i.nextDepositTarget / savingsCapacity
      : null;

  return {
    monthly_cost: monthlyCost,
    monthly_cost_full: monthlyCostFull,
    utilities_monthly: utilities,
    personal_expenses_total: personalTotal,
    savings_capacity: savingsCapacity,
    monthly_delta: monthlyDelta,
    phase1_total_delta: monthlyDelta * months,
    equity_built: equityBuilt,
    months_to_next: monthsToNext,
    post_reform_rent: postRent,
    rent_capped: capped,
    total_invested: totalInvested,
    deferred_net_yield: netYield,
    deferred_coc: coc,
  };
}

export interface AppreciationResult {
  offplan_n: number;
  offplan_psqft: number;
  offplan_handover: string | null;
  future_psqft: number | null;
  /** Escenario alcista: convergencia con el precio de entrega del off-plan. */
  appreciation_pct_yr: number | null;
  /** Escenario bajista: choque de oferta al entregarse el pipeline. */
  appreciation_pct_yr_bear: number | null;
  offplan_primary_psqft: number | null;
  offplan_resale_psqft: number | null;
  /** Prima de las reventas sobre el precio de lista del developer. */
  resale_premium: number | null;
  /** Días en mercado (mediana) de las reventas off-plan. */
  resale_dom_days: number | null;
}

export type DemandSignal = "fuerte" | "neutral" | "debil";

/**
 * Voto del mercado sobre qué escenario gana. Que las reventas off-plan se
 * ofrezcan POR ENCIMA del precio de lista del developer = demanda real fuerte;
 * "below OP" = distress. Reventas listadas >90 días degradan la señal un nivel.
 */
export function demandSignal(
  resalePremium: number | null,
  resaleDomDays: number | null
): DemandSignal | null {
  if (resalePremium == null) return null;
  let level: DemandSignal = resalePremium >= 0.05 ? "fuerte" : resalePremium <= -0.05 ? "debil" : "neutral";
  if (resaleDomDays != null && resaleDomDays > 90) {
    level = level === "fuerte" ? "neutral" : "debil";
  }
  return level;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Revalorización estimada de un anuncio READY a partir del off-plan colindante:
 * los proyectos vecinos marcan a qué AED/sqft se está vendiendo la zona "a
 * futuro". Al entregarse, la 2ª mano converge hacia ese nivel menos un
 * descuento por no ser obra nueva [CONFIG]. La tasa anual sale de comparar el
 * AED/sqft actual del anuncio con ese precio futuro en el tiempo que queda
 * hasta la entrega mediana. Señal, no promesa: mucho pipeline también es
 * riesgo de sobreoferta (spec §7.2).
 */
// El AED/sqft depende MUCHO del tamaño (un estudio cotiza bastante más por
// sqft que un 2BR): solo se comparan off-plan de tamaño similar al anuncio.
const APPRECIATION_SIZE_TOLERANCE = 0.3;

export function computeAppreciation(
  listingPsqft: number | null,
  listingSizeSqft: number | null,
  allComps: {
    price_per_sqft: number;
    handover_date: string | null;
    size_sqft: number | null;
    sale_type: string | null;
    listed_date: string | null;
  }[],
  cfg: AppConfig,
  nowMs: number
): AppreciationResult | null {
  // Solo cuentan off-plan con fecha de entrega FUTURA: en PF hay anuncios mal
  // etiquetados como off-plan (edificios viejos ya entregados) y esos no traen
  // project.delivery_date, o la traen pasada — no deben mover la mediana.
  const comps =
    listingSizeSqft != null && listingSizeSqft > 0
      ? allComps.filter((c) => {
          if (c.size_sqft == null) return false;
          if (Math.abs(c.size_sqft - listingSizeSqft) / listingSizeSqft > APPRECIATION_SIZE_TOLERANCE) return false;
          const t = c.handover_date ? Date.parse(c.handover_date) : NaN;
          return Number.isFinite(t) && t > nowMs;
        })
      : [];
  if (!comps.length) return null;
  const med = median(comps.map((c) => c.price_per_sqft))!;

  const handovers = comps.map((c) => Date.parse(c.handover_date as string)).sort((a, b) => a - b);
  const handover: number | null = handovers[Math.floor(handovers.length / 2)];

  const YEAR = 365.25 * 24 * 3600 * 1000;
  const years = handover != null ? Math.max(0.5, (handover - nowMs) / YEAR) : null;

  // Escenario alcista: convergencia hacia el precio de entrega − descuento 2ª mano.
  const future = med * (1 - cfg.new_build_discount);
  let pctYr: number | null = null;
  if (listingPsqft != null && listingPsqft > 0 && years != null) {
    pctYr = Math.pow(future / listingPsqft, 1 / years) - 1;
  }

  // Escenario bajista: el precio actual cae supply_pressure_bear hasta la entrega.
  const pctYrBear = years != null ? Math.pow(1 - cfg.supply_pressure_bear, 1 / years) - 1 : null;

  // Señal de demanda: prima de reventas sobre precio de lista del developer.
  const primaryMed = median(comps.filter((c) => c.sale_type === "primary").map((c) => c.price_per_sqft));
  const resaleMed = median(comps.filter((c) => c.sale_type === "resale").map((c) => c.price_per_sqft));
  const resalePremium = primaryMed != null && resaleMed != null && primaryMed > 0 ? resaleMed / primaryMed - 1 : null;
  const resaleDom = median(
    comps
      .filter((c) => c.sale_type === "resale" && c.listed_date)
      .map((c) => (nowMs - Date.parse(c.listed_date as string)) / (24 * 3600 * 1000))
      .filter((d) => Number.isFinite(d) && d >= 0)
  );

  return {
    offplan_n: comps.length,
    offplan_psqft: med,
    offplan_handover: handover != null ? new Date(handover).toISOString().slice(0, 10) : null,
    future_psqft: future,
    appreciation_pct_yr: pctYr,
    appreciation_pct_yr_bear: pctYrBear,
    offplan_primary_psqft: primaryMed,
    offplan_resale_psqft: resaleMed,
    resale_premium: resalePremium,
    resale_dom_days: resaleDom != null ? Math.round(resaleDom) : null,
  };
}

export interface StrMarketData {
  slug: string;
  adr_usd: number | null;
  occupancy: number | null;
  revpar_usd: number | null;
  annual_revenue_usd: number | null;
  peak_adr_usd: number | null;
  peak_occupancy: number | null;
}

export interface StrInput {
  market: StrMarketData;
  annualRent: number | null;
  monthlyPayment: number | null;
  cfg: AppConfig;
}

export interface StrResult {
  str_slug: string;
  str_annual_revenue_aed: number | null;
  str_vs_rent: number | null;
  str_hybrid_income_aed: number | null;
  str_pct_mortgage_covered: number | null;
  /** AED/noche necesarios para igualar la renta larga a la ocupación del
   *  submercado. A diferencia del ADR prestado, esto lo puedes verificar
   *  mirando anuncios reales de la zona en Airbnb. */
  str_breakeven_adr: number | null;
}

/**
 * Spec §5: ingresos STR netos de costes (gestión, permiso DTCM, tourism dirham,
 * utilities) a partir del revenue anual medio del submercado AirROI, y el modo
 * híbrido §5.3 (vivir el año, alquilar solo N noches pico).
 */
export function computeStr(i: StrInput): StrResult {
  const { market: m, cfg } = i;
  const res: StrResult = {
    str_slug: m.slug,
    str_annual_revenue_aed: null,
    str_vs_rent: null,
    str_hybrid_income_aed: null,
    str_pct_mortgage_covered: null,
    str_breakeven_adr:
      i.annualRent != null && m.occupancy != null && m.occupancy > 0
        ? i.annualRent / (365 * m.occupancy)
        : null,
  };

  if (m.annual_revenue_usd != null && m.occupancy != null) {
    const gross = m.annual_revenue_usd * cfg.usd_to_aed;
    const costs =
      gross * cfg.str_mgmt_pct +
      cfg.dtcm_permit_annual +
      12 * cfg.str_utilities_monthly +
      cfg.tourism_dirham_per_night * 365 * m.occupancy;
    res.str_annual_revenue_aed = gross - costs;
    if (i.annualRent != null && i.annualRent > 0) res.str_vs_rent = res.str_annual_revenue_aed / i.annualRent;
  }

  if (m.peak_adr_usd != null && m.peak_occupancy != null) {
    const nights = cfg.str_peak_nights * m.peak_occupancy;
    res.str_hybrid_income_aed =
      nights * m.peak_adr_usd * cfg.usd_to_aed -
      nights * cfg.tourism_dirham_per_night -
      2 * cfg.str_utilities_monthly;
    if (i.monthlyPayment != null && i.monthlyPayment > 0) {
      res.str_pct_mortgage_covered = res.str_hybrid_income_aed / (12 * i.monthlyPayment);
    }
  }

  return res;
}
