/**
 * Tipos y etiquetas de refrigeración, SIN dependencias de base de datos: este
 * módulo lo importan también los componentes de cliente. La resolución (que
 * consulta SQLite) vive en `cooling.ts`, que es solo de servidor.
 */

export type CoolingType = "chiller_free" | "district" | "dewa";

const VALID: CoolingType[] = ["chiller_free", "district", "dewa"];

/** Valida lo que llega del cliente: nunca escribir un string arbitrario. */
export function parseCoolingType(v: unknown): CoolingType | null {
  return typeof v === "string" && (VALID as string[]).includes(v) ? (v as CoolingType) : null;
}

export const COOLING_LABEL: Record<CoolingType, string> = {
  chiller_free: "Chiller-free",
  district: "District cooling",
  dewa: "A/C en DEWA",
};

export const COOLING_HELP: Record<CoolingType, string> = {
  chiller_free: "El A/C va dentro del service charge: no pagas factura de chiller aparte.",
  district:
    "Empower/Emicool/Tabreed factura aparte, con capacity charge que se paga aunque el piso esté vacío.",
  dewa: "Split propio: el consumo va en tu factura de DEWA.",
};
