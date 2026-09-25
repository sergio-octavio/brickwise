import { ContactInfo } from "./agent";
import type { ReplacementInfo } from "./types";

export type PipelineStatus = "pendiente" | "contactado" | "visitado" | "oferta" | "adquirido" | "descartado";

export const PIPELINE_STATUSES: { id: PipelineStatus; label: string; dot: string }[] = [
  { id: "pendiente", label: "Pendiente", dot: "#9ca3af" },
  { id: "contactado", label: "Contactado", dot: "#3b82f6" },
  { id: "visitado", label: "Visitado", dot: "#8b5cf6" },
  { id: "oferta", label: "Oferta", dot: "#f59e0b" },
  { id: "adquirido", label: "Adquirido", dot: "#22c55e" },
  { id: "descartado", label: "Descartado", dot: "#ef4444" },
];

/** Shape served by GET /api/pipeline (PipelineCard + parsed images/contact). */
export interface PipelineCardDto {
  id: string;
  url: string;
  title: string;
  price: number;
  bedrooms: number | null;
  size_sqft: number | null;
  tower_name: string | null;
  asking_yield: number | null;
  gross_yield: number | null;
  net_yield: number | null;
  cash_on_cash: number | null;
  price_per_sqft: number | null;
  price_vs_median: number | null;
  sale_psqft_n: number | null;
  rent_psqft_median: number | null;
  rent_psqft_p75: number | null;
  rent_psqft_n: number | null;
  rent_n: number;
  notes: string;
  added_at: string;
  status: PipelineStatus;
  status_changed_at: string | null;
  group_ids: string[];
  last_activity_at: string | null;
  last_activity_type: string | null;
  activity_count: number;
  last_offer_amount: number | null;
  final_price: number | null;
  images: { small: string; medium: string }[];
  contact: ContactInfo;
  /** ISO desde que PF dejó de publicarlo; null = sigue anunciado. */
  unavailable_at: string | null;
  /** Búsqueda de recambio en PF (solo para los retirados). */
  replacement: ReplacementInfo | null;
}

export interface GroupDto {
  id: string;
  name: string;
  created_at: string;
  count: number;
}

export function relDate(iso: string | null): string {
  if (!iso) return "";
  const d = Date.parse(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (!Number.isFinite(d)) return "";
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
}

const ATTEMPT_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** attempt_id como el de PF: 22 caracteres base62, uno nuevo por clic. */
function attemptId(): string {
  const bytes = new Uint8Array(22);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ATTEMPT_ALPHABET[b % 62]).join("");
}

/**
 * El botón de WhatsApp oficial de PF, calcado de su web (capturado en vivo):
 * `Hi! I’m interested in your listing on Property Finder: Link:
 * https://www.propertyfinder.ae/go/<listing_id>/en?attempt_id=…&utm_medium=lead_user&utm_source=wa`.
 * Sin token (contacto sin refrescar) se usa el enlace prellenado del payload
 * antiguo, y como último recurso el chat sin texto — nunca un mensaje propio.
 */
export function whatsappLink(c: ContactInfo): string | null {
  const phone = (c.contacts.find((x) => x.type === "whatsapp" && x.value)?.value || c.broker.phone || "").replace(
    /\D/g,
    ""
  );
  if (c.pf_token && phone) {
    const text =
      `Hi! I’m interested in your listing on Property Finder: Link: ` +
      `https://www.propertyfinder.ae/go/${c.pf_token}/en?attempt_id=${attemptId()}&utm_medium=lead_user&utm_source=wa\n` +
      `(do not edit link)\n`;
    return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
  }
  const wa = c.contacts.find((x) => x.type === "whatsapp" && x.link);
  if (wa?.link) return wa.link;
  return phone ? `https://wa.me/${phone}` : null;
}

export function phoneLink(c: ContactInfo): string | null {
  const phone = c.contacts.find((x) => x.type === "phone" && x.value)?.value || c.broker.phone;
  return phone ? `tel:${phone}` : null;
}

export function emailLink(c: ContactInfo): string | null {
  const email =
    c.agent.email || c.contacts.find((x) => x.type === "email" && x.value)?.value || c.broker.email;
  return email ? `mailto:${email}` : null;
}
