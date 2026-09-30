import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, Send, Receipt, Banknote, CreditCard, Wallet, ClipboardList, CalendarDays } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Input";
import { EmptyState, StatCard, Badge } from "../../components/ui/Misc";
import { EnviarArchivoModal } from "../../components/ui/EnviarArchivoModal";
import { PrintReportHeader, PrintReportFooter, PrintReportTotalBar } from "../../components/ui/PrintReport";
import { ConciliacionGetnet } from "./ConciliacionGetnet";
import { ESTADO_CIERRE_LABEL } from "../../lib/cierreEstado";
import { useService } from "../../lib/service/ServiceContext";
import { useOrg } from "../../lib/theme/OrgContext";
import { useAuth } from "../../lib/auth/AuthContext";
import * as db from "../../lib/db";
import type { CierreCajaConVigencia, FormaPago, Ticket } from "../../lib/db/types";
import { formatoMXN, generarCSV } from "../../lib/utils";
// En su propio archivo (no aquí) para que SmartSearchModal.tsx pueda
// agrupar "cortes de caja"/"resumen" con exactamente el mismo criterio
// que esta pantalla, sin arrastrar la pantalla completa a su paquete
// — ver el comentario en fechaFolio.ts.
import { fechaLocal, fechaEfectiva, mesLocal } from "../../lib/fechaFolio";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { motion, useReducedMotion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";

const FORMATO_MES = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
const FORMATO_DIA_CORTO = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const FORMATO_DIA_LARGO = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });
function diaCorto(fecha: string) {
  return FORMATO_DIA_CORTO.format(new Date(fecha + "T00:00:00"));
}
function diaLargo(fecha: string) {
  return FORMATO_DIA_LARGO.format(new Date(fecha + "T00:00:00"));
}
function mesLabel(mes: string) {
  return FORMATO_MES.format(new Date(mes + "-02"));
}

