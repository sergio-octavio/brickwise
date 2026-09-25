import { getDb } from "./db";

/** Partida de gasto personal (fuera de la vivienda), editable por el usuario. */
export interface PersonalExpense {
  name: string;
  amount: number;
}

/**
 * Constantes [CONFIG] del modelo financiero (spec Dubái jul-2026). Todas las
 * fracciones se guardan como tal (0.0425, no 4.25). Los valores editados en
 * /settings viven en la tabla `settings` y pisan estos defaults.
 */
export interface AppConfig {
  // Hipoteca
  mortgage_rate: number;
  mortgage_term_years: number;
  ltv_first: number;
  ltv_second: number;
  mortgage_reg_pct: number;
  mortgage_reg_fixed: number;
  valuation_fee: number;
  arrangement_fee_pct: number;
  life_insurance_pct: number;
  // Costes de compra
  dld_pct: number;
  dld_admin_fee: number;
  trustee_fee_below_500k: number;
  trustee_fee_above_500k: number;
  trustee_vat_pct: number;
  agent_fee_pct: number;
  agent_vat_pct: number;
  // Explotación
  maintenance_pct: number;
  home_insurance_annual: number;
  vacancy_pct: number;
  service_charge_default: number;
  /** DEWA (luz + agua): lo paga QUIEN VIVE. Solo cuenta si vives tú. */
  dewa_monthly: number;
  /** Chiller/AC: en district cooling lo paga el ocupante; 0 si chiller-free. */
  cooling_monthly: number;
  // Perfil
  monthly_salary: number;
  dbr_max: number;
  existing_monthly_payments: number;
  second_home_default: boolean;
  // Plan "vivo primero, alquilo después"
  /** true = compras para vivir tú primero: el veredicto usa el ahorro de
   *  alquiler en vez del cash-on-cash (que no aplica sin inquilino). */
  strategy_residence: boolean;
  /** Gastos personales mensuales (comida, gym, móvil…), sin la vivienda. */
  personal_expenses: PersonalExpense[];
  residence_years: number;
  /** Lo que pagas hoy de alquiler: la referencia para saber si vivir ahí te ahorra. */
  current_rent_monthly: number;
  /** Reforma ligera + amueblado, de una vez. */
  reform_furnish_cost: number;
  /** Subida de renta esperada tras reformar y amueblar. */
  reform_rent_uplift: number;
  // Umbrales de decisión
  net_yield_good: number;
  coc_good: number;
  /** Descuento de la 2ª mano frente a obra nueva entregada en la misma zona. */
  new_build_discount: number;
  /** Pedir este % o más sobre la mediana de comparables = sobreprecio. */
  price_premium_bad: number;
  /** Pedir este % o más por DEBAJO de la mediana = chollo. */
  price_discount_good: number;
  /** Ventas comparables mínimas para fiarse del "vs mediana". */
  price_min_sale_n: number;
  /** Nº mínimo de off-plan comparables para que el momentum cuente. */
  momentum_min_projects: number;
  /** Caída de precio en el escenario bajista (choque de oferta al entregarse). */
  supply_pressure_bear: number;
  // STR
  usd_to_aed: number;
  str_peak_nights: number;
  str_mgmt_pct: number;
  tourism_dirham_per_night: number;
  dtcm_permit_annual: number;
  str_utilities_monthly: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  mortgage_rate: 0.0425,
  mortgage_term_years: 25,
  ltv_first: 0.8,
  ltv_second: 0.65,
  mortgage_reg_pct: 0.0025,
  mortgage_reg_fixed: 290,
  valuation_fee: 2900,
  arrangement_fee_pct: 0.005,
  life_insurance_pct: 0.004,
  dld_pct: 0.04,
  dld_admin_fee: 580,
  trustee_fee_below_500k: 2100,
  trustee_fee_above_500k: 4200,
  trustee_vat_pct: 0.05,
  agent_fee_pct: 0.02,
  agent_vat_pct: 0.05,
  maintenance_pct: 0.05,
  home_insurance_annual: 750,
  vacancy_pct: 0.06,
  service_charge_default: 15,
  dewa_monthly: 400,
  cooling_monthly: 300,
  monthly_salary: 16000,
  dbr_max: 0.5,
  existing_monthly_payments: 0,
  second_home_default: false,
  strategy_residence: true,
  personal_expenses: [
    { name: "Comida", amount: 2000 },
    { name: "Transporte", amount: 1000 },
    { name: "Gimnasio", amount: 300 },
    { name: "Teléfono", amount: 150 },
    { name: "Wifi", amount: 350 },
    { name: "Ocio y otros", amount: 2000 },
  ],
  residence_years: 2,
  current_rent_monthly: 3500,
  reform_furnish_cost: 35000,
  reform_rent_uplift: 0.12,
  net_yield_good: 0.06,
  coc_good: 0.08,
  new_build_discount: 0.15,
  price_premium_bad: 0.1,
  price_discount_good: 0.1,
  price_min_sale_n: 5,
  momentum_min_projects: 2,
  supply_pressure_bear: 0.1,
  usd_to_aed: 3.6725,
  str_peak_nights: 45,
  str_mgmt_pct: 0,
  tourism_dirham_per_night: 10,
  dtcm_permit_annual: 800,
  str_utilities_monthly: 550,
};

export function getConfig(): AppConfig {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const cfg: AppConfig = { ...DEFAULT_CONFIG };
  for (const r of rows) {
    if (!(r.key in DEFAULT_CONFIG)) continue;
    try {
      const v = JSON.parse(r.value);
      const def = DEFAULT_CONFIG[r.key as keyof AppConfig];
      // Las partidas de gasto son un array de {name, amount}: se valida aparte
      // para no aceptar cualquier objeto que venga de la BD.
      if (Array.isArray(def)) {
        if (Array.isArray(v)) {
          const clean = (v as unknown[])
            .filter((x): x is PersonalExpense => {
              const e = x as PersonalExpense;
              return !!e && typeof e.name === "string" && typeof e.amount === "number" && Number.isFinite(e.amount);
            })
            .map((e) => ({ name: e.name.slice(0, 40), amount: Math.max(0, e.amount) }));
          (cfg as unknown as Record<string, unknown>)[r.key] = clean;
        }
      } else if (typeof v === typeof def) {
        (cfg as unknown as Record<string, unknown>)[r.key] = v;
      }
    } catch {}
  }
  return cfg;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const db = getDb();
  const ins = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_CONFIG) || value == null) continue;
      ins.run(key, JSON.stringify(value));
    }
  });
  tx();
  return getConfig();
}

export function resetConfig(): AppConfig {
  getDb().prepare(`DELETE FROM settings`).run();
  return getConfig();
}
