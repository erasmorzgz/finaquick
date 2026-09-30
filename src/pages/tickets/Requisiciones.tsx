import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Plus, Check, X, PenLine, Send, Printer, Stamp, Trash2, ImagePlus } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Field, Input, Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Avatar, Badge, EmptyState } from "../../components/ui/Misc";
import { RequisicionDocumento } from "../../components/requisicion/RequisicionDocumento";
import { useService } from "../../lib/service/ServiceContext";
import { useAuth } from "../../lib/auth/AuthContext";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { Requisicion, UserProfile } from "../../lib/db/types";
import { reducirImagen } from "../../lib/imagenes";
import { useAvisos } from "@/lib/avisos/AvisosContext";

const ESTADO_TONE = { pendiente: "warning", aprobada: "good", rechazada: "critical" } as const;
const ESTADO_LABEL = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" } as const;
const ROLE_LABEL: Record<string, string> = { admin: "Administrador", finanzas: "Finanzas", personal: "Personal" };
const MAX_ARTICULOS = 30;
const CLASE_CAJA_ERROR = "rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400";

/** A quién se le puede enviar una requisición de este servicio: un
 * administrador, o alguien de finanzas con acceso completo al servicio
 * (el servidor lo vuelve a comprobar). */
function destinatariosPosibles(usuarios: UserProfile[], yoId: string | undefined, servicioId: string) {
  return usuarios.filter(
    (u) => u.id !== yoId && (u.rol === "admin" || (u.rol === "finanzas" && u.servicioIds.includes(servicioId) && !u.serviciosSoloConsulta?.includes(servicioId)))
  );
}

