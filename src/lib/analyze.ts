import { scrapeListing } from "./pf/listing";
import { getTransactions, syncTransactions } from "./pf/transactions";
import { computeReformBasis, computeYield, similarToTxRows } from "./yield";
import { discountVsTrend, psqftTrend } from "./trend";
import { ListingUnavailableError } from "./availability";
import {
  clearReplacement,
  getAnalysis,
  getListing,
  nearestManualGym,
  offplanNeighbors,
  saveAnalysis,
  setListingAvailability,
  upsertListing,
} from "./store";
import { getConfig } from "./config";
import { resolveServiceChargeRate } from "./serviceCharges";
import { resolveCooling } from "./cooling";
import { computeAppreciation, computeFinance, computeResidencePlan, computeStr, StrResult } from "./finance";
import { airroiSlugFor, getStrMarket } from "./airroi";
import { AnalysisRow, ListingRow } from "./types";

const ANALYSIS_TTL_MS = 24 * 3600 * 1000;

export interface AnalyzeResult {
  listing: ListingRow;
  analysis: AnalysisRow;
}

export interface AnalyzeOptions {
  /** Ignora el análisis cacheado y vuelve a scrapear. */
  force?: boolean;
  /**
   * Aborta con ListingUnavailableError si PF ya no lo sirve como activo. Lo usa
   * el alta de favoritos: los guardados de PF siguen apareciendo aunque el
   * anuncio esté retirado, y no queremos meter fantasmas en la cartera.
   */
  requireAvailable?: boolean;
}

/**
 * Full analysis of one listing: detail scrape (for photos/description/fallback
 * transactions), tower transaction history, yield computation and gym distance.
 */
export async function analyzeListing(
  id: string,
  url?: string,
  opts: AnalyzeOptions = {}
): Promise<AnalyzeResult> {
  let listing = getListing(id);
  const cached = getAnalysis(id);
  // Exigir disponibilidad obliga a bajar la ficha: el análisis cacheado no dice
  // nada de si el anuncio sigue vivo.
  if (
    !opts.force &&
    !opts.requireAvailable &&
    listing &&
    cached &&
    Date.now() - Date.parse(cached.computed_at) < ANALYSIS_TTL_MS
  ) {
    return { listing, analysis: cached };
  }

  const listingUrl = url || listing?.url;
  if (!listingUrl) throw new Error(`Unknown listing ${id} and no URL provided`);

  const detail = await scrapeListing(listingUrl);
  listing = upsertListing(detail.property, detail.citySlug);
  setListingAvailability(listing.id, detail.available);
  if (detail.available) clearReplacement(listing.id);
  else if (opts.requireAvailable) throw new ListingUnavailableError(listing.id);

  let buy = similarToTxRows(detail.property.similar_price_transactions?.buy || [], "buy");
  let rent = similarToTxRows(detail.property.similar_price_transactions?.rent || [], "rent");

  if (listing.tower_slug) {
    await syncTransactions(detail.citySlug, listing.tower_slug);
    const fullBuy = getTransactions(listing.tower_slug, "buy");
    const fullRent = getTransactions(listing.tower_slug, "rent");
    if (fullBuy.length) buy = fullBuy;
    if (fullRent.length) rent = fullRent;
  }

  const yieldRes = computeYield(listing.price, listing.size_sqft, listing.bedrooms, buy, rent);
  const gym =
    listing.lat != null && listing.lon != null
      ? nearestManualGym(listing.lat, listing.lon)
      : { gym_name: null, distance_m: null };

  const cfg = getConfig();
  const sc = resolveServiceChargeRate(listing, cfg);
  const fin = {
    ...computeFinance({
      price: listing.price,
      sizeSqft: listing.size_sqft,
      annualRent: yieldRes.median_rent,
      serviceChargeRate: sc.rate,
      dldWaiver: !!listing.dld_waiver,
      secondHome: listing.second_home != null ? !!listing.second_home : cfg.second_home_default,
      cfg,
    }),
    service_charge_source: sc.label,
  };

  // Aquí sí hay red (a diferencia de recompute); el TTL de 30 días lo abarata.
  let str: StrResult | null = null;
  const market = await getStrMarket(airroiSlugFor(listing.community_slug));
  if (market) {
    str = computeStr({ market, annualRent: yieldRes.median_rent, monthlyPayment: fin.monthly_payment, cfg });
  }

  const app =
    listing.completion_status === "offplan"
      ? null
      : computeAppreciation(listing.price_per_sqft, listing.size_sqft, offplanNeighbors(listing), cfg, Date.now());

  const secondUpfront = computeFinance({
    price: listing.price,
    sizeSqft: listing.size_sqft,
    annualRent: yieldRes.median_rent,
    serviceChargeRate: sc.rate,
    dldWaiver: !!listing.dld_waiver,
    secondHome: true,
    cfg,
  }).cash_upfront;
  const cooling = resolveCooling(listing, cfg);
  const live = computeResidencePlan({
    coolingMonthly: cooling.monthly,
    price: listing.price,
    monthlyPayment: fin.monthly_payment ?? 0,
    loanAmount: fin.loan_amount ?? 0,
    cashUpfront: fin.cash_upfront ?? 0,
    serviceChargesAnnual: fin.service_charges_annual,
    annualRent: yieldRes.median_rent,
    rentP75: yieldRes.rent_p75,
    residenceYears: cfg.residence_years,
    currentRentMonthly: cfg.current_rent_monthly,
    reformCost: cfg.reform_furnish_cost,
    rentUplift: cfg.reform_rent_uplift,
    nextDepositTarget: secondUpfront,
    cfg,
  });

  const trendRes = psqftTrend(buy, listing.size_sqft, listing.bedrooms);
  const trend = {
    trend_psqft: trendRes?.currentPsqft ?? null,
    discount_vs_trend: discountVsTrend(
      trendRes,
      listing.size_sqft && listing.size_sqft > 0 ? listing.price / listing.size_sqft : null
    ),
  };

  const basis = computeReformBasis(rent, listing.bedrooms, listing.size_sqft);
  saveAnalysis(listing.id, yieldRes, gym, fin, str, app, live, trend, cooling, basis);
  return { listing, analysis: getAnalysis(listing.id)! };
}
