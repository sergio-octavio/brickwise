import { getDb } from "./db";
import { getTransactions } from "./pf/transactions";
import { computeReformBasis, computeYield } from "./yield";
import { discountVsTrend, psqftTrend } from "./trend";
import { backfillCommunities, nearestManualGym, offplanNeighbors, saveAnalysis } from "./store";
import { getConfig } from "./config";
import { resolveServiceChargeRate } from "./serviceCharges";
import { resolveCooling } from "./cooling";
import { computeAppreciation, computeFinance, computeResidencePlan, computeStr, StrResult } from "./finance";
import { airroiSlugFor, getCachedStrMarket } from "./airroi";
import { ListingRow } from "./types";

/**
 * Re-deriva un análisis desde datos ya cacheados (transacciones, config,
 * service charges, mercado STR). Nunca toca la red — por eso el STR usa solo
 * getCachedStrMarket; el fetch vive en analyzeListing y /api/str/refresh.
 */
export function recomputeListing(l: ListingRow) {
  const cfg = getConfig();
  const buy = l.tower_slug ? getTransactions(l.tower_slug, "buy") : [];
  const rent = l.tower_slug ? getTransactions(l.tower_slug, "rent") : [];
  const y = computeYield(l.price, l.size_sqft, l.bedrooms, buy, rent);
  const gym =
    l.lat != null && l.lon != null ? nearestManualGym(l.lat, l.lon) : { gym_name: null, distance_m: null };

  const sc = resolveServiceChargeRate(l, cfg);
  const fin = {
    ...computeFinance({
      price: l.price,
      sizeSqft: l.size_sqft,
      annualRent: y.median_rent,
      serviceChargeRate: sc.rate,
      dldWaiver: !!l.dld_waiver,
      secondHome: l.second_home != null ? !!l.second_home : cfg.second_home_default,
      cfg,
    }),
    service_charge_source: sc.label,
  };

  let str: StrResult | null = null;
  const market = getCachedStrMarket(airroiSlugFor(l.community_slug));
  if (market) {
    str = computeStr({ market, annualRent: y.median_rent, monthlyPayment: fin.monthly_payment, cfg });
  }

  // Revalorización por off-plan colindante — solo para anuncios no off-plan.
  const app =
    l.completion_status === "offplan"
      ? null
      : computeAppreciation(l.price_per_sqft, l.size_sqft, offplanNeighbors(l), cfg, Date.now());

  // Plan "vivo primero": coste de vivir ahí y ritmo hacia el siguiente piso.
  // La entrada del 2º sale del mismo modelo con LTV de segunda vivienda.
  const secondUpfront = computeFinance({
    price: l.price,
    sizeSqft: l.size_sqft,
    annualRent: y.median_rent,
    serviceChargeRate: sc.rate,
    dldWaiver: !!l.dld_waiver,
    secondHome: true,
    cfg,
  }).cash_upfront;
  const cooling = resolveCooling(l, cfg);
  const live = computeResidencePlan({
    coolingMonthly: cooling.monthly,
    price: l.price,
    monthlyPayment: fin.monthly_payment ?? 0,
    loanAmount: fin.loan_amount ?? 0,
    cashUpfront: fin.cash_upfront ?? 0,
    serviceChargesAnnual: fin.service_charges_annual,
    annualRent: y.median_rent,
    rentP75: y.rent_p75,
    residenceYears: cfg.residence_years,
    currentRentMonthly: cfg.current_rent_monthly,
    reformCost: cfg.reform_furnish_cost,
    rentUplift: cfg.reform_rent_uplift,
    nextDepositTarget: secondUpfront,
    cfg,
  });

  // El descuento vs tendencia se calculaba solo en el cliente de la ficha, por
  // eso no existía en mapa ni listados. Se persiste aquí.
  const trendRes = psqftTrend(buy, l.size_sqft, l.bedrooms);
  const askingPsqft = l.size_sqft && l.size_sqft > 0 ? l.price / l.size_sqft : null;
  const trend = {
    trend_psqft: trendRes?.currentPsqft ?? null,
    discount_vs_trend: discountVsTrend(trendRes, askingPsqft),
  };

  const basis = computeReformBasis(rent, l.bedrooms, l.size_sqft);
  saveAnalysis(l.id, y, gym, fin, str, app, live, trend, cooling, basis);
}

/** Recalcula todos los análisis almacenados; devuelve cuántos se actualizaron. */
export function recomputeAll(): number {
  backfillCommunities();
  const listings = getDb()
    .prepare(`SELECT l.* FROM listings l JOIN analyses a ON a.listing_id = l.id`)
    .all() as ListingRow[];
  for (const l of listings) recomputeListing(l);
  return listings.length;
}

export function recomputeOne(id: string): boolean {
  const l = getDb().prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as ListingRow | undefined;
  if (!l) return false;
  recomputeListing(l);
  return true;
}