export default function Requisiciones() {
  const { servicioActual } = useService();
  const { user } = useAuth();
  const esAdmin = user?.rol === "admin";
  const [requisiciones, setRequisiciones] = useState<Requisicion[]>([]);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [abierta, setAbierta] = useState<Requisicion | null>(null);

  async function cargar() {
    if (!servicioActual) return;
    setRequisiciones(await db.listarRequisiciones(servicioActual.id));
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioActual]);

  const pendientes = useMemo(() => requisiciones.filter((r) => r.estado === "pendiente"), [requisiciones]);
  const resueltas = useMemo(() => requisiciones.filter((r) => r.estado !== "pendiente"), [requisiciones]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose text-sm text-[var(--color-text-secondary)]">
          Arma la requisición de compra con su formato, fírmala y séllala, y envíasela a quien la revisa — o descárgala para llevarla impresa.
        </p>
        <Button className="w-full flex-shrink-0 sm:w-auto" icon={<Plus size={16} />} onClick={() => setNuevaAbierta(true)}>Nueva requisición</Button>
      </div>

      {requisiciones.length === 0 ? (
        <EmptyState icon={<ClipboardList size={24} strokeWidth={1.75} />} title="Sin requisiciones todavía" hint="Cuando pidas material o una compra, aparecerá aquí." />
      ) : (
        <div className="flex flex-col gap-5">
          {pendientes.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Pendientes ({pendientes.length})</p>
              <div className="flex flex-col gap-2.5">
                {pendientes.map((r) => <TarjetaRequisicion key={r.id} r={r} paraMi={r.destinatarioId === user?.id} onClick={() => setAbierta(r)} />)}
              </div>
            </div>
          )}
          {resueltas.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Resueltas</p>
              <div className="flex flex-col gap-2.5">
                {resueltas.map((r) => <TarjetaRequisicion key={r.id} r={r} paraMi={false} onClick={() => setAbierta(r)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {servicioActual && nuevaAbierta && (
        <NuevaRequisicionModal
          servicioId={servicioActual.id}
          servicioNombre={servicioActual.nombre}
          onClose={() => setNuevaAbierta(false)}
          onCreada={() => { setNuevaAbierta(false); cargar(); }}
        />
      )}

      {abierta && servicioActual && (
        <DetalleRequisicionModal
          key={abierta.id}
          resumen={abierta}
          servicioId={servicioActual.id}
          esAdmin={esAdmin}
          onClose={() => setAbierta(null)}
          onCambio={() => { setAbierta(null); cargar(); }}
        />
      )}
    </div>
  );
}

function TarjetaRequisicion({ r, paraMi, onClick }: { r: Requisicion; paraMi: boolean; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="flex cursor-pointer items-center gap-3.5 px-4 py-3 transition-[transform,border-color,box-shadow] duration-150 ease-out-emil hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <Avatar nombre={r.solicitanteNombre ?? "?"} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-bold text-[var(--color-text-primary)]">{r.concepto}</span>
          <Badge tone={ESTADO_TONE[r.estado]} className="flex-shrink-0">{ESTADO_LABEL[r.estado]}</Badge>
          {paraMi && <Badge tone="brand" className="flex-shrink-0">Para ti</Badge>}
        </div>
        <p className="truncate text-xs text-[var(--color-text-muted)]">
          {r.folio} · {r.articulos.length} artículo{r.articulos.length === 1 ? "" : "s"} · {r.solicitanteNombre ?? "—"}
          {r.destinatarioNombre && r.estado === "pendiente" ? ` · enviada a ${r.destinatarioNombre}` : ""}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Nueva requisición
// ---------------------------------------------------------------------

interface Renglon {
  clave: number;
  cantidad: string;
  articulo: string;
  marca: string;
  url: string;
  imagen?: string;
}

function NuevaRequisicionModal({
  servicioId, servicioNombre, onClose, onCreada,
}: { servicioId: string; servicioNombre: string; onClose: () => void; onCreada: () => void }) {
  const { user } = useAuth();
  const { org } = useOrg();
  const avisar = useAvisos();
  const siguienteClave = useRef(1);
  const [departamento, setDepartamento] = useState(servicioNombre);
  const [renglones, setRenglones] = useState<Renglon[]>([{ clave: 0, cantidad: "1", articulo: "", marca: "", url: "" }]);
  const [motivo, setMotivo] = useState("");
  const [destinatarioId, setDestinatarioId] = useState("");
  const [conFirma, setConFirma] = useState(!!user?.firmaUrl);
  const [conSello, setConSello] = useState(!!user?.selloUrl);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    db.listarUsuarios().then((lista) => { if (vigente) setUsuarios(lista); }).catch(() => {});
    return () => { vigente = false; };
  }, []);
  const destinatarios = useMemo(() => destinatariosPosibles(usuarios, user?.id, servicioId), [usuarios, user?.id, servicioId]);

  function cambiar(clave: number, cambios: Partial<Renglon>) {
    setRenglones((lista) => lista.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));
  }
  function agregar() {
    setRenglones((lista) => (lista.length >= MAX_ARTICULOS ? lista : [...lista, { clave: siguienteClave.current++, cantidad: "1", articulo: "", marca: "", url: "" }]));
  }
  function quitar(clave: number) {
    setRenglones((lista) => (lista.length <= 1 ? lista : lista.filter((r) => r.clave !== clave)));
  }
  async function elegirImagen(clave: number, archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    try {
      cambiar(clave, { imagen: await reducirImagen(archivo, { maxLado: 320, formato: "jpeg", maxCaracteres: 90_000 }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo usar esa imagen.");
    }
  }

  const llenos = renglones.filter((r) => r.articulo.trim() !== "");

  async function crear() {
    setError(null);
    for (const r of llenos) {
      const cantidad = Number(r.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1) return setError(`La cantidad de "${r.articulo.trim()}" debe ser un número entero de 1 en adelante.`);
      if (r.url.trim() && !/^https?:\/\/\S+$/i.test(r.url.trim())) return setError(`La página de internet de "${r.articulo.trim()}" debe empezar con http:// o https://.`);
    }
    setEnviando(true);
    try {
      await db.crearRequisicion({
        servicioId,
        departamento: departamento.trim() || undefined,
        motivo: motivo.trim() || undefined,
        articulos: llenos.map((r) => ({
          cantidad: Number(r.cantidad),
          articulo: r.articulo.trim(),
          marca: r.marca.trim() || undefined,
          url: r.url.trim() || undefined,
          imagen: r.imagen,
        })),
        destinatarioId: destinatarioId || undefined,
        conFirma,
        conSello,
      });
      onCreada();
      const paraQuien = destinatarios.find((u) => u.id === destinatarioId);
      avisar({
        status: "success",
        title: paraQuien ? "Requisición enviada" : "Requisición guardada",
        description: paraQuien ? `Se la enviaste a ${paraQuien.nombre}.` : "Puedes enviarla o descargarla cuando quieras.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la requisición.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nueva requisición de compra" subtitle="Llena el formato — así saldrá impreso" width={760}>
      <div className="flex flex-col gap-4">
        {error && <p role="alert" className={CLASE_CAJA_ERROR}>{error}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Campus"><Input value={org?.nombre ?? ""} disabled className="opacity-70" /></Field>
          <Field label="Solicitante"><Input value={user?.nombre ?? ""} disabled className="opacity-70" /></Field>
          <Field label="Departamento"><Input value={departamento} onChange={(e) => setDepartamento(e.target.value)} maxLength={200} /></Field>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Artículos ({renglones.length}/{MAX_ARTICULOS})</p>
          <div className="flex flex-col gap-2.5">
            {renglones.map((r, i) => (
              <div key={r.clave} className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="grid grid-cols-[5rem_1fr] gap-2 sm:grid-cols-[5rem_1fr_9rem]">
                  <Input type="number" min={1} step={1} inputMode="numeric" aria-label={`Cantidad del artículo ${i + 1}`} value={r.cantidad} onChange={(e) => cambiar(r.clave, { cantidad: e.target.value })} />
                  <Input aria-label={`Artículo ${i + 1}`} placeholder="Artículo (ej. Juego de herramientas 104 pzas)" value={r.articulo} maxLength={200} onChange={(e) => cambiar(r.clave, { articulo: e.target.value })} autoFocus={i === 0} />
                  <Input aria-label={`Marca del artículo ${i + 1}`} placeholder="Marca" value={r.marca} maxLength={100} onChange={(e) => cambiar(r.clave, { marca: e.target.value })} className="col-span-2 sm:col-span-1" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input aria-label={`Página de internet del artículo ${i + 1}`} placeholder="Página de internet (https://…)" value={r.url} maxLength={500} onChange={(e) => cambiar(r.clave, { url: e.target.value })} />
                  <label className="flex h-[42px] w-[42px] flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-black/5 focus-within:ring-2 focus-within:ring-brand-500" title="Agregar imagen">
                    {r.imagen ? <img src={r.imagen} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <ImagePlus size={17} />}
                    <span className="sr-only">Imagen del artículo {i + 1}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void elegirImagen(r.clave, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  {r.imagen && (
                    <button type="button" onClick={() => cambiar(r.clave, { imagen: undefined })} className="flex-shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-black/5">Quitar imagen</button>
                  )}
                  <button type="button" aria-label={`Quitar el artículo ${i + 1}`} disabled={renglones.length <= 1} onClick={() => quitar(r.clave)} className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" icon={<Plus size={14} />} onClick={agregar} disabled={renglones.length >= MAX_ARTICULOS}>Agregar artículo</Button>
        </div>

        <Field label="Motivo de la solicitud">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Necesario para el mantenimiento preventivo de unidades y equipos…"
            className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
          />
        </Field>

        <Field label="Enviar a" hint="Puedes guardarla ahora y enviarla después.">
          <Select value={destinatarioId} onChange={(e) => setDestinatarioId(e.target.value)}>
            <option value="">Solo guardarla, por ahora</option>
            {destinatarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} — {ROLE_LABEL[u.rol]}</option>)}
          </Select>
        </Field>

        <div className="flex flex-col gap-1.5 rounded-xl bg-black/[0.03] px-3.5 py-3">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={conFirma} disabled={!user?.firmaUrl} onChange={(e) => setConFirma(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
            <PenLine size={14} /> Firmarla con mi firma
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={conSello} disabled={!user?.selloUrl} onChange={(e) => setConSello(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
            <Stamp size={14} /> Ponerle mi sello
          </label>
          {(!user?.firmaUrl || !user?.selloUrl) && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {!user?.firmaUrl && !user?.selloUrl ? "Guarda tu firma y tu sello" : !user?.firmaUrl ? "Guarda tu firma" : "Guarda tu sello"} en Mi perfil para poder usarlos aquí.
            </p>
          )}
        </div>

        <Button icon={<Send size={16} />} disabled={enviando || llenos.length === 0} onClick={crear}>
          {enviando ? "Guardando…" : destinatarioId ? "Guardar y enviar" : "Guardar requisición"}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Detalle: verla, imprimirla, enviarla, aprobarla o rechazarla
// ---------------------------------------------------------------------

/** Manda el documento a la impresora (o a "Guardar como PDF"): se monta
 * fuera de la aplicación, oculto en pantalla, y el CSS de impresión
 * deja solo esto en el papel. Avisa al terminar. */
function ImpresionRequisicion({
  r, orgNombre, encabezado, logoUrl, onListo,
}: { r: Requisicion; orgNombre: string; encabezado?: string; logoUrl?: string; onListo: () => void }) {
  const contenedor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let activo = true;
    const terminar = () => { if (activo) onListo(); };
    window.addEventListener("afterprint", terminar, { once: true });
    const imagenes = Array.from(contenedor.current?.querySelectorAll("img") ?? []);
    Promise.allSettled(imagenes.map((i) => i.decode())).then(() => {
      // Un cuadro más, para que el navegador termine de pintar el documento.
      requestAnimationFrame(() => { if (activo) window.print(); });
    });
    return () => { activo = false; window.removeEventListener("afterprint", terminar); };
  }, [onListo]);
  return createPortal(
    <div ref={contenedor} data-print-report className="hidden print:block">
      <RequisicionDocumento r={r} orgNombre={orgNombre} encabezado={encabezado} logoUrl={logoUrl} />
    </div>,
    document.body
  );
}

function DetalleRequisicionModal({
  resumen, servicioId, esAdmin, onClose, onCambio,
}: { resumen: Requisicion; servicioId: string; esAdmin: boolean; onClose: () => void; onCambio: () => void }) {
  const { user } = useAuth();
  const { org } = useOrg();
  const avisar = useAvisos();
  const [r, setR] = useState<Requisicion | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [conFirma, setConFirma] = useState(!!user?.firmaUrl);
  const [conSello, setConSello] = useState(!!user?.selloUrl);
  const [destinatarioId, setDestinatarioId] = useState("");
  const [rechazando, setRechazando] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const terminarImpresion = useCallback(() => setImprimiendo(false), []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    db.obtenerRequisicion(resumen.id)
      .then((completa) => { if (vigente) setR(completa); })
      .catch((err) => { if (vigente) setErrorCarga(err instanceof Error ? err.message : "No se pudo abrir la requisición."); });
    db.listarUsuarios().then((lista) => { if (vigente) setUsuarios(lista); }).catch(() => {});
    return () => { vigente = false; };
  }, [resumen.id]);

  const destinatarios = useMemo(() => destinatariosPosibles(usuarios, user?.id, servicioId), [usuarios, user?.id, servicioId]);
  const pendiente = resumen.estado === "pendiente";
  const puedeResolver = pendiente && (esAdmin || resumen.destinatarioId === user?.id);
  const puedeEnviar = pendiente && (esAdmin || resumen.solicitadoPor === user?.id);

  async function correr(accion: () => Promise<unknown>, exito: { title: string; description?: string; status?: "success" | "neutral" }) {
    setProcesando(true);
    setError(null);
    try {
      await accion();
      avisar({ status: exito.status ?? "success", title: exito.title, description: exito.description });
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={resumen.folio} subtitle={resumen.concepto} width={800}>
      <div className="flex flex-col gap-3.5">
        {error && <p role="alert" className={CLASE_CAJA_ERROR}>{error}</p>}
        {errorCarga && <p role="alert" className={CLASE_CAJA_ERROR}>{errorCarga}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ESTADO_TONE[resumen.estado]}>{ESTADO_LABEL[resumen.estado]}</Badge>
          {resumen.destinatarioNombre && pendiente && <span className="text-xs text-[var(--color-text-muted)]">Enviada a {resumen.destinatarioNombre}</span>}
          {!pendiente && resumen.aprobadorNombre && (
            <span className="text-xs text-[var(--color-text-muted)]">{resumen.estado === "aprobada" ? "Aprobada" : "Rechazada"} por {resumen.aprobadorNombre}</span>
          )}
          <Button className="ml-auto" variant="secondary" size="sm" icon={<Printer size={14} />} disabled={!r} onClick={() => setImprimiendo(true)}>
            Imprimir / guardar PDF
          </Button>
        </div>

        {r ? (
          <div role="region" aria-label="Vista previa de la requisición" tabIndex={0} className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
            <div className="min-w-[640px]">
              <RequisicionDocumento r={r} orgNombre={org?.nombre ?? ""} encabezado={org?.encabezadoDocumentos} logoUrl={org?.logoUrl} />
            </div>
          </div>
        ) : !errorCarga ? (
          <p className="py-10 text-center text-sm text-[var(--color-text-muted)]" role="status">Cargando…</p>
        ) : null}

        {puedeEnviar && (
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] pt-3">
            <div className="min-w-[14rem] flex-1">
              <Field label={resumen.destinatarioId ? "Enviarla a otra persona" : "Enviar a"}>
                <Select value={destinatarioId} onChange={(e) => setDestinatarioId(e.target.value)}>
                  <option value="">Elige a quién…</option>
                  {destinatarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} — {ROLE_LABEL[u.rol]}</option>)}
                </Select>
              </Field>
            </div>
            <Button
              variant="secondary"
              icon={<Send size={16} />}
              disabled={!destinatarioId || procesando}
              onClick={() => correr(() => db.enviarRequisicion(resumen.id, destinatarioId), { title: "Requisición enviada", description: destinatarios.find((u) => u.id === destinatarioId)?.nombre })}
            >
              Enviar
            </Button>
          </div>
        )}

        {puedeResolver && (
          rechazando ? (
            <div className="flex flex-col gap-2.5 border-t border-[var(--color-border)] pt-3">
              <Field label="Motivo del rechazo (opcional)">
                <textarea
                  value={motivoRechazo}
                  onChange={(e) => setMotivoRechazo(e.target.value)}
                  rows={2}
                  className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
                  autoFocus
                />
              </Field>
              <div className="flex gap-2">
                <Button variant="danger" disabled={procesando} onClick={() => correr(() => db.resolverRequisicion(resumen.id, "rechazada", { motivoRechazo: motivoRechazo.trim() || undefined }), { status: "neutral", title: "Requisición rechazada", description: resumen.concepto })}>
                  {procesando ? "Rechazando…" : "Confirmar rechazo"}
                </Button>
                <Button variant="ghost" onClick={() => setRechazando(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 border-t border-[var(--color-border)] pt-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={conFirma} disabled={!user?.firmaUrl} onChange={(e) => setConFirma(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                  <PenLine size={14} /> Agregar mi firma
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={conSello} disabled={!user?.selloUrl} onChange={(e) => setConSello(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                  <Stamp size={14} /> Agregar mi sello
                </label>
              </div>
              {(!user?.firmaUrl || !user?.selloUrl) && (
                <p className="text-xs text-[var(--color-text-muted)]">Guarda tu firma y tu sello en Mi perfil para poder estamparlos.</p>
              )}
              <div className="flex gap-2">
                <Button icon={<Check size={16} />} disabled={procesando || !r} onClick={() => correr(() => db.resolverRequisicion(resumen.id, "aprobada", { conFirma, conSello }), { title: "Requisición aprobada", description: resumen.concepto })}>
                  {procesando ? "Aprobando…" : "Aprobar"}
                </Button>
                <Button variant="secondary" icon={<X size={16} />} disabled={procesando} onClick={() => setRechazando(true)}>Rechazar</Button>
              </div>
            </div>
          )
        )}
      </div>

      {imprimiendo && r && (
        <ImpresionRequisicion r={r} orgNombre={org?.nombre ?? ""} encabezado={org?.encabezadoDocumentos} logoUrl={org?.logoUrl} onListo={terminarImpresion} />
      )}
    </Modal>
  );
}
