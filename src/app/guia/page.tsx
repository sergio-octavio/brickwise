"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { leverageBreakeven } from "@/lib/finance";
import type { AppConfig } from "@/lib/config";

interface Cfg {
  net_yield_good: number;
  coc_good: number;
  strategy_residence: boolean;
  personal_expenses: { name: string; amount: number }[];
  new_build_discount: number;
  momentum_min_projects: number;
  supply_pressure_bear: number;
  mortgage_rate: number;
  mortgage_term_years: number;
  residence_years: number;
  current_rent_monthly: number;
  reform_furnish_cost: number;
  reform_rent_uplift: number;
  ltv_first: number;
  ltv_second: number;
  maintenance_pct: number;
  vacancy_pct: number;
  monthly_salary: number;
  dbr_max: number;
  existing_monthly_payments: number;
  str_peak_nights: number;
  service_charge_default: number;
  dld_pct: number;
  price_premium_bad: number;
  price_discount_good: number;
  price_min_sale_n: number;
}

const SECTIONS = [
  { id: "decision", label: "La decisión" },
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "compra", label: "Costes de compra" },
  { id: "hipoteca", label: "Hipoteca y DBR" },
  { id: "gastos", label: "Gastos" },
  { id: "service-charge", label: "Service charge a mano" },
  { id: "plan-residencia", label: "Vivir primero, alquilar después" },
  { id: "str", label: "Alquiler vacacional" },
  { id: "revalorizacion", label: "Revalorización" },
  { id: "mercado", label: "Señales de mercado" },
  { id: "datos", label: "De dónde salen los datos" },
  { id: "flujo", label: "Cómo trabajar" },
];

