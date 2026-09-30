import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { Avatar, Badge } from "../../components/ui/Misc";
import { useService } from "../../lib/service/ServiceContext";
import * as db from "../../lib/db";
import type { Ticket } from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";

const MONEDA_SIN_CENTAVOS = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

const DIAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function claveDia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Activity() {
  const { servicioActual } = useService();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const hoy = new Date();
  const [cursor, setCursor] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [ticketAbierto, setTicketAbierto] = useState<string | null>(null);

  useEffect(() => {
    if (!servicioActual) return;
    db.listarTickets(servicioActual.id).then(setTickets);
  }, [servicioActual]);

  const porDia = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const k = claveDia(new Date(t.fecha));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return map;
  }, [tickets]);

  const celdas = useMemo(() => {
    const primerDiaMes = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const ultimoDiaMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // Lunes = 0 ... Domingo = 6
    const offsetInicio = (primerDiaMes.getDay() + 6) % 7;
    const dias: (Date | null)[] = Array(offsetInicio).fill(null);
    for (let d = 1; d <= ultimoDiaMes.getDate(); d++) {
      dias.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    }
    return dias;
  }, [cursor]);

  const ticketsDelDiaAbierto = diaAbierto ? porDia.get(diaAbierto) ?? [] : [];
  const totalDiaAbierto = ticketsDelDiaAbierto.reduce((s, t) => s + t.total, 0);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[var(--color-text-primary)]">
          {MESES[cursor.getMonth()]} {cursor.getFullYear()}
        </h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setCursor(new Date(hoy.getFullYear(), hoy.getMonth(), 1))}
            className="rounded-full border border-[var(--color-border)] px-3.5 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            Hoy
          </button>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-2">
        {DIAS.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {celdas.map((fecha, i) => {
          if (!fecha) return <div key={`empty-${i}`} />;
          const k = claveDia(fecha);
          const delDia = porDia.get(k) ?? [];
          const hayPendiente = delDia.some((t) => t.estado === "credito");
          const esHoy = claveDia(hoy) === k;
          const totalDia = delDia.reduce((suma, t) => suma + t.total, 0);
          return (
            <Card
              key={k}
              onClick={delDia.length > 0 ? () => { setDiaAbierto(k); setTicketAbierto(null); } : undefined}
              aria-label={delDia.length > 0 ? `${fecha.getDate()}: ${delDia.length} folio${delDia.length === 1 ? "" : "s"}, ${formatoMXN(totalDia)}${hayPendiente ? ", con crédito pendiente" : ""}` : undefined}
              className={clsx(
                "flex aspect-square flex-col items-center justify-center gap-1 p-1.5 transition-[transform,border-color,box-shadow] duration-150 ease-out-emil sm:aspect-auto sm:h-24 sm:items-stretch sm:justify-between sm:p-2.5",
                delDia.length > 0 && "cursor-pointer hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md",
                esHoy && "ring-2 ring-brand-500"
              )}
            >
              {delDia.length > 0 ? (
                <>
                  <div className="flex items-center justify-center sm:justify-between">
                    <span className="tabular hidden text-sm font-bold text-[var(--color-text-primary)] sm:block">{fecha.getDate()}</span>
                    <span
                      className={clsx(
                        "flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold sm:h-6 sm:min-w-6",
                        hayPendiente ? "bg-[color:var(--color-warning)] text-[#3b2800]" : "bg-[color:var(--color-good-solid)] text-white"
                      )}
                    >
                      {delDia.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-[var(--color-text-muted)] sm:hidden">{fecha.getDate()}</span>
                  <span className="tabular hidden truncate text-xs font-bold text-[var(--color-text-secondary)] sm:block">{MONEDA_SIN_CENTAVOS.format(totalDia)}</span>
                </>
              ) : (
                <span className="tabular text-xs font-semibold text-[var(--color-text-muted)] sm:self-start sm:text-sm">{fecha.getDate()}</span>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-good-solid)]" /> Todo pagado</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-warning)]" /> Con crédito pendiente</span>
      </div>

      <Modal
        open={!!diaAbierto}
        onClose={() => setDiaAbierto(null)}
        title={diaAbierto ? new Date(diaAbierto + "T00:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) : undefined}
        subtitle={`${ticketsDelDiaAbierto.length} folio${ticketsDelDiaAbierto.length === 1 ? "" : "s"} · ${formatoMXN(totalDiaAbierto)}`}
      >
        <div className="space-y-2">
          {ticketsDelDiaAbierto.map((t) => {
            const abierto = ticketAbierto === t.id;
            return (
              <div key={t.id} className="rounded-xl border border-[var(--color-border)]">
                <button
                  type="button"
                  aria-expanded={abierto}
                  onClick={() => setTicketAbierto(abierto ? null : t.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Avatar nombre={t.nombre} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-[var(--color-text-primary)]">{t.nombre}</span>
                      <Badge tone={t.estado === "credito" ? "warning" : "good"}>{t.estado === "credito" ? "Crédito" : "Pagado"}</Badge>
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{t.categoria} · {t.folio}</p>
                  </div>
                  <span className="tabular flex-shrink-0 font-bold text-[var(--color-text-primary)]">{formatoMXN(t.total)}</span>
                  <ChevronDown size={16} className={clsx("flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ease-out-emil", abierto && "rotate-180")} />
                </button>
                {/* Se despliega en vez de aparecer de golpe: la fila de la
                    cuadrícula va de 0fr a 1fr (la única forma de animar a una
                    altura "automática" sin medirla). Cerrado, el contenido
                    queda inerte para el teclado y los lectores de pantalla. */}
                <div
                  inert={!abierto}
                  className={clsx(
                    "grid transition-[grid-template-rows] duration-200 ease-out-emil motion-reduce:transition-none",
                    abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                  <div className="space-y-1.5 border-t border-[var(--color-border)] px-3 py-2.5">
                    {t.procedimientos.map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--color-text-secondary)]">{p.nombre}</span>
                        <span className="tabular flex-shrink-0 font-semibold text-[var(--color-text-primary)]">{formatoMXN(p.costo)}</span>
                      </div>
                    ))}
                    {t.procedimientos.length === 0 && (
                      <p className="text-sm text-[var(--color-text-muted)]">Sin procedimientos registrados en este folio.</p>
                    )}
                    {t.identificador && (
                      <p className="mt-1 border-t border-[var(--color-border)] pt-1.5 text-xs text-[var(--color-text-muted)]">ID: {t.identificador}</p>
                    )}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
