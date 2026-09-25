import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, Send, Receipt, Banknote, CreditCard, Wallet, ClipboardList, CalendarDays } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Input";
import { EmptyState, StatCard, Badge } from "../../components/ui/Misc";
import { EnviarArchivoModal } from "../../components/ui/EnviarArchivoModal";
import { PrintReportHeader, PrintReportFooter, PrintReportTotalBar } from "../../components/ui/PrintReport";
import { useService } from "../../lib/service/ServiceContext";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { FormaPago, Ticket } from "../../lib/db/types";
import { formatoMXN, generarCSV } from "../../lib/utils";
// En su propio archivo (no aquí) para que SmartSearchModal.tsx pueda
// agrupar "cortes de caja"/"resumen" con exactamente el mismo criterio
// que esta pantalla, sin arrastrar la pantalla completa a su paquete
// — ver el comentario en fechaFolio.ts.
import { fechaLocal, fechaEfectiva, mesLocal } from "../../lib/fechaFolio";
import { AnimatedNumber } from "@/components/motion/animated-number";

const FORMATO_MES = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
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

  const fechasDisponibles = useMemo(
    () => Array.from(new Set(tickets.map((t) => fechaLocal(fechaEfectiva(t))))).sort().reverse(),
    [tickets]
  );

  const delDia = useMemo(
    () => tickets.filter((t) => fechaLocal(fechaEfectiva(t)) === fecha).sort((a, b) => fechaEfectiva(a).localeCompare(fechaEfectiva(b))),
    [tickets, fecha]
  );

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
    return generarCSV(["Folio", "Nombre", "Forma de pago", "Total"], filas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados, grupos, total]);

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

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex rounded-full bg-black/5 p-1 dark:bg-white/10">
          <button
            onClick={() => setVista("dia")}
            className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors ${vista === "dia" ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}
          >
            Por día
          </button>
          <button
            onClick={() => setVista("mes")}
            className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors ${vista === "mes" ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}
          >
            Por mes
          </button>
        </div>

        {vista === "dia" ? (
          <>
            <div className="w-56">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Fecha</label>
              <Select value={fecha} onChange={(e) => setFecha(e.target.value)}>
                {fechasDisponibles.length === 0 && <option value={fecha}>{fecha}</option>}
                {fechasDisponibles.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setIncluidos(new Set(delDia.map((t) => t.id)))}>Todos</Button>
            <Button variant="secondary" size="sm" onClick={() => setIncluidos(new Set())}>Ninguno</Button>
            <Button variant="secondary" className="ml-auto" icon={<Send size={16} />} onClick={() => setEnviarAbierto(true)} disabled={seleccionados.length === 0}>
              Enviar
            </Button>
            <Button icon={<Printer size={16} />} onClick={() => window.print()} disabled={seleccionados.length === 0}>
              Imprimir {label.toLowerCase()}
            </Button>
          </>
        ) : (
          <>
            <div className="w-56">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Mes</label>
              <Select value={mesVista} onChange={(e) => setMesVistaElegido(e.target.value)}>
                {mesesDisponibles.length === 0 && <option value="">Sin datos</option>}
                {mesesDisponibles.map((m) => (
                  <option key={m} value={m}>{mesLabel(m)}</option>
                ))}
              </Select>
            </div>
            <Button className="ml-auto" icon={<Printer size={16} />} onClick={() => window.print()} disabled={delMes.length === 0}>
              Imprimir resumen mensual
            </Button>
          </>
        )}
      </div>

      {vista === "dia" ? (
        delDia.length === 0 ? (
          <EmptyState icon={<Receipt size={24} strokeWidth={1.75} />} title="No hay pagos en esta fecha" />
        ) : (
          <div id="cash-close-report" data-print-report>
            <PrintReportHeader
              titulo={`${label} · ${fecha}`}
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

            <div className="flex flex-col gap-5">
              {grupos.map((g) => {
                const Icono = ICONO_FORMA[g.forma];
                return (
                  <Card key={g.forma} className="overflow-hidden p-0">
                    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-black/[0.02] px-4 py-2.5 dark:bg-white/[0.03] print:bg-transparent">
                      <Icono size={15} className="text-[var(--color-text-secondary)]" />
                      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
                        {g.forma} ({g.tickets.length})
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                            <th className="w-8 py-2 pl-4 print:hidden" />
                            <th className="py-2 pr-3">Hora</th>
                            <th className="py-2 pr-3">Folio</th>
                            <th className="py-2 pr-3">Nombre</th>
                            <th className="py-2 pr-3">Procedimientos</th>
                            <th className="py-2 pr-4 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.tickets.map((t) => (
                            <tr key={t.id} className={`border-t border-[var(--color-border)] ${incluidos.has(t.id) ? "" : "opacity-40 print:hidden"}`}>
                              <td className="py-2 pl-4 print:hidden">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-[var(--color-brand-500)]"
                                  checked={incluidos.has(t.id)}
                                  onChange={() => toggle(t.id)}
                                />
                              </td>
                              <td className="tabular py-2 pr-3 text-[var(--color-text-secondary)]">{horaLocal(fechaEfectiva(t))}</td>
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
          subtitulo={`${servicioActual.nombre} · ${fecha} · ${formatoMXN(total)}`}
          tipo={label}
          servicioId={servicioActual.id}
          servicioNombre={servicioActual.nombre}
          nombreArchivo={`${slug(label)}-${slug(servicioActual.nombre)}-${fecha}.csv`}
          contenido={csv}
        />
      )}
    </div>
  );
}