export default function GuiaPage() {
  const [c, setC] = useState<Cfg | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => setC(j.config))
      .catch(() => {});
  }, []);

  const pct = (v: number | undefined, d = 0) => (v == null ? "…" : `${(v * 100).toFixed(d)}%`);
  const dbrCap = c ? c.monthly_salary * c.dbr_max - c.existing_monthly_payments : null;
  // Punto en que el apalancamiento deja de ayudar, con TUS constantes.
  const br = c ? leverageBreakeven(c as unknown as AppConfig) ?? undefined : undefined;
  const brWaiver = c ? leverageBreakeven(c as unknown as AppConfig, 400_000, true) ?? undefined : undefined;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">Guía de interpretación</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Qué significa cada número de Brickwise, cómo se calcula y cómo leerlo. Los umbrales y constantes que ves aquí
          son los tuyos: se editan en{" "}
          <Link href="/settings" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Ajustes
          </Link>
          .
        </p>
        <nav className="mt-3 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="btn-font rounded-full border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {/* ---------------------------------------------------------------- */}
      <Section id="decision" title="La decisión: qué compras y qué no">
        <p>
          El criterio depende de <b>qué vas a hacer con el piso</b>, y se elige en Ajustes → &quot;Compro para vivir yo
          primero&quot;. Ahora mismo estás en modo{" "}
          <b>{c?.strategy_residence ? "vivo primero" : "inversión"}</b>.
        </p>
        {c?.strategy_residence ? (
          <>
            <Formula>
              rentabilidad neta ≥ {pct(c?.net_yield_good)} &nbsp;Y&nbsp; vivir ahí ≤ tu alquiler actual
            </Formula>
            <p>
              Mientras vives dentro <b>no hay cash-on-cash</b>: no hay inquilino ni renta, así que exigirlo no tiene
              sentido. Lo que importa es que el piso te salga más barato que seguir de alquiler (se paga solo mientras
              amortizas) y que, cuando lo alquiles, sea rentable de verdad.
            </p>
          </>
        ) : (
          <>
            <Formula>
              rentabilidad neta ≥ {pct(c?.net_yield_good)} &nbsp;Y&nbsp; cash-on-cash ≥ {pct(c?.coc_good)}
            </Formula>
            <p>
              La neta garantiza que el activo es rentable tras gastos; el cash-on-cash garantiza que, con hipoteca, el
              dinero que pones de tu bolsillo rinde desde el primer día.
            </p>
          </>
        )}
        <Chips>
          <Chip color="emerald">✓ Compra</Chip> cumple los dos umbrales.{" "}
          <Chip color="purple">✓✓ Compra + momentum</Chip> además la zona tiene revalorización estimada positiva con al
          menos {c?.momentum_min_projects ?? "…"} proyectos off-plan comparables y demanda sana.{" "}
          <Chip color="neutral">✗ No cumple</Chip> falla alguno de los dos.
        </Chips>
        <Callout>
          La revalorización <b>nunca</b> convierte en compra un piso con mal cash-flow: solo mejora un ✓ que ya cumple.
          Es deliberado — la renta es dato verificable, la revalorización es una estimación.
        </Callout>
      </Section>

      <Section id="rentabilidad" title="Las tres rentabilidades (y por qué no coinciden)">
        <Term term="Rentabilidad bruta (sobre tu compra)">
          <Formula>renta anual mediana de comparables ÷ precio de este anuncio</Formula>
          Lo que rendiría el piso si no hubiera ningún gasto. Sirve para comparar rápido, pero siempre es optimista.
          Es la métrica que ves en el badge de color.
        </Term>
        <Term term="Rentabilidad de mercado (edificio)">
          Renta mediana ÷ precio de venta mediano de unidades comparables. <b>No depende de este anuncio</b>: es la
          referencia del edificio. Si la bruta del anuncio supera a la de mercado, estás comprando por debajo de lo que
          se vende habitualmente.
        </Term>
        <Term term="Rentabilidad neta">
          <Formula>
            (renta × (1 − {pct(c?.vacancy_pct)} vacancia) − service charges − mantenimiento − seguro) ÷ precio
          </Formula>
          La rentabilidad real de explotación del activo. Es la que manda para decidir.
        </Term>
        <Term term="Cash-on-cash (CoC)">
          <Formula>
            (renta efectiva − service charges − 12 cuotas de hipoteca − seguros) ÷ cash que pones tú
          </Formula>
          El <b>flujo de caja</b>: cuánto dinero te queda al año por cada dirham que pusiste. Es la métrica reina del
          modelo apalancado.
        </Term>
        <Callout>
          <b>¿Por qué a veces el CoC sale MENOR que la neta?</b> Porque la hipoteca cuesta caja: la cuota completa
          (interés + amortización) supone <b>{pct(br?.mortgageAnnualPct, 2)} del préstamo</b> al año con tu
          configuración ({pct(c?.mortgage_rate, 2)} a {c?.mortgage_term_years ?? "…"} años).
          <br />
          El punto de cruce está en <b>neta = {pct(br?.netYield, 2)}</b>: por encima el apalancamiento amplifica y el
          CoC sube; por debajo la deuda drena y el CoC cae. No es un error — es la señal de si te conviene
          apalancarte en ese piso.
        </Callout>
        <Callout>
          <b>¿Y por qué el cruce no está en ese mismo {pct(br?.mortgageAnnualPct, 2)}?</b> Es la trampa clásica:{" "}
          <b>los tres porcentajes se miden sobre bases distintas</b>.
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              La <b>cuota</b>, sobre el <b>préstamo</b> ({pct(c?.ltv_first)} del precio) → en dinero real cuesta{" "}
              {pct(br && c ? br.mortgageAnnualPct * c.ltv_first : undefined, 2)} del precio.
            </li>
            <li>
              La <b>neta</b>, sobre el <b>precio</b> entero.
            </li>
            <li>
              El <b>CoC</b>, sobre el <b>cash que pones</b>: {pct(br?.cashPct, 1)} del precio, no el{" "}
              {pct(c ? 1 - c.ltv_first : undefined)} de la entrada.
            </li>
          </ul>
          Si solo pusieras la entrada, el cruce SÍ caería a <b>{pct(br?.netYieldNoCosts, 2)}</b> — prácticamente el
          coste de la deuda. Lo que lo sube hasta {pct(br?.netYield, 2)} son los{" "}
          <b>{pct(br?.costsPct, 1)} de costes de compra</b> (DLD, agente, trustee, fees de hipoteca): dinero que sale
          de tu bolsillo, <b>no produce ni un dirham de renta</b> y sin embargo engorda el denominador del CoC.
          <br />
          Corolario práctico: el <b>DLD waiver</b> baja el listón. Sin pagar el {pct(c?.dld_pct)} del DLD, el cruce se
          mueve a <b>{pct(brWaiver?.netYield, 2)}</b> — un piso que hoy no llega puede cruzar solo por eso.
        </Callout>
        <Callout>
          El CoC mide <b>caja</b>, no riqueza: casi un tercio de la cuota es amortización de capital, que es patrimonio
          tuyo, no gasto perdido. Un CoC del 5% con la deuda bajando cada año no es tan malo como parece.
        </Callout>
      </Section>

      <Section id="compra" title="Cuánto cash necesitas (upfront)">
        <p>Lo que sale de tu cuenta el día de la compra:</p>
        <Formula>entrada + DLD + trustee + comisión de agente + fees de hipoteca</Formula>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>Entrada</b>: {pct(c ? 1 - c.ltv_first : undefined)} del precio en 1ª vivienda (LTV {pct(c?.ltv_first)}),{" "}
            {pct(c ? 1 - c.ltv_second : undefined)} en 2ª (LTV {pct(c?.ltv_second)}) — clave para tu estrategia de dos
            pisos.
          </li>
          <li>
            <b>DLD transfer fee</b>: el impuesto de transmisión del Dubai Land Department (el &quot;ITP&quot; de
            Dubái), 4% + tasa administrativa fija. Si el vendedor lo asume, marca <b>DLD waiver</b> en la ficha.
          </li>
          <li>
            <b>Trustee</b>: la &quot;notaría&quot; de Dubái, la oficina autorizada donde se firma la compraventa.
            Tarifa fija según precio + VAT.
          </li>
          <li>
            <b>Agente</b>: 2% + VAT (0 si compras directo al developer). <b>Fees de hipoteca</b>: registro 0,25% del
            préstamo, valoración y arrangement fee.
          </li>
        </ul>
        <Callout>
          Regla rápida: <b>~27% del precio</b> en 1ª vivienda (~22% con DLD waiver) y <b>~41%</b> en 2ª. En la lista
          del mapa lo ves entre paréntesis junto al precio.
        </Callout>
      </Section>

      <Section id="hipoteca" title="Hipoteca y DBR">
        <Term term="Cuota">
          PMT estándar con tu tipo ({pct(c?.mortgage_rate, 2)}), plazo ({c?.mortgage_term_years ?? "…"} años) y el LTV
          que corresponda a 1ª o 2ª vivienda.
        </Term>
        <Term term="DBR (Debt Burden Ratio)">
          Norma del Banco Central de los EAU: el banco <b>no concede</b> la hipoteca si la suma de TODAS tus cuotas
          supera el {pct(c?.dbr_max)} de tu sueldo. Con {c ? c.monthly_salary.toLocaleString() : "…"} AED/mes tu tope
          son <b>{dbrCap ? dbrCap.toLocaleString() : "…"} AED/mes</b> en cuotas. Si un anuncio marca el aviso rojo, ese
          piso no es financiable para ti a ese precio. Cada hipoteca consume capacidad para la siguiente — amortizar
          libera DBR.
        </Term>
      </Section>

      <Section id="gastos" title="Los gastos que se comen la rentabilidad">
        <Term term="Service charge (el nº1)">
          Cuota anual del edificio en <b>AED por sqft</b>. Es el factor que más mueve la neta. Prioridad de fuentes:
          <ol className="ml-4 mt-1 list-decimal space-y-0.5">
            <li>
              <b>Override manual</b> — el dato real que tú metas (se aplica a todo el edificio).
            </li>
            <li>
              <b>Mollak</b> — dato oficial del DLD por edificio, importado desde Dubai Pulse.
            </li>
            <li>
              <b>Estimación por zona</b> — tabla editable en Ajustes.
            </li>
            <li>
              <b>Default global</b> ({c?.service_charge_default ?? "…"} AED/sqft) si no hay nada mejor.
            </li>
          </ol>
          La ficha te dice siempre qué fuente se usó. Si pone &quot;default global&quot;, ese número es el más flojo
          del análisis: búscalo en el DLD y mételo a mano.
        </Term>
        <Term term="Vacancia">
          El {pct(c?.vacancy_pct)} del año que el piso está <b>vacío entre inquilinos</b> (buscar inquilino, pintura…).
          ≈3 semanas al año. No es alquiler vacacional ni uso propio.
        </Term>
        <Term term="Mantenimiento">
          {pct(c?.maintenance_pct)} de la renta en edificio nuevo; sube a 8-10% si tiene más de ~8-10 años (averías de
          AC, fontanería, riesgo de derramas de la comunidad).
        </Term>

        <Term term="Quién paga qué (y dónde lo cuenta la app)">
          La duda clásica en Dubái. Regla general: <b>el propietario paga lo del edificio, el ocupante lo que
          consume</b>.
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-3">Gasto</th>
                  <th className="py-1 pr-3">Lo paga</th>
                  <th className="py-1">Dónde entra</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {[
                  ["Service charge", "Propietario, siempre", "Neta, CoC y coste de vivir ahí"],
                  ["Seguro de hogar", "Propietario", "Neta, CoC y coste de vivir ahí"],
                  ["Mantenimiento / averías", "Propietario", "Solo en la neta (fase de alquiler)"],
                  ["DEWA: luz y agua", "Quien vive: tú o el inquilino", "Solo en el coste de vivir ahí"],
                  ["Aire / chiller", "Ocupante (0 si es chiller-free)", "Solo en el coste de vivir ahí"],
                  ["Wifi, móvil, comida, gym", "Tú, vivas donde vivas", "Presupuesto personal (Ajustes)"],
                ].map(([g, quien, donde]) => (
                  <tr key={g} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-3 font-medium">{g}</td>
                    <td className="py-1 pr-3 text-neutral-500">{quien}</td>
                    <td className="py-1 text-neutral-500">{donde}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="mt-2 block">
            Por eso DEWA y el aire <b>no salen en la rentabilidad de alquiler</b>: cuando alquilas los paga el
            inquilino. Solo cuentan mientras vives tú. Y en la comparación &quot;comprar vs seguir de alquiler&quot; se
            dejan fuera de los dos lados, porque los pagarías igualmente vivas donde vivas.
          </span>
        </Term>
      </Section>

      <Section id="service-charge" title="Cómo meter el service charge real a mano">
        <p>
          Es el dato que más mueve la rentabilidad neta y el que peor calidad tiene por defecto. Si la ficha dice que
          la fuente es <b>&quot;default global&quot;</b> o <b>&quot;estimación [zona]&quot;</b>, merece la pena
          buscar el número real del edificio. Son 5 minutos y cambia el análisis.
        </p>

        <Term term="Paso 1 · Búscalo en el índice oficial del DLD">
          Abre el{" "}
          <a
            href="https://dubailand.gov.ae/en/eservices/service-charge-index-overview/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            Service Charge Index del DLD ↗
          </a>{" "}
          y pulsa <b>&quot;Access this service&quot;</b>. Es la vista pública del sistema Mollak, con el año en curso.
          <ol className="ml-4 mt-1 list-decimal space-y-0.5">
            <li>
              Elige la <b>Master Community</b> (la zona: JVC, International City, Dubai Production City…).
            </li>
            <li>
              Elige el <b>edificio o proyecto</b> — el nombre de la torre que aparece en &quot;Datos básicos&quot; de
              la ficha.
            </li>
            <li>Selecciona el año de presupuesto más reciente que aparezca.</li>
          </ol>
          Alternativas si esa web no carga: la app <b>Dubai REST</b> (ficha del edificio → service charges), o
          preguntar directamente a la <b>Owners Association</b> / empresa gestora del edificio, que está obligada a
          dártelo.
        </Term>

        <Term term="Paso 2 · Qué número coger">
          Busca el importe en <b>AED por sqft y año</b>. Normalmente viene desglosado por partidas (General Fund,
          Reserve Fund, Master Community, Services, Insurance…): <b>súmalas todas</b>.
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              <b>No incluyas</b> los cargos por unidad, no por sqft: parking, instalación de contador, chiller cobrado
              como cargo fijo. Son gastos aparte, no van en este campo.
            </li>
            <li>
              Usa la fila del uso <b>Residential</b> si hay varios usos (retail, oficinas…).
            </li>
            <li>
              Referencia de cordura: en Dubái casi todo cae entre <b>8 y 25 AED/sqft</b>. Si te sale 200, has cogido un
              cargo por unidad; si te sale 2, has cogido solo una partida.
            </li>
          </ul>
        </Term>

        <Term term="Paso 3 · Mételo en la ficha del anuncio">
          En cualquier anuncio de ese edificio, baja a la sección <b>Finanzas</b> → recuadro{" "}
          <b>&quot;Datos del anuncio&quot;</b> → campo{" "}
          <b>&quot;Service charge real (todo el edificio)&quot;</b>. Escribe el número (solo la cifra, p. ej.{" "}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-950">14</code>) y pulsa{" "}
          <b>Guardar y recalcular</b>.
        </Term>

        <Term term="Qué pasa al guardarlo">
          <ul className="ml-4 list-disc space-y-0.5">
            <li>
              Se aplica a <b>todos los anuncios de la misma torre</b>, no solo a ese: el service charge es del
              edificio, no del piso. Al guardar te dice a cuántos anuncios ha afectado.
            </li>
            <li>
              <b>Ojo con los complejos de varias torres</b>: Property Finder trata &quot;Lakeside Tower A&quot;,
              &quot;B&quot;, &quot;C&quot;… como edificios <b>distintos</b>. Si el complejo comparte service charge,
              tendrás que meterlo una vez <b>en cada torre</b>. El contador de anuncios afectados te avisa del alcance
              real.
            </li>
            <li>
              La rentabilidad neta y el cash-on-cash se actualizan, y la fuente pasa a decir{" "}
              <b>&quot;dato del edificio (manual)&quot;</b>.
            </li>
            <li>
              <b>Sobrevive al re-scrape</b>: aunque vuelvas a analizar el anuncio, tu dato manual no se pierde.
            </li>
            <li>
              Para deshacerlo, vacía el campo y guarda: vuelve a la fuente automática (Mollak → zona → default).
            </li>
          </ul>
        </Term>

        <Term term="Atajo: importar Mollak entero">
          En{" "}
          <Link href="/settings" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
            Ajustes
          </Link>{" "}
          → <b>&quot;Descargar datos Mollak&quot;</b> te traes de golpe el dataset oficial del DLD (~1.700 edificios de
          Dubái) desde Dubai Pulse. Cubre muchos edificios sin que tengas que buscar nada; el dato manual solo hace
          falta cuando tu edificio no está en esa lista o cuando el año publicado es antiguo.
        </Term>

        <Callout>
          Prioridad de fuentes, de más a menos fiable: <b>tu dato manual</b> → <b>Mollak</b> (oficial, por edificio) →{" "}
          <b>estimación de zona</b> (editable en Ajustes) → <b>default global</b>. La ficha del anuncio siempre te dice
          cuál está usando, bajo la rentabilidad neta.
        </Callout>
      </Section>

      <Section id="plan-residencia" title="Vivir primero, alquilar después">
        <p>
          El cash-on-cash de la sección Finanzas supone que <b>alquilas desde el día uno</b>. Si tu plan es comprar,
          reformar, vivir un par de años y luego alquilar, ese número <b>no describe tu caso</b>: durante la residencia
          no hay renta, así que no hay cash-on-cash que valga. Este bloque separa las dos fases.
        </p>

        <Term term="Fase 1 · Lo que cuesta vivir ahí">
          <Formula>coste mensual = cuota + service charges/12 + seguro/12</Formula>
          Se compara con lo que pagas hoy de alquiler ({c ? c.current_rent_monthly.toLocaleString() : "…"} AED/mes por
          defecto, editable en la propia ficha o en Ajustes). Si el resultado sale en verde,{" "}
          <b>vivir en tu piso te sale más barato que alquilar</b> — y encima estás amortizando.
        </Term>

        <Term term="Capital amortizado">
          La parte de las cuotas de esos {c?.residence_years ?? "…"} años que va a reducir deuda. No es gasto: es
          patrimonio. Es precisamente lo que el cash-on-cash nunca refleja, porque el CoC mide caja, no riqueza.
        </Term>

        <Term term="Hasta el 2º piso">
          Tu objetivo real: cuánto tardas en juntar la entrada del siguiente.
          <Formula>
            te sobra al mes = sueldo − gastos personales − (cuota + service charges + seguro + DEWA + aire)
          </Formula>
          Los gastos personales son las partidas que configures en{" "}
          <Link href="/settings" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
            Ajustes → Presupuesto personal
          </Link>{" "}
          (comida, gym, móvil, wifi…). El alquiler que dejas de pagar ya está dentro: simplemente no aparece como
          gasto. Eso se divide entre el cash upfront de una <b>2ª vivienda</b> del mismo precio (LTV{" "}
          {pct(c?.ltv_second)}, bastante más entrada que en la primera).
          <br />
          Visto así, el cash-on-cash deja de ser un aprobado/suspenso y se convierte en{" "}
          <b>el dial de velocidad</b> de tu estrategia: cuanto menos te cuesta el piso, antes llega el siguiente.
        </Term>

        <Term term="Fase 2 · CoC diferido">
          El cash-on-cash de cuando por fin lo alquilas, con <b>dos correcciones</b> frente al CoC normal:
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              <b>Numerador</b>: usa la renta <b>post-reforma</b> (mediana actual + {pct(c?.reform_rent_uplift)} de
              uplift por reformar y amueblar).
            </li>
            <li>
              <b>Denominador</b>: el cash invertido incluye la{" "}
              <b>reforma y el mobiliario</b> ({c ? c.reform_furnish_cost.toLocaleString() : "…"} AED por defecto), que
              el CoC estándar ignora.
            </li>
          </ul>
          Por eso los dos números no coinciden — y el diferido es el que describe tu estrategia real.
        </Term>

        <Callout>
          <b>El uplift de renta es fiable; el de precio de venta no.</b> Reformar y amueblar sube la renta de forma
          bastante predecible (spec: 5-10% por reforma cosmética + 10-15% por amueblado). Subir el <b>AED/sqft de
          venta</b> es mucho más incierto en el mid-market de Dubái: el comprador compara tu precio por sqft con las
          otras unidades del mismo edificio, y una cocina nueva no mueve ese número tanto como parece. Para eso mira el{" "}
          <b>payback</b> del &quot;Escenario de reforma&quot;: si sale en décadas, la reforma no se paga sola.
        </Callout>

        <Callout>
          <b>Ojo al DBR durante la residencia</b>: mientras vives en el piso, la cuota entera cuenta contra tu tope de{" "}
          {dbrCap ? dbrCap.toLocaleString() : "…"} AED/mes <b>sin renta que la compense</b>. Es el factor que limita
          cuándo puedes comprar el segundo. Al alquilarlo, los bancos de los EAU no computan la renta entera para el
          DBR — suelen contar solo una parte.
        </Callout>
      </Section>

      <Section id="str" title="Alquiler vacacional (STR)">
        <p>
          Datos de <b>AirROI</b> (gratuito) por submercado. Solo existen 5 submercados de Dubái:{" "}
          <b>business-bay, deira, dubai-marina, emaar-beachfront</b> y el agregado <b>dubai</b>.
        </p>
        <Callout>
          <b>Si tu zona cae en el agregado &quot;dubai&quot;, desconfía del número.</b> Esa media está dominada por
          Marina, Downtown y Business Bay — zonas turísticas. Para un piso en IMPZ, Silicon Oasis o International City,
          el ADR real no se parece en nada. La ficha marca ese caso en rojo.
        </Callout>
        <Term term="Necesitas cobrar (el número honesto)">
          Por eso la primera card no es un dato prestado, sino una pregunta que <b>tú puedes verificar</b>: cuántos
          AED/noche necesitas para igualar la renta larga del propio edificio, a la ocupación del submercado.
          <Formula>ADR de equilibrio = renta anual ÷ (365 × ocupación)</Formula>
          Abre Airbnb, mira 10 anuncios parecidos en la zona y compara. Si el mercado real está por debajo de esa
          cifra, el STR ahí no compensa — sin importar lo que diga la media de Dubái.
        </Term>
        <Term term="Ingresos STR estimados/año">
          Revenue medio del submercado convertido a AED y <b>neto de costes STR</b>: gestión, permiso DET/DTCM, Tourism
          Dirham (10 AED/noche ocupada) y utilities+wifi, que en STR paga el propietario. El &quot;×N vs alquiler
          anual&quot; te dice si compensa frente a alquilar tradicional.
        </Term>
        <Term term="Cuota cubierta (modo híbrido)">
          Tu caso real: vivir en el piso y alquilarlo solo las <b>{c?.str_peak_nights ?? "…"} noches pico</b> del año
          (configurable). Los ingresos de esas noches ÷ las 12 cuotas anuales. Un 100% significa que las semanas pico
          te pagan la hipoteca entera.
        </Term>
        <Callout>
          Requisito legal: el edificio debe permitir holiday homes y hay que registrar el permiso DET/DTCM. Verifícalo
          con la Owners Association antes de contar con estos números.
        </Callout>
      </Section>

      <Section id="revalorizacion" title="Revalorización por off-plan colindante">
        <p>
          Los proyectos off-plan que guardes en favoritos marcan a qué precio se vende la zona <b>a futuro</b>. Se usan
          los que están en la misma comunidad o a &lt;3 km, de tamaño similar (±30%) y con fecha de entrega futura.
        </p>
        <Term term="Escenario alcista">
          Al entregarse la obra nueva, la 2ª mano converge hacia su precio menos {pct(c?.new_build_discount)} (un piso
          usado no vale lo mismo que uno a estrenar en la misma calle). Anualizado hasta la entrega mediana.
        </Term>
        <Term term="Escenario bajista">
          El otro lado: la entrega mete <b>oferta de golpe</b>. Si la demanda no acompaña, el precio cae (
          {pct(c?.supply_pressure_bear)} total por defecto, anualizado). Los dos escenarios son reales; la app no elige
          por ti.
        </Term>
        <Term term="Señal de demanda (el voto del mercado)">
          Compara el precio de las <b>reventas</b> off-plan con el <b>precio de lista del developer</b>:
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              <b>Fuerte</b> (+5% o más): la gente paga sobre lista para entrar → el mercado cree en la zona.
            </li>
            <li>
              <b>Débil</b> (−5% o menos, &quot;below OP&quot;, o anuncios &gt;90 días sin venderse): se está
              descontando sobreoferta.
            </li>
          </ul>
          Una señal débil bloquea el ✓✓ momentum.
        </Term>
        <Term term="Atractores a <1 km">
          Cafeterías y súper/mall del entorno. Ojo al orden causal: <b>los negocios siguen a la población</b>, no a la
          construcción. Una zona ya servida absorbe la oferta nueva rápido (bache corto); una zona vacía depende de que
          la gente se mude de verdad y los negocios lleguen después — más lento e incierto.
        </Term>
        <Callout>
          Cómo leer un %/año enorme (+50% o más): significa que la obra nueva pide el doble que el stock viejo. El gap
          es real, pero un edificio de 2008 <b>no converge del todo</b> con obra nueva. Léelo como &quot;la zona tiene
          recorrido&quot;, no como &quot;mi piso va a doblar&quot;. Compara zonas entre sí, no lo tomes al pie de la
          letra.
        </Callout>
      </Section>

      <Section id="mercado" title="Señales de mercado en la ficha">
        <Term term="Tendencia (media móvil)">
          La curva morada del gráfico AED/sqft. No es una recta: cada punto es la media de las transacciones cercanas
          en el tiempo, ponderada por proximidad, así que los periodos con más volumen tiran más de la curva. El
          &quot;%/año&quot; compara la curva de hoy con la de hace un año.
        </Term>
        <Term term="Precio vs mediana (¿caro o barato?)">
          <Formula>AED/sqft del anuncio ÷ mediana AED/sqft de ventas comparables − 1</Formula>
          Comparables = mismo edificio, tamaño ±20%, últimos 24 meses. Por encima de{" "}
          {pct(c?.price_premium_bad)} = sobreprecio (rojo); por debajo de −{pct(c?.price_discount_good)} = chollo
          (verde). Umbrales en Ajustes.
          <br />
          Es <b>lo mismo</b> que comparar tus dos rentabilidades: como comparten numerador (la renta mediana), si tu{" "}
          <b>rentabilidad sobre la compra</b> es MENOR que la <b>de mercado</b>, estás pagando por encima de la
          mediana. La app ahora hace esa división por ti.
          <br />
          Con menos de {c?.price_min_sale_n ?? "…"} ventas comparables se muestra <b>n=X</b> en gris:{" "}
          <b>no saber no es lo mismo que estar en precio</b>.
        </Term>
        <Term term="% bajo / sobre tendencia">
          El AED/sqft del anuncio frente a esa curva evaluada hoy. Verde = por debajo (descuento real frente a lo que
          se está pagando); rojo = sobreprecio.
        </Term>
        <Callout>
          <b>Las dos señales de precio pueden discrepar, y ninguna está mal.</b> La <b>mediana</b> trata igual una
          venta de hace 23 meses y una de la semana pasada. La <b>tendencia</b> pondera por recencia, pero se evalúa
          en la fecha de la última venta comparable, que puede tener meses. Si un piso sale &quot;caro vs mediana pero
          barato vs tendencia&quot;, la discrepancia mide <b>la deriva del mercado</b>: el edificio se ha revalorizado
          dentro de esos 24 meses.
        </Callout>
        <Term term="En mercado (días)">
          Días desde que se publicó el anuncio. Más de <b>90 días</b> = el vendedor no encuentra comprador: hay margen
          para negociar 5-8% (regla del spec).
        </Term>
        <Term term="Off-plan · developer / resale">
          <b>developer</b> = venta nueva a precio de lista con payment plan. <b>resale</b> = alguien revende antes de
          la entrega; su precio refleja lo que paga el mercado real. Si ves <b>⚠ sin entrega</b>, es un anuncio mal
          etiquetado (edificio ya entregado) y queda excluido de los cálculos.
        </Term>
        <Term term="Reforma: años de payback (métrica del mapa)">
          Cuánto tarda en devolverte la reforma estándar (mobiliario + suelo + paredes) lo que cuesta, vía subida de
          renta.
          <Formula>payback = coste de la reforma ÷ subida de renta anual capturada</Formula>
          Se usa <b>payback</b> y no el % de dispersión porque un 20% sobre un estudio y un 20% sobre un 2-hab son
          negocios muy distintos: el coste escala con los sqft, no con la renta. El margen sale del P75 de rentas{" "}
          <b>por sqft</b> del edificio con ventana de <b>12 meses</b> — en 24 meses parte del margen sería solo
          inflación de rentas, no estado del piso. Con menos de <b>6</b> alquileres comparables el pin muestra{" "}
          <b>n=X</b> en gris en vez de un número.
          <br />
          <b>Aviso estructural</b>: el modelo asume que ESTE piso se alquila hoy a la mediana. Nada en los datos dice
          si ya está reformado; si lo está, su margen real es cero aunque el mapa lo pinte verde. Y el P75 es un
          techo, no una expectativa: llegar ahí también exige planta alta y buenas vistas, que la reforma no cambia.
        </Term>
        <Term term="Aire acondicionado (❄)">
          Quién paga el frío, que es del EDIFICIO y no del piso. <b>Chiller-free</b>: va dentro del service charge, no
          pagas factura aparte. <b>District cooling</b>: Empower/Emicool/Tabreed factura al ocupante con capacity
          charge que se paga aunque el piso esté vacío. <b>DEWA</b>: split propio.
          <br />
          La detección automática cubre muy poco (solo 5 de 558 anuncios lo mencionan), así que casi siempre verás{" "}
          <b>&quot;Aire: sin dato&quot;</b>. Fíjalo a mano en la ficha: se aplica a toda la torre y baja el coste de
          vivir ahí si es chiller-free.
        </Term>
        <Term term="Liquidez (mapa de calor)">
          Transacciones al año por edificio según el DLD. Zona morada = mucha actividad, fácil salir; amarilla = poco
          líquido, puedes tardar meses en vender.
        </Term>
      </Section>

      <Section id="datos" title="De dónde sale cada dato">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>Precios, rentas y transacciones</b>: Property Finder + transacciones oficiales del DLD del edificio
            (comparables de tamaño ±20%, últimos 24 meses).
          </li>
          <li>
            <b>Service charges</b>: Mollak/RERA vía el dataset abierto de Dubai Pulse (~1.700 edificios), con enlace en
            Ajustes para consultarlo a mano.
          </li>
          <li>
            <b>STR</b>: AirROI (gratuito), 5 submercados de Dubái, actualizable desde Ajustes.
          </li>
          <li>
            <b>Entorno</b>: OpenStreetMap (cafeterías, súper/mall) y los gimnasios que guardas tú desde Google Maps.
          </li>
        </ul>
        <Callout>
          Todo lo que la app no puede saber lo decides tú: si el edificio permite holiday homes, si el mall está
          confirmado, si las fotos cuadran con el año del edificio, y el estado real del piso.
        </Callout>
      </Section>

      <Section id="flujo" title="Cómo trabajar con la app">
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            Guarda anuncios en Property Finder y tráelos con <b>Sincronizar con PF</b> (incluidos los off-plan de las
            zonas que te interesen: alimentan la revalorización).
          </li>
          <li>
            En el mapa, filtra por <b>✓ Compra</b> y cambia la métrica de los pines (neta, CoC, AED/sqft, ficha…) para
            ver la zona desde distintos ángulos.
          </li>
          <li>
            Abre la ficha de los candidatos: comprueba la <b>fuente del service charge</b> (si es &quot;default
            global&quot;, búscalo), el aviso <b>DBR</b>, y los dos escenarios de revalorización.
          </li>
          <li>
            Mueve los buenos al <b>Pipeline</b>, registra llamadas, visitas y ofertas; el descuento sobre el asking se
            calcula solo.
          </li>
        </ol>
      </Section>

      <p className="pb-4 text-xs text-neutral-400">
        Brickwise no da asesoramiento financiero: son estimaciones sobre datos públicos para ayudarte a comparar y
        priorizar. Verifica siempre el service charge real, el estado del edificio y las condiciones de tu banco antes
        de comprometerte.
      </p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
      <div className="font-semibold">{term}</div>
      <div className="mt-0.5 text-neutral-600 dark:text-neutral-300">{children}</div>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-1 rounded-lg bg-neutral-100 px-3 py-2 font-mono text-[12px] leading-relaxed dark:bg-neutral-950">
      {children}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-300">
      {children}
    </div>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed">{children}</p>;
}

function Chip({ color, children }: { color: "emerald" | "purple" | "neutral"; children: React.ReactNode }) {
  const cls = {
    emerald: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
    purple: "bg-purple-600/15 text-purple-700 dark:text-purple-400",
    neutral: "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400",
  }[color];
  return <span className={`btn-font mr-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}
