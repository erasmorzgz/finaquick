import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, ShieldCheck, TriangleAlert, Upload, CircleCheck, CircleX } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Select } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Misc";
import * as db from "../../lib/db";
import type { CierreCaja, CierreCajaConVigencia, ServiceConfig } from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";
import { huellaArchivo, interpretarReporte, leerArchivoTabla, type Columnas } from "../../lib/getnet";
import { ESTADO_CIERRE_LABEL } from "../../lib/cierreEstado";

const MAX_ARCHIVO = 8 * 1024 * 1024;

const ESTADO_CIERRE_TONE = { aprobado: "good", no_aprobado: "critical", aprobado_con_diferencia: "warning" } as const;

interface Lectura {
  nombre: string;
  huella: string;
  tabla: string[][];
  columnas: Partial<Columnas>;
}

/** Sube el reporte diario de Getnet, lo compara con los cobros con
 * tarjeta del sistema para ese día, y muestra si el corte cuadra. */
export function ConciliacionGetnet({
  servicio, fecha, info, esAdmin, puedeOperar, cobrosTarjeta, onActualizado,
}: {
  servicio: ServiceConfig;
  fecha: string;
  info: CierreCajaConVigencia | null;
  esAdmin: boolean;
  puedeOperar: boolean;
  cobrosTarjeta: number;
  onActualizado: (nuevo: CierreCajaConVigencia) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [comparando, setComparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aprobando, setAprobando] = useState(false);
  const [observacion, setObservacion] = useState("");
  const [verCoinciden, setVerCoinciden] = useState(false);
  // Reconocer lo que no se pudo verificar del archivo (fechas ilegibles, referencia o fecha sin comprobar).
  const [reconozco, setReconozco] = useState(false);

  const referencia = servicio.referenciaGetnet;
  const cierre = info?.cierre ?? null;
  const vigente = info?.vigente ?? false;

  const reporte = useMemo(
    () => (lectura ? interpretarReporte(lectura.tabla, { fecha, referencia, columnas: lectura.columnas }) : null),
    [lectura, fecha, referencia]
  );
  const ventas = reporte?.movimientos.filter((m) => m.tipo === "venta") ?? [];
  const cancelaciones = reporte?.movimientos.filter((m) => m.tipo === "cancelacion") ?? [];
  const totalVentas = ventas.reduce((s, m) => s + m.monto, 0);
  const totalCancelaciones = cancelaciones.reduce((s, m) => s + m.monto, 0);

  async function elegirArchivo(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setLectura(null);
    setReconozco(false);
    if (archivo.size > MAX_ARCHIVO) return setError("El archivo pesa más de 8 MB — descarga solo el día que necesitas.");
    setLeyendo(true);
    try {
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const [tabla, huella] = await Promise.all([leerArchivoTabla(archivo.name, bytes), huellaArchivo(bytes)]);
      if (tabla.length === 0) throw new Error("El archivo está vacío.");
      setLectura({ nombre: archivo.name.slice(0, 200), huella, tabla, columnas: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  async function comparar() {
    if (!lectura || !reporte) return;
    setComparando(true);
    setError(null);
    try {
      const nuevo = await db.conciliarCierreCaja({
        servicioId: servicio.id, fecha, referencia, archivoNombre: lectura.nombre, archivoHash: lectura.huella, movimientos: reporte.movimientos,
      });
      onActualizado(nuevo);
      setLectura(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo comparar el corte.");
    } finally {
      setComparando(false);
    }
  }

  async function aprobarConDiferencia() {
    if (!cierre) return;
    setAprobando(true);
    setError(null);
    try {
      onActualizado(await db.aprobarCierreConDiferencia(cierre.id, observacion.trim()));
      setObservacion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aprobar el corte.");
    } finally {
      setAprobando(false);
    }
  }

  const cambiarColumna = (campo: "monto" | "fecha" | "autorizacion" | "tipo", valor: string) =>
    setLectura((l) => (l ? { ...l, columnas: { ...l.columnas, [campo]: valor === "" ? undefined : Number(valor) } } : l));
  const opcionesColumna = (reporte?.encabezado ?? []).map((t, i) => ({ i, t: t || `Columna ${i + 1}` }));

  return (
    <Card className="mb-5 p-4 print:hidden">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileSpreadsheet size={18} className="text-brand-600" aria-hidden />
        <h2 className="text-sm font-extrabold text-[var(--color-text-primary)]">Conciliación con Getnet</h2>
        {referencia && <span className="text-xs text-[var(--color-text-muted)]">Referencia {referencia}</span>}
        {cierre && <Badge tone={ESTADO_CIERRE_TONE[cierre.estado]} className="ml-auto">{ESTADO_CIERRE_LABEL[cierre.estado]}</Badge>}
      </div>

      {error && <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {!referencia && (
        <p className="mb-3 rounded-xl bg-black/[0.03] px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)]">
          Este servicio todavía no tiene su referencia de Getnet{esAdmin ? " — agrégala en Configuración → Servicios (ej. 566029) para tomar solo sus movimientos del reporte" : " — pídele a un administrador que la agregue"}.
          Mientras tanto se compara con todos los movimientos del archivo, y enviar el corte no exige la comparación.
        </p>
      )}

      {cierre && !vigente && (
        <p role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          <TriangleAlert size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
          Los cobros con tarjeta de este día cambiaron después de la comparación. Sube el reporte de nuevo para volver a compararlo.
        </p>
      )}

      {cierre && (
        <ResultadoCierre cierre={cierre} verCoinciden={verCoinciden} onVerCoinciden={() => setVerCoinciden((v) => !v)} />
      )}

      {cierre?.estado === "no_aprobado" && vigente && esAdmin && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
          <Field label="Aprobar el corte aunque no cuadre" hint="Un administrador puede autorizarlo dejando el motivo (mínimo 10 caracteres). Queda registrado en la bitácora.">
            <textarea
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              rows={2}
              maxLength={500}
              className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
              placeholder="Ej. El cobro de $10 se hizo en otra terminal y ya se entregó el recibo."
            />
          </Field>
          <Button variant="secondary" size="sm" className="self-start" icon={<ShieldCheck size={14} />} disabled={aprobando || observacion.trim().length < 10} onClick={aprobarConDiferencia}>
            {aprobando ? "Aprobando…" : "Aprobar con diferencia"}
          </Button>
        </div>
      )}

      {puedeOperar ? (
        <div className={cierre ? "mt-4 border-t border-[var(--color-border)] pt-3" : ""}>
          <input ref={entrada} type="file" accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Reporte diario de Getnet" onChange={(e) => { void elegirArchivo(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={cierre ? "ghost" : "secondary"} size="sm" icon={<Upload size={14} />} disabled={leyendo || comparando} onClick={() => entrada.current?.click()}>
              {leyendo ? "Leyendo…" : cierre ? "Subir el reporte de nuevo" : "Subir reporte de Getnet"}
            </Button>
            <span className="text-xs text-[var(--color-text-muted)]">
              {cobrosTarjeta > 0 ? `${cobrosTarjeta} cobro${cobrosTarjeta === 1 ? "" : "s"} con tarjeta en el sistema este día.` : "No hay cobros con tarjeta en el sistema este día."} Excel (.xlsx) o CSV.
            </span>
          </div>

          {lectura && reporte && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-3.5">
              <p className="text-sm text-[var(--color-text-primary)]">
                <strong className="font-bold">{lectura.nombre}</strong> · {reporte.movimientos.length} movimiento{reporte.movimientos.length === 1 ? "" : "s"}
                {reporte.movimientos.length > 0 && (
                  <span className="text-[var(--color-text-secondary)]">
                    {" "}— {ventas.length} venta{ventas.length === 1 ? "" : "s"} por {formatoMXN(totalVentas)}
                    {cancelaciones.length > 0 ? `, ${cancelaciones.length} cancelación(es) por ${formatoMXN(totalCancelaciones)}` : ""}
                  </span>
                )}
              </p>
              {reporte.avisos.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-amber-900">
                  {reporte.avisos.map((a) => (
                    <li key={a} className="flex items-start gap-2"><TriangleAlert size={14} className="mt-0.5 flex-shrink-0" aria-hidden />{a}</li>
                  ))}
                </ul>
              )}
              {reporte.confirmaciones.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                  <p className="mb-1 font-bold">Antes de comparar:</p>
                  <ul className="mb-2 list-disc pl-5">
                    {reporte.confirmaciones.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                  <label className="flex items-start gap-2 font-semibold">
                    <input type="checkbox" checked={reconozco} onChange={(e) => setReconozco(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]" />
                    Lo revisé y quiero compararlo así
                  </label>
                </div>
              )}
              <details open={reporte.columnas.monto === undefined}>
                <summary className="cursor-pointer text-xs font-bold text-brand-700">¿No es la columna correcta? Cambiar columnas</summary>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {([["monto", "Monto", true], ["fecha", "Fecha", false], ["autorizacion", "Autorización", false], ["tipo", "Tipo de movimiento", false]] as const).map(([campo, etiqueta, obligatoria]) => (
                    <Field key={campo} label={etiqueta}>
                      <Select value={reporte.columnas[campo] ?? ""} onChange={(e) => cambiarColumna(campo, e.target.value)}>
                        <option value="">{obligatoria ? "Elige una columna…" : "— ninguna —"}</option>
                        {opcionesColumna.map((o) => <option key={o.i} value={o.i}>{o.t}</option>)}
                      </Select>
                    </Field>
                  ))}
                </div>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<CircleCheck size={14} />} disabled={comparando || reporte.columnas.monto === undefined || reporte.movimientos.length > 5000 || (reporte.confirmaciones.length > 0 && !reconozco)} onClick={comparar}>
                  {comparando ? "Comparando…" : "Comparar con el corte"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLectura(null)}>Descartar</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Tu acceso a este servicio es de solo consulta: puedes ver la conciliación, no subir el reporte.</p>
      )}
    </Card>
  );
}

function ResultadoCierre({ cierre, verCoinciden, onVerCoinciden }: { cierre: CierreCaja; verCoinciden: boolean; onVerCoinciden: () => void }) {
  const soloSistema = cierre.detalle.soloSistema ?? [];
  const soloGetnet = cierre.detalle.soloGetnet ?? [];
  const coinciden = cierre.detalle.coinciden ?? [];
  const cuadra = cierre.estado === "aprobado";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
        <Cifra etiqueta="Sistema (tarjeta)" valor={formatoMXN(cierre.totalSistema)} sub={`${cierre.movimientosSistema} cobro(s)`} />
        <Cifra etiqueta="Getnet" valor={formatoMXN(cierre.totalGetnet)} sub={`${cierre.movimientosGetnet} movimiento(s)`} />
        <Cifra
          etiqueta="Diferencia"
          valor={`${cierre.diferencia > 0 ? "+" : ""}${formatoMXN(cierre.diferencia)}`}
          sub={cierre.diferencia === 0 ? "sin diferencia" : cierre.diferencia > 0 ? "Getnet de más" : "Getnet de menos"}
          destacada={!cuadra}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {cierre.archivoNombre ? `${cierre.archivoNombre} · ` : ""}comparado el {new Date(cierre.actualizadoEn).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
        {cierre.estado === "aprobado_con_diferencia" && cierre.aprobadorNombre ? ` · aprobado por ${cierre.aprobadorNombre}` : ""}
        {cierre.enviadoEn ? ` · enviado el ${new Date(cierre.enviadoEn).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}` : ""}
      </p>
      {cierre.observacion && <p className="rounded-xl bg-amber-50 px-3.5 py-2 text-sm text-amber-900"><strong>Motivo:</strong> {cierre.observacion}</p>}

      {soloSistema.length > 0 && (
        <ListaDiferencias titulo="En el sistema, pero Getnet no los reporta" filas={soloSistema.map((m) => ({ clave: m.folio, texto: `${m.folio} · ${m.nombre}${m.hora ? ` · ${m.hora}` : ""}`, monto: m.monto }))} />
      )}
      {soloGetnet.length > 0 && (
        <ListaDiferencias titulo="En Getnet, pero no están en el sistema" filas={soloGetnet.map((m, i) => ({ clave: `${i}-${m.autorizacion ?? ""}`, texto: `${m.monto < 0 ? "Cancelación" : "Venta"}${m.autorizacion ? ` · autorización ${m.autorizacion}` : ""}${m.hora ? ` · ${m.hora}` : ""}`, monto: m.monto }))} />
      )}
      {cuadra && (
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-good-text)]"><CircleCheck size={16} aria-hidden /> Los {coinciden.length} cobro(s) con tarjeta coinciden uno a uno con Getnet.</p>
      )}
      {coinciden.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">La coincidencia es por monto: confirma que las cantidades cuadran, pero no que una autorización de Getnet corresponda a esa persona en concreto.</p>
      )}
      {coinciden.length > 0 && (
        <div>
          <button type="button" onClick={onVerCoinciden} aria-expanded={verCoinciden} className="text-xs font-bold text-brand-700 hover:underline">
            {verCoinciden ? "Ocultar" : "Ver"} los {coinciden.length} que coinciden
          </button>
          {verCoinciden && (
            <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] text-sm">
              {coinciden.map((m, i) => (
                <li key={`${m.folio}-${i}`} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate text-[var(--color-text-secondary)]">{m.folio} · {m.nombre}{m.autorizacion ? ` · aut. ${m.autorizacion}` : ""}</span>
                  <span className="tabular flex-shrink-0 font-semibold">{formatoMXN(m.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, sub, destacada }: { etiqueta: string; valor: string; sub: string; destacada?: boolean }) {
  return (
    <div className={`rounded-xl border px-2 py-2.5 ${destacada ? "border-red-300 bg-red-50" : "border-[var(--color-border)]"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{etiqueta}</p>
      <p className={`tabular text-sm font-extrabold sm:text-base ${destacada ? "text-red-700" : "text-[var(--color-text-primary)]"}`}>{valor}</p>
      <p className="text-[11px] text-[var(--color-text-muted)]">{sub}</p>
    </div>
  );
}

function ListaDiferencias({ titulo, filas }: { titulo: string; filas: { clave: string; texto: string; monto: number }[] }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-red-700"><CircleX size={14} aria-hidden /> {titulo} ({filas.length})</p>
      <ul className="divide-y divide-red-100 rounded-xl border border-red-200 bg-red-50/50 text-sm">
        {filas.map((f) => (
          <li key={f.clave} className="flex justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate text-[var(--color-text-primary)]">{f.texto}</span>
            <span className="tabular flex-shrink-0 font-semibold text-red-700">{formatoMXN(f.monto)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
