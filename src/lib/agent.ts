import { PfContactOption, PfProperty } from "./types";

/**
 * Normalized realtor contact stored in listings.agent_json. Three formats coexist:
 * legacy `{agent: "name"|null, broker: "name"|null}`, the rich format below, and '{}'.
 */
export interface ContactInfo {
  agent: {
    name: string | null;
    email: string | null;
    position: string | null;
    whatsapp_response_time: number | null;
    years_of_experience: number | null;
  };
  broker: {
    name: string | null;
    email: string | null;
    phone: string | null;
    logo: string | null;
  };
  contacts: PfContactOption[];
  /** Token ULID del anuncio: con él se replica el botón de WhatsApp oficial de PF. */
  pf_token: string | null;
  hasRichContact: boolean;
}

function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Search cards carry no contact_options/emails; never let them clobber a richer
 * detail-page contact (same pattern as images in upsertListing).
 */
export function buildAgentJson(p: PfProperty, existingJson?: string): string {
  const contacts = (p.contact_options ?? []).filter((c) => c?.type && (c.value || c.link));
  const rich = contacts.length > 0 || Boolean(p.agent?.email || p.broker?.phone || p.broker?.email);
  if (!rich && existingJson) {
    const prev = parseAgentJson(existingJson);
    if (prev.hasRichContact) {
      // Contacto rico previo: se conserva, pero sin perder un token recién llegado.
      if (p.listing_id && !prev.pf_token) {
        try {
          return JSON.stringify({ ...JSON.parse(existingJson), pf_token: p.listing_id });
        } catch {}
      }
      return existingJson;
    }
  }
  return JSON.stringify({
    pf_token: p.listing_id ?? null,
    agent: {
      name: p.agent?.name ?? null,
      email: p.agent?.email ?? null,
      position: p.agent?.position ?? null,
      whatsapp_response_time: toNumOrNull(p.agent?.avg_whatsapp_response_time),
      years_of_experience: toNumOrNull(p.agent?.years_of_experience),
    },
    broker: {
      name: p.broker?.name ?? null,
      email: p.broker?.email ?? null,
      phone: p.broker?.phone ?? null,
      logo: p.broker?.logo ?? null,
    },
    contacts,
  });
}

export function parseAgentJson(json: string | null | undefined): ContactInfo {
  const empty: ContactInfo = {
    agent: { name: null, email: null, position: null, whatsapp_response_time: null, years_of_experience: null },
    broker: { name: null, email: null, phone: null, logo: null },
    contacts: [],
    pf_token: null,
    hasRichContact: false,
  };
  if (!json) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return empty;
  }
  if (!raw || typeof raw !== "object") return empty;
  const o = raw as Record<string, unknown>;

  // Legacy format: agent/broker are plain name strings (or null).
  if (typeof o.agent === "string" || typeof o.broker === "string" || (!("contacts" in o) && !("agent" in o && typeof o.agent === "object"))) {
    return {
      ...empty,
      agent: { ...empty.agent, name: typeof o.agent === "string" ? o.agent : null },
      broker: { ...empty.broker, name: typeof o.broker === "string" ? o.broker : null },
    };
  }

  const a = (o.agent ?? {}) as Record<string, unknown>;
  const b = (o.broker ?? {}) as Record<string, unknown>;
  const contacts = Array.isArray(o.contacts) ? (o.contacts as PfContactOption[]) : [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const info: ContactInfo = {
    agent: {
      name: str(a.name),
      email: str(a.email),
      position: str(a.position),
      whatsapp_response_time: toNumOrNull(a.whatsapp_response_time),
      years_of_experience: toNumOrNull(a.years_of_experience),
    },
    broker: { name: str(b.name), email: str(b.email), phone: str(b.phone), logo: str(b.logo) },
    contacts,
    pf_token: str(o.pf_token),
    hasRichContact: false,
  };
  info.hasRichContact =
    contacts.length > 0 || Boolean(info.agent.email || info.broker.phone || info.broker.email);
  return info;
}