function horaLocal(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Orden fijo de presentación — no depende de cuál llegó primero ese día.
const ORDEN_FORMAS: FormaPago[] = ["Efectivo", "Tarjeta de débito", "Tarjeta de crédito"];
// "Otro" no es una forma de pago real — es el grupo de rescate para un
// folio cuyo dato no calza con ninguna de las de arriba (ver el
// comentario junto a su uso en `grupos`, más abajo).
type GrupoForma = FormaPago | "Otro";
const ICONO_FORMA: Record<GrupoForma, typeof Banknote> = {
  "Efectivo": Banknote,
  "Tarjeta de débito": CreditCard,
  "Tarjeta de crédito": Wallet,
  "Otro": ClipboardList,
};
const TONE_FORMA: Record<GrupoForma, "good" | "brand" | "warning" | "neutral"> = {
  "Efectivo": "good",
  "Tarjeta de débito": "brand",
  "Tarjeta de crédito": "warning",
  "Otro": "neutral",
};

export default function CashClose() {
  const { servicioActual } = useService();
  const { org } = useOrg();
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [vista, setVista] = useState<"dia" | "mes">("dia");
  // ?fecha=YYYY-MM-DD en la URL preselecciona el día — así la búsqueda
  // inteligente (SmartSearchModal.tsx) puede mandar aquí directo al día
  // que alguien preguntó, en vez de solo mostrarlo aparte.
  const [params] = useSearchParams();
  const fechaInicial = params.get("fecha");
  const [fecha, setFecha] = useState<string>(fechaInicial && /^\d{4}-\d{2}-\d{2}$/.test(fechaInicial) ? fechaInicial : fechaLocal(new Date().toISOString()));
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set());
  const [enviarAbierto, setEnviarAbierto] = useState(false);
  const [mesVistaElegido, setMesVistaElegido] = useState<string>("");

  useEffect(() => {
    if (!servicioActual) return;
    db.listarTickets(servicioActual.id).then((list) => setTickets(list.filter((t) => t.estado === "pagado")));
  }, [servicioActual]);

  // Los días con pagos, más el día que se está viendo aunque no tenga
  // ninguno (por default, hoy): si no estuviera en la lista, el selector
  // mostraba otra fecha distinta a la del reporte en pantalla.
  const fechasDisponibles = useMemo(
    () => Array.from(new Set([fecha, ...tickets.map((t) => fechaLocal(fechaEfectiva(t)))])).sort().reverse(),
    [tickets, fecha]
  );

  const delDia = useMemo(
    () => tickets.filter((t) => fechaLocal(fechaEfectiva(t)) === fecha).sort((a, b) => fechaEfectiva(a).localeCompare(fechaEfectiva(b))),
    [tickets, fecha]
  );

  // ---------- Conciliación con Getnet ----------
  // La comparación guardada para este servicio y día; se ignora la de
  // otro día/servicio que tarde en llegar (mismo patrón que la búsqueda).
  const claveCierre = `${servicioActual?.id ?? ""}|${fecha}`;
  const [cierreInfo, setCierreInfo] = useState<{ clave: string; datos: CierreCajaConVigencia } | null>(null);
  useEffect(() => {
    if (!servicioActual || vista !== "dia") return;
    let vigente = true;
    db.obtenerCierreCaja(servicioActual.id, fecha)
      .then((datos) => { if (vigente) setCierreInfo({ clave: claveCierre, datos }); })
      .catch(() => {});
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveCierre, vista, tickets]);
  const conciliacion = cierreInfo?.clave === claveCierre ? cierreInfo.datos : null;
  const cobrosTarjeta = delDia.filter((t) => t.formaPago === "Tarjeta de débito" || t.formaPago === "Tarjeta de crédito").length;
  // Con la referencia de Getnet configurada y cobros con tarjeta ese día,
  // solo se envía un corte que cuadra (o que un administrador aprobó).
  const exigeConciliacion = !!servicioActual?.referenciaGetnet && cobrosTarjeta > 0;
  const conciliado = !!conciliacion?.cierre && conciliacion.vigente && conciliacion.cierre.estado !== "no_aprobado";
  const puedeEnviar = !exigeConciliacion || conciliado;
  const puedeOperar = !!servicioActual && !user?.serviciosSoloConsulta?.includes(servicioActual.id);

  async function alEnviar() {
    // Deja constancia de que este corte ya se envió.
    if (conciliacion?.cierre && conciliado) {
      try {
        setCierreInfo({ clave: claveCierre, datos: await db.marcarCierreEnviado(conciliacion.cierre.id) });
      } catch {
        /* el archivo ya se envió; la marca es solo constancia */
      }
    }
  }

  useEffect(() => {
    setIncluidos(new Set(delDia.map((t) => t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, tickets]);

  const seleccionados = delDia.filter((t) => incluidos.has(t.id));
  const total = seleccionados.reduce((s, t) => s + t.total, 0);

  const grupos = useMemo(() => {
    const reconocidos = ORDEN_FORMAS.map((forma) => {
      const deEstaForma = delDia.filter((t) => (t.formaPago ?? "Efectivo") === forma);
      const subtotal = deEstaForma.filter((t) => incluidos.has(t.id)).reduce((s, t) => s + t.total, 0);
      return { forma, tickets: deEstaForma, subtotal };
    }).filter((g) => g.tickets.length > 0);
    // El servidor ya no permite guardar una forma de pago fuera de
    // ORDEN_FORMAS (ver FORMAS_PAGO_VALIDAS en rutas.ts), pero un folio
    // guardado antes de ese control, o editado directamente en la base,
    // podría traer un valor que no calce con ninguna — sin este grupo,
    // ese folio sumaría al total del día sin aparecer en ningún
    // desglose, y el total dejaría de cuadrar con la suma de sus
    // partes (así lo encontró la auditoría con los datos de ejemplo).
    const idsReconocidos = new Set(reconocidos.flatMap((g) => g.tickets.map((t) => t.id)));
    const sinReconocer = delDia.filter((t) => !idsReconocidos.has(t.id));
    if (sinReconocer.length === 0) return reconocidos;
    const subtotal = sinReconocer.filter((t) => incluidos.has(t.id)).reduce((s, t) => s + t.total, 0);
    return [...reconocidos, { forma: "Otro" as const, tickets: sinReconocer, subtotal }];
  }, [delDia, incluidos]);

  function toggle(id: string) {
    setIncluidos((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const label = servicioActual?.cierreCajaLabel ?? "Cierre de caja";

  const csv = useMemo(() => {
    const filas: (string | number)[][] = seleccionados.map((t) => [t.folio, t.nombre, t.formaPago ?? "Efectivo", t.total]);
    filas.push([]);
    for (const g of grupos) filas.push(["", "", `Subtotal ${g.forma}`, g.subtotal]);
    filas.push(["", "", "Total del día", total]);
    if (conciliacion?.cierre) filas.push(["", "", "Conciliación con Getnet", `${ESTADO_CIERRE_LABEL[conciliacion.cierre.estado]} (diferencia ${conciliacion.cierre.diferencia.toFixed(2)})`]);
    return generarCSV(["Folio", "Nombre", "Forma de pago", "Total"], filas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados, grupos, total, conciliacion]);

  // ---------- Vista por mes: desglose por procedimiento ----------
  const mesesDisponibles = useMemo(
    () => Array.from(new Set(tickets.map((t) => mesLocal(fechaEfectiva(t))))).sort().reverse(),
    [tickets]
  );
  const mesVista = mesVistaElegido || mesesDisponibles[0] || "";

  const delMes = useMemo(
    () => tickets.filter((t) => mesLocal(fechaEfectiva(t)) === mesVista),
    [tickets, mesVista]
  );
  const totalMes = delMes.reduce((s, t) => s + t.total, 0);

  const porProcedimiento = useMemo(() => {
    const acc = new Map<string, { nombre: string; cantidad: number; total: number }>();
    for (const t of delMes) {
      for (const p of t.procedimientos) {
        const actual = acc.get(p.nombre) ?? { nombre: p.nombre, cantidad: 0, total: 0 };
        actual.cantidad += 1;
        actual.total += p.costo;
        acc.set(p.nombre, actual);
      }
    }
    return Array.from(acc.values()).sort((a, b) => b.total - a.total);
  }, [delMes]);

  const reducirMovimiento = useReducedMotion();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <div role="group" aria-label="Vista del cierre" className="flex rounded-full bg-black/5 p-1 dark:bg-white/10">
          {(
            [
              ["dia", "Por día"],
              ["mes", "Por mes"],
            ] as const
          ).map(([id, etiqueta]) => (
            <button
              key={id}
              type="button"
              aria-pressed={vista === id}
              onClick={() => setVista(id)}
              className={`relative rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors duration-150 ease-out-emil ${vista === id ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
            >
              {/* La pastilla se desliza a la opción elegida (mismo resorte
                  que el resto de los indicadores de la app) en vez de
                  brincar de un lado al otro. */}
              {vista === id && (
                <motion.span
                  layoutId="cierre-vista-activa"
                  transition={reducirMovimiento ? { duration: 0 } : SPRING_LAYOUT}
                  className="absolute inset-0 rounded-full bg-[var(--color-surface)] shadow-sm"
                />
              )}
              <span className="relative">{etiqueta}</span>
            </button>
          ))}
        </div>

        {vista === "dia" ? (
          <>
            <div className="w-full sm:w-60">
              <label htmlFor="cierre-fecha" className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Fecha</label>
              <Select id="cierre-fecha" value={fecha} onChange={(e) => setFecha(e.target.value)}>
                {fechasDisponibles.map((f) => (
                  <option key={f} value={f}>{diaCorto(f)}</option>
                ))}
              </Select>
            </div>
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              <Button
                variant="secondary"
                className="flex-1 sm:flex-none"
                icon={<Send size={16} />}
                onClick={() => setEnviarAbierto(true)}
                disabled={seleccionados.length === 0 || !puedeEnviar}
                title={!puedeEnviar ? "Compara primero el corte con el reporte de Getnet" : undefined}
              >
                Enviar
              </Button>
              <Button className="flex-1 sm:flex-none" icon={<Printer size={16} />} onClick={() => window.print()} disabled={seleccionados.length === 0}>
                Imprimir
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="w-full sm:w-60">
              <label htmlFor="cierre-mes" className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Mes</label>
              <Select id="cierre-mes" value={mesVista} onChange={(e) => setMesVistaElegido(e.target.value)}>
                {mesesDisponibles.length === 0 && <option value="">Sin datos</option>}
                {mesesDisponibles.map((m) => (
                  <option key={m} value={m}>{mesLabel(m)}</option>
                ))}
              </Select>
            </div>
            <Button className="w-full sm:ml-auto sm:w-auto" icon={<Printer size={16} />} onClick={() => window.print()} disabled={delMes.length === 0}>
              Imprimir resumen mensual
            </Button>
          </>
        )}
      </div>

      {vista === "dia" && servicioActual && delDia.length > 0 && (
        <ConciliacionGetnet
          servicio={servicioActual}
          fecha={fecha}
          info={conciliacion}
          esAdmin={user?.rol === "admin"}
          puedeOperar={puedeOperar}
          cobrosTarjeta={cobrosTarjeta}
          onActualizado={(datos) => setCierreInfo({ clave: claveCierre, datos })}
        />
      )}
      {vista === "dia" && exigeConciliacion && !conciliado && delDia.length > 0 && (
        <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 print:hidden">
          Para enviar este corte, compáralo primero con el reporte de Getnet.
        </p>
      )}

      {vista === "dia" ? (
        delDia.length === 0 ? (
          <EmptyState icon={<Receipt size={24} strokeWidth={1.75} />} title="No hay pagos en esta fecha" />
        ) : (
          <div id="cash-close-report" data-print-report>
            <PrintReportHeader
              titulo={`${label} · ${diaLargo(fecha)}`}
              contexto={`${org?.nombre ?? ""}${servicioActual ? " · " + servicioActual.nombre : ""}`}
              meta={[{ label: "Transacciones", value: seleccionados.length }]}
            />

            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {grupos.map((g) => {
                const Icono = ICONO_FORMA[g.forma];
                return (
                  <StatCard
                    key={g.forma}
                    label={g.forma}
                    value={<AnimatedNumber value={g.subtotal} from={g.subtotal} format={formatoMXN} startOnView={false} duration={0.4} />}
                    sub={`${g.tickets.filter((t) => incluidos.has(t.id)).length} transacción(es)`}
                    icon={<Icono size={16} className="text-brand-500" />}
                  />
                );
              })}
              <StatCard
                className="border-2 border-brand-500"
                label="Total general"
                value={<AnimatedNumber value={total} from={total} format={formatoMXN} startOnView={false} duration={0.4} />}
                sub={`${seleccionados.length} transacción(es)`}
              />
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm print:hidden">
              <p className="text-[var(--color-text-secondary)]">
                <span className="tabular font-bold text-[var(--color-text-primary)]">{seleccionados.length}</span> de {delDia.length} folios incluidos en el cierre
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIncluidos(new Set(delDia.map((t) => t.id)))}
                  disabled={seleccionados.length === delDia.length}
                  className="rounded-full px-3 py-1 text-xs font-bold text-brand-700 transition-colors duration-150 ease-out-emil hover:bg-brand-50 disabled:text-[var(--color-text-muted)] disabled:hover:bg-transparent dark:text-brand-300 dark:hover:bg-brand-500/10"
                >
                  Incluir todos
                </button>
                <button
                  type="button"
                  onClick={() => setIncluidos(new Set())}
                  disabled={seleccionados.length === 0}
                  className="rounded-full px-3 py-1 text-xs font-bold text-[var(--color-text-secondary)] transition-colors duration-150 ease-out-emil hover:bg-black/5 disabled:text-[var(--color-text-muted)] disabled:hover:bg-transparent dark:hover:bg-white/5"
                >
                  Quitar todos
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {grupos.map((g) => {
                const Icono = ICONO_FORMA[g.forma];
                return (
                  <Card key={g.forma} className="overflow-hidden p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          {/* El título del grupo va dentro del encabezado de la
                              tabla: al imprimir, el navegador nunca lo deja solo
                              al fondo de una hoja y lo repite en la siguiente. */}
                          <tr>
                            <th colSpan={6} className="border-b border-[var(--color-border)] bg-black/[0.02] px-4 py-2.5 text-left dark:bg-white/[0.03] print:bg-transparent">
                              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
                                <Icono size={15} />
                                {g.forma} ({g.tickets.length})
                              </span>
                            </th>
                          </tr>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                            <th className="w-11 py-2 pl-4 pr-3 print:w-0 print:p-0"><span className="sr-only">Incluir en el cierre</span></th>
                            <th className="py-2 pr-3 print:pl-4">Hora</th>
                            <th className="py-2 pr-3">Folio</th>
                            <th className="py-2 pr-3">Nombre</th>
                            <th className="py-2 pr-3">Procedimientos</th>
                            <th className="py-2 pr-4 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.tickets.map((t) => (
                            <tr key={t.id} className={`border-t border-[var(--color-border)] ${incluidos.has(t.id) ? "" : "opacity-40 print:hidden"}`}>
                              <td className="py-2 pl-4 pr-3 print:p-0">
                                <input
                                  type="checkbox"
                                  aria-label={`Incluir ${t.folio} en el cierre`}
                                  className="h-4 w-4 align-middle accent-[var(--color-brand-500)] print:hidden"
                                  checked={incluidos.has(t.id)}
                                  onChange={() => toggle(t.id)}
                                />
                              </td>
                              <td className="tabular py-2 pr-3 text-[var(--color-text-secondary)] print:pl-4">{horaLocal(fechaEfectiva(t))}</td>
                              <td className="tabular py-2 pr-3 font-semibold text-[var(--color-text-primary)]">{t.folio}</td>
                              <td className="py-2 pr-3">
                                <p className="font-semibold text-[var(--color-text-primary)]">{t.nombre}</p>
                                {t.identificador && <p className="text-xs text-[var(--color-text-muted)]">{t.identificador}</p>}
                              </td>
                              <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                                {t.procedimientos.map((p) => p.nombre).join(", ")}
                              </td>
                              <td className="tabular py-2 pr-4 text-right font-bold text-[var(--color-text-primary)]">{formatoMXN(t.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--color-border)] bg-black/[0.02] dark:bg-white/[0.03] print:bg-transparent">
                            <td colSpan={5} className="py-2 pl-4 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
                              <Badge tone={TONE_FORMA[g.forma]} className="mr-2 print:hidden">Subtotal</Badge>
                              <span className="print:inline hidden">Subtotal {g.forma}</span>
                            </td>
                            <td className="tabular py-2 pr-4 text-right font-extrabold text-[var(--color-text-primary)]">{formatoMXN(g.subtotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="mt-5">
              <PrintReportTotalBar label="Total del día" value={formatoMXN(total)} />
            </div>
            {conciliacion?.cierre && (
              <p className="mt-3 hidden break-inside-avoid border border-black/15 px-3 py-2 text-xs print:block">
                <strong>Conciliación con Getnet:</strong> {ESTADO_CIERRE_LABEL[conciliacion.cierre.estado]}
                {conciliacion.vigente ? "" : " (desactualizada)"} · Sistema (tarjeta) {formatoMXN(conciliacion.cierre.totalSistema)} · Getnet {formatoMXN(conciliacion.cierre.totalGetnet)} · Diferencia {formatoMXN(conciliacion.cierre.diferencia)}
                {conciliacion.cierre.observacion ? ` · Motivo: ${conciliacion.cierre.observacion}` : ""}
              </p>
            )}

            <PrintReportFooter orgNombre={org?.nombre} />
          </div>
        )
      ) : delMes.length === 0 ? (
        <EmptyState icon={<CalendarDays size={24} strokeWidth={1.75} />} title="No hay pagos en este mes" />
      ) : (
        <div id="cash-close-report-mes" data-print-report>
          <PrintReportHeader
            titulo={`Resumen mensual · ${mesLabel(mesVista)}`}
            contexto={`${org?.nombre ?? ""}${servicioActual ? " · " + servicioActual.nombre : ""}`}
            meta={[
              { label: "Folios", value: delMes.length },
              { label: "Procedimientos distintos", value: porProcedimiento.length },
            ]}
          />

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard className="border-2 border-brand-500" label={`Total ${mesLabel(mesVista)}`} value={<AnimatedNumber value={totalMes} from={totalMes} format={formatoMXN} startOnView={false} duration={0.4} />} />
            <StatCard label="Folios pagados" value={delMes.length} icon={<Receipt size={16} className="text-brand-500" />} />
            <StatCard label="Procedimientos distintos" value={porProcedimiento.length} icon={<ClipboardList size={16} className="text-brand-500" />} />
          </div>

          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] print:border-black/15">
                  <th className="py-2.5 pl-4">Procedimiento</th>
                  <th className="py-2.5 pr-3 text-right">Cantidad</th>
                  <th className="py-2.5 pr-3 text-right">% del mes</th>
                  <th className="py-2.5 pr-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {porProcedimiento.map((p) => (
                  <tr key={p.nombre} className="border-t border-[var(--color-border)] print:border-black/10">
                    <td className="py-2.5 pl-4 font-semibold text-[var(--color-text-primary)]">{p.nombre}</td>
                    <td className="tabular py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">{p.cantidad}</td>
                    <td className="tabular py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">
                      {totalMes > 0 ? Math.round((p.total / totalMes) * 100) : 0}%
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right font-bold text-[var(--color-text-primary)]">{formatoMXN(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="mt-5">
            <PrintReportTotalBar label={`Total ${mesLabel(mesVista)}`} value={formatoMXN(totalMes)} />
          </div>

          <PrintReportFooter orgNombre={org?.nombre} />
        </div>
      )}

      {servicioActual && (
        <EnviarArchivoModal
          open={enviarAbierto}
          onClose={() => setEnviarAbierto(false)}
          titulo={`Enviar ${label.toLowerCase()}`}
          subtitulo={`${servicioActual.nombre} · ${diaLargo(fecha)} · ${formatoMXN(total)}`}
          tipo={label}
          servicioId={servicioActual.id}
          servicioNombre={servicioActual.nombre}
          nombreArchivo={`${slug(label)}-${slug(servicioActual.nombre)}-${fecha}.csv`}
          contenido={csv}
          onEnviado={alEnviar}
        />
      )}
    </div>
  );
}
