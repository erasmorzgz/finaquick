import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownRight, Minus, Printer } from "lucide-react";
import { Card, CardBody, SectionLabel } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/Misc";
import { Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { PrintReportHeader, PrintReportFooter, PrintReportTotalBar } from "../../components/ui/PrintReport";
import * as db from "../../lib/db";
import type {
  MonthlyRevenuePoint,
  ServiceComparisonRow,
  ServiceConfig,
  ServiceRevenueBreakdown,
  Ticket,
} from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";
import { useOrg } from "../../lib/theme/OrgContext";
import { AnimatedNumber } from "@/components/motion/animated-number";

// Orden fijo de colores por categoría — nunca se reasigna, para que la
// misma categoría se vea siempre del mismo color entre una gráfica y otra.
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function mesLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Mismo criterio que ya usan CashClose.tsx (fechaEfectiva) y el
// servidor (fechaCobro() en rutas.ts) — ticketsOrg ya está filtrado a
// "pagado" (ver más abajo), así que ya se eligió el criterio de caja;
// agrupar ese mismo filtro por la fecha de EMISIÓN (como hacía este
// desglose) mezclaba los dos criterios: un crédito de agosto cobrado
// en septiembre aparecía en agosto aquí, mientras que los totales por
// servicio de esta misma pantalla (que sí vienen ya corregidos de la
// API) lo atribuían a septiembre — dos secciones del mismo reporte en
// desacuerdo sobre a qué mes pertenece el mismo folio.
function fechaCobro(t: Ticket): string {
  return t.fechaPago ?? t.fecha;
}

function compact(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return formatoMXN(n);
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm shadow-xl">
      <p className="mb-1 font-bold text-[var(--color-text-primary)]">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="tabular text-[var(--color-text-secondary)]">
          {p.name ?? "Total"}: <span className="font-bold text-[var(--color-text-primary)]">{formatoMXN(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function FinanceDashboard() {
  const { org } = useOrg();
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [filtroServicio, setFiltroServicio] = useState<string>("");
  const [mensual, setMensual] = useState<MonthlyRevenuePoint[]>([]);
  const [porServicio, setPorServicio] = useState<ServiceRevenueBreakdown[]>([]);
  const [comparativo, setComparativo] = useState<ServiceComparisonRow[]>([]);
  const [pendienteCreditos, setPendienteCreditos] = useState(0);
  const [mesReporteElegido, setMesReporteElegido] = useState<string>("");
  const [porServicioReporte, setPorServicioReporte] = useState<ServiceRevenueBreakdown[]>([]);
  const [porServicioMesAnterior, setPorServicioMesAnterior] = useState<ServiceRevenueBreakdown[]>([]);
  const [ticketsOrg, setTicketsOrg] = useState<(Ticket & { servicioNombre: string })[]>([]);
  const [filtroServicioReporte, setFiltroServicioReporte] = useState<string>("");

  useEffect(() => {
    if (!org) return;
    setFiltroServicio("");
    db.listarServicios(org.id).then(setServicios);
    db.comparativoMensualPorServicio(org.id).then(setComparativo);
    db.totalPendienteCreditos(org.id).then(setPendienteCreditos);
  }, [org]);

  // Folios pagados de todos los servicios de la organización — se
  // cargan una sola vez por lista de servicios y de ahí se derivan los
  // desgloses por procedimiento de cualquier mes, sin volver a pedirlos
  // cada vez que cambia el selector.
  useEffect(() => {
    if (servicios.length === 0) return;
    let cancelado = false;
    Promise.all(
      servicios.map((s) =>
        db.listarTickets(s.id).then((list) =>
          list.filter((t) => t.estado === "pagado").map((t) => ({ ...t, servicioNombre: s.nombre }))
        )
      )
    ).then((porServicio) => {
      if (!cancelado) setTicketsOrg(porServicio.flat());
    });
    return () => {
      cancelado = true;
    };
  }, [servicios]);

  useEffect(() => {
    if (!org) return;
    db.ingresosMensuales(org.id, filtroServicio || undefined).then(setMensual);
    db.ingresosPorServicio(org.id).then(setPorServicio);
  }, [org, filtroServicio]);

  // Mientras el usuario no elija nada en el selector, el reporte
  // imprimible se queda en el mes más reciente con datos — se deriva en
  // cada render en vez de sincronizarlo con un efecto.
  const mesReporte = mesReporteElegido || mensual.at(-1)?.mes || "";
  // El mes anterior al elegido, tomado de la misma lista (siempre en
  // orden cronológico) — así la comparación sigue al mes que se está
  // viendo, no siempre al más reciente.
  const mesAnteriorReporte = mensual[mensual.findIndex((m) => m.mes === mesReporte) - 1]?.mes;

  useEffect(() => {
    if (!org || !mesReporte) return;
    db.ingresosPorServicio(org.id, mesReporte).then(setPorServicioReporte);
  }, [org, mesReporte]);

  useEffect(() => {
    if (!org || !mesAnteriorReporte) return;
    db.ingresosPorServicio(org.id, mesAnteriorReporte).then(setPorServicioMesAnterior);
  }, [org, mesAnteriorReporte]);
  // Si el mes elegido no tiene mes anterior (p.ej. el más antiguo de la
  // lista), lo que haya quedado en el estado de un mes distinto no debe
  // usarse — se descarta al leerlo, no al escribirlo.
  const datosMesAnterior = useMemo(
    () => (mesAnteriorReporte ? porServicioMesAnterior : []),
    [mesAnteriorReporte, porServicioMesAnterior]
  );

  const mesActualTotal = mensual.at(-1)?.total ?? 0;
  const mesAnteriorTotal = mensual.at(-2)?.total ?? 0;
  const deltaMes = mesAnteriorTotal > 0 ? ((mesActualTotal - mesAnteriorTotal) / mesAnteriorTotal) * 100 : null;

  const totalGeneralHistorico = useMemo(() => mensual.reduce((s, m) => s + m.total, 0), [mensual]);
  const totalPorServicio = useMemo(() => porServicio.reduce((s, p) => s + p.total, 0), [porServicio]);

  const colorPorServicio = useMemo(() => {
    const map = new Map<string, string>();
    servicios.forEach((s, i) => map.set(s.id, SERIES_COLORS[i % SERIES_COLORS.length]));
    return map;
  }, [servicios]);

  const mesReporteLabel = mensual.find((m) => m.mes === mesReporte)?.label ?? mesReporte;
  const mesAnteriorReporteLabel = mensual.find((m) => m.mes === mesAnteriorReporte)?.label;
  const totalReporte = useMemo(() => porServicioReporte.reduce((s, p) => s + p.total, 0), [porServicioReporte]);
  const totalMesAnteriorReporte = useMemo(() => datosMesAnterior.reduce((s, p) => s + p.total, 0), [datosMesAnterior]);
  const deltaReporte = totalMesAnteriorReporte > 0 ? ((totalReporte - totalMesAnteriorReporte) / totalMesAnteriorReporte) * 100 : null;

  // Une los dos meses por servicio para la comparación del reporte
  // imprimible — incluye un servicio si tuvo ingresos en cualquiera de
  // los dos meses, no solo en el actual.
  const comparativoReporte = useMemo(() => {
    const nombres = new Map<string, string>();
    porServicioReporte.forEach((p) => nombres.set(p.servicioId, p.servicioNombre));
    datosMesAnterior.forEach((p) => nombres.set(p.servicioId, p.servicioNombre));
    return Array.from(nombres.entries())
      .map(([servicioId, servicioNombre]) => {
        const actual = porServicioReporte.find((p) => p.servicioId === servicioId)?.total ?? 0;
        const anterior = datosMesAnterior.find((p) => p.servicioId === servicioId)?.total ?? 0;
        const delta = anterior > 0 ? ((actual - anterior) / anterior) * 100 : null;
        return { servicioId, servicioNombre, actual, anterior, delta };
      })
      .filter((r) => r.actual > 0 || r.anterior > 0)
      .sort((a, b) => b.actual - a.actual);
  }, [porServicioReporte, datosMesAnterior]);

  // Mismo desglose que comparativoReporte, pero un nivel más abajo: por
  // procedimiento dentro de cada servicio, no solo el total del
  // servicio. Se agrupa por servicio + nombre de procedimiento, para no
  // mezclar dos procedimientos que se llamen igual en servicios
  // distintos.
  const comparativoProcedimientos = useMemo(() => {
    const filas = new Map<string, { servicioId: string; servicioNombre: string; procedimiento: string; actual: number; anterior: number }>();
    for (const t of ticketsOrg) {
      const mes = mesLocal(fechaCobro(t));
      if (mes !== mesReporte && mes !== mesAnteriorReporte) continue;
      for (const p of t.procedimientos) {
        const clave = `${t.servicioId}::${p.nombre}`;
        const fila = filas.get(clave) ?? { servicioId: t.servicioId, servicioNombre: t.servicioNombre, procedimiento: p.nombre, actual: 0, anterior: 0 };
        if (mes === mesReporte) fila.actual += p.costo;
        else fila.anterior += p.costo;
        filas.set(clave, fila);
      }
    }
    return Array.from(filas.values())
      .filter((f) => !filtroServicioReporte || f.servicioId === filtroServicioReporte)
      .map((f) => ({ ...f, delta: f.anterior > 0 ? ((f.actual - f.anterior) / f.anterior) * 100 : null }))
      .sort((a, b) => b.actual - a.actual);
  }, [ticketsOrg, mesReporte, mesAnteriorReporte, filtroServicioReporte]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        <StatCard
          className="xl:col-span-2"
          hero
          label="Ingresos del mes"
          value={<AnimatedNumber value={mesActualTotal} format={compact} duration={0.9} />}
          icon={<TrendingUp size={18} className="text-white/80" />}
          delta={deltaMes === null ? null : { value: `${Math.abs(deltaMes).toFixed(1)}%`, positive: deltaMes >= 0 }}
          sub={`Acumulado 6 meses: ${compact(totalGeneralHistorico)}`}
        />
        <StatCard label="Créditos pendientes" value={<AnimatedNumber value={pendienteCreditos} format={compact} duration={0.9} />} icon={<Wallet size={16} className="text-brand-500" />} />
        <StatCard
          label="Servicios activos"
          value={<AnimatedNumber value={servicios.filter((s) => s.activo).length} duration={0.9} />}
          icon={<TrendingUp size={16} className="text-brand-500" />}
        />
      </div>

      <Card glass className="print:hidden">
        <CardBody className="pt-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <SectionLabel className="mb-1">Reporte mensual imprimible</SectionLabel>
              <p className="text-sm text-[var(--color-text-secondary)]">Desglose por servicio y por procedimiento de un mes específico, comparado contra el mes anterior — listo para imprimir o guardar como PDF.</p>
            </div>
            <div className="flex flex-shrink-0 items-end gap-3">
              <div className="w-44">
                <Select value={mesReporte} onChange={(e) => setMesReporteElegido(e.target.value)}>
                  {mensual.map((m) => (
                    <option key={m.mes} value={m.mes}>{m.label}</option>
                  ))}
                </Select>
              </div>
              <div className="w-48">
                <Select value={filtroServicioReporte} onChange={(e) => setFiltroServicioReporte(e.target.value)}>
                  <option value="">Todos los servicios</option>
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </Select>
              </div>
              <Button icon={<Printer size={16} />} onClick={() => window.print()} disabled={porServicioReporte.length === 0}>
                Imprimir
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <div id="finance-report" data-print-report>
        <PrintReportHeader
          titulo={`Reporte financiero · ${mesReporteLabel}`}
          contexto={org?.nombre}
          meta={[
            { label: "Servicios con ingresos", value: porServicioReporte.filter((p) => p.total > 0).length },
            { label: "Créditos pendientes", value: formatoMXN(pendienteCreditos) },
          ]}
        />

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard className="border-2 border-brand-500" label={`Total ${mesReporteLabel}`} value={formatoMXN(totalReporte)} />
          <StatCard
            label={mesAnteriorReporteLabel ? `Mes anterior (${mesAnteriorReporteLabel})` : "Mes anterior"}
            value={formatoMXN(totalMesAnteriorReporte)}
            delta={deltaReporte === null ? null : { value: `${Math.abs(deltaReporte).toFixed(1)}%`, positive: deltaReporte >= 0 }}
          />
          <StatCard label="Créditos pendientes" value={formatoMXN(pendienteCreditos)} icon={<Wallet size={16} className="text-brand-500" />} />
        </div>

        <Card glass className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] print:border-black/15">
                <th className="py-2.5 pl-4">Servicio</th>
                {mesAnteriorReporteLabel && <th className="py-2.5 pr-3 text-right">{mesAnteriorReporteLabel}</th>}
                <th className="py-2.5 pr-3 text-right">{mesReporteLabel}</th>
                <th className="py-2.5 pr-3 text-right">% del mes</th>
                <th className="py-2.5 pr-4 text-right">Variación</th>
              </tr>
            </thead>
            <tbody>
              {comparativoReporte.map((r) => (
                <tr key={r.servicioId} className="border-t border-[var(--color-border)] print:border-black/10">
                  <td className="py-2.5 pl-4">
                    <span className="flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full print:hidden" style={{ background: colorPorServicio.get(r.servicioId) }} />
                      {r.servicioNombre}
                    </span>
                  </td>
                  {mesAnteriorReporteLabel && (
                    <td className="tabular py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">{formatoMXN(r.anterior)}</td>
                  )}
                  <td className="tabular py-2.5 pr-3 text-right font-bold text-[var(--color-text-primary)]">{formatoMXN(r.actual)}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">
                    {totalReporte > 0 ? Math.round((r.actual / totalReporte) * 100) : 0}%
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    {r.delta === null ? (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    ) : (
                      <span className={r.delta >= 0 ? "font-bold text-[color:var(--color-good)]" : "font-bold text-[color:var(--color-critical)]"}>
                        {r.delta >= 0 ? "+" : ""}{r.delta.toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {comparativoReporte.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 pl-4 text-sm text-[var(--color-text-muted)]">Sin ingresos registrados este mes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <SectionLabel className="mb-3 mt-6">
          Por procedimiento{filtroServicioReporte && " · " + servicios.find((s) => s.id === filtroServicioReporte)?.nombre}
        </SectionLabel>
        <Card glass className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] print:border-black/15">
                <th className="py-2.5 pl-4">Servicio</th>
                <th className="py-2.5 pr-3">Procedimiento</th>
                {mesAnteriorReporteLabel && <th className="py-2.5 pr-3 text-right">{mesAnteriorReporteLabel}</th>}
                <th className="py-2.5 pr-3 text-right">{mesReporteLabel}</th>
                <th className="py-2.5 pr-4 text-right">Variación</th>
              </tr>
            </thead>
            <tbody>
              {comparativoProcedimientos.map((r) => (
                <tr key={`${r.servicioId}::${r.procedimiento}`} className="border-t border-[var(--color-border)] print:border-black/10">
                  <td className="py-2.5 pl-4 text-[var(--color-text-secondary)]">{r.servicioNombre}</td>
                  <td className="py-2.5 pr-3 font-semibold text-[var(--color-text-primary)]">{r.procedimiento}</td>
                  {mesAnteriorReporteLabel && (
                    <td className="tabular py-2.5 pr-3 text-right text-[var(--color-text-secondary)]">{formatoMXN(r.anterior)}</td>
                  )}
                  <td className="tabular py-2.5 pr-3 text-right font-bold text-[var(--color-text-primary)]">{formatoMXN(r.actual)}</td>
                  <td className="py-2.5 pr-4 text-right">
                    {r.delta === null ? (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    ) : (
                      <span className={r.delta >= 0 ? "font-bold text-[color:var(--color-good)]" : "font-bold text-[color:var(--color-critical)]"}>
                        {r.delta >= 0 ? "+" : ""}{r.delta.toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {comparativoProcedimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 pl-4 text-sm text-[var(--color-text-muted)]">Sin procedimientos registrados este mes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <div className="mt-5">
          <PrintReportTotalBar label={`Total ${mesReporteLabel}`} value={formatoMXN(totalReporte)} />
        </div>

        <PrintReportFooter orgNombre={org?.nombre} />
      </div>

      <Card glass className="print:hidden">
        <CardBody className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel className="mb-1">Ingresos totales</SectionLabel>
              <p className="text-sm text-[var(--color-text-secondary)]">Últimos 6 meses{filtroServicio && " · " + servicios.find((s) => s.id === filtroServicio)?.nombre}</p>
            </div>
            <Select className="w-56" value={filtroServicio} onChange={(e) => setFiltroServicio(e.target.value)}>
              <option value="">Todos los servicios</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </Select>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={mensual} margin={{ left: -12, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-baseline)" }} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={56} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="total" name="Ingresos" stroke="var(--color-brand-500)" strokeWidth={2} fill="url(#revFill)" dot={{ r: 3, fill: "var(--color-brand-500)", strokeWidth: 2, stroke: "var(--color-surface)" }} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-surface)" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr] print:hidden">
        <Card glass>
          <CardBody className="pt-5">
            <SectionLabel>Ingresos por servicio (mes actual)</SectionLabel>
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <div className="relative h-52 w-52 flex-shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={porServicio.filter((s) => s.total > 0)}
                      dataKey="total"
                      nameKey="servicioNombre"
                      innerRadius="68%"
                      outerRadius="100%"
                      paddingAngle={3}
                      stroke="var(--color-surface)"
                      strokeWidth={3}
                      isAnimationActive={false}
                    >
                      {porServicio
                        .filter((s) => s.total > 0)
                        .map((s) => (
                          <Cell key={s.servicioId} fill={colorPorServicio.get(s.servicioId) ?? SERIES_COLORS[0]} />
                        ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Total</span>
                  <span className="tabular text-xl font-extrabold text-[var(--color-text-primary)]">{compact(totalPorServicio)}</span>
                </div>
              </div>
              <div className="w-full min-w-0 space-y-2.5">
                {porServicio
                  .filter((s) => s.total > 0)
                  .sort((a, b) => b.total - a.total)
                  .map((s) => (
                    <div key={s.servicioId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: colorPorServicio.get(s.servicioId) }} />
                        <span className="truncate text-[var(--color-text-secondary)]">{s.servicioNombre}</span>
                      </span>
                      <span className="tabular flex-shrink-0 font-bold text-[var(--color-text-primary)]">
                        {totalPorServicio > 0 ? Math.round((s.total / totalPorServicio) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                {porServicio.every((s) => s.total === 0) && (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin ingresos registrados este mes.</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card glass>
          <CardBody className="pt-5">
            <SectionLabel>Comparativo vs. mes anterior</SectionLabel>
            <div className="space-y-1">
              {comparativo
                .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))
                .map((row) => (
                  <div key={row.servicioId} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: colorPorServicio.get(row.servicioId) }} />
                      <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{row.servicioNombre}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="tabular text-sm text-[var(--color-text-secondary)]">{compact(row.mesActual)}</span>
                      {row.deltaPct === null ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-text-muted)]"><Minus size={12} /> —</span>
                      ) : row.deltaPct >= 0 ? (
                        <span className="flex items-center gap-0.5 rounded-full bg-[color:var(--color-good)]/10 px-2 py-1 text-xs font-bold text-[color:var(--color-good)]">
                          <ArrowUpRight size={13} /> {row.deltaPct.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 rounded-full bg-[color:var(--color-critical)]/10 px-2 py-1 text-xs font-bold text-[color:var(--color-critical)]">
                          <ArrowDownRight size={13} /> {row.deltaPct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Compara el total pagado del mes más reciente contra el mes anterior, por servicio.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
