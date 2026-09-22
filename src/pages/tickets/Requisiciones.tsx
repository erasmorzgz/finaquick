import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, Check, X, PenLine } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Avatar, Badge, EmptyState } from "../../components/ui/Misc";
import { useService } from "../../lib/service/ServiceContext";
import { useAuth } from "../../lib/auth/AuthContext";
import * as db from "../../lib/db";
import type { Requisicion } from "../../lib/db/types";

const ESTADO_TONE = { pendiente: "warning", aprobada: "good", rechazada: "critical" } as const;
const ESTADO_LABEL = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" } as const;

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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Solicita material o compras para tu servicio — {esAdmin ? "tú apruebas o rechazas las tuyas y las del resto del equipo." : "un administrador la aprueba o la rechaza."}
        </p>
        <Button icon={<Plus size={16} />} onClick={() => setNuevaAbierta(true)}>Nueva requisición</Button>
      </div>

      {requisiciones.length === 0 ? (
        <EmptyState icon={<ClipboardList size={24} strokeWidth={1.75} />} title="Sin requisiciones todavía" hint="Cuando pidas material o una compra, aparecerá aquí." />
      ) : (
        <div className="flex flex-col gap-5">
          {pendientes.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Pendientes ({pendientes.length})</p>
              <div className="flex flex-col gap-2.5">
                {pendientes.map((r) => <TarjetaRequisicion key={r.id} r={r} onClick={() => setAbierta(r)} />)}
              </div>
            </div>
          )}
          {resueltas.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Resueltas</p>
              <div className="flex flex-col gap-2.5">
                {resueltas.map((r) => <TarjetaRequisicion key={r.id} r={r} onClick={() => setAbierta(r)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {servicioActual && (
        <NuevaRequisicionModal
          open={nuevaAbierta}
          servicioId={servicioActual.id}
          onClose={() => setNuevaAbierta(false)}
          onCreada={() => { setNuevaAbierta(false); cargar(); }}
        />
      )}

      <DetalleRequisicionModal
        requisicion={abierta}
        esAdmin={esAdmin}
        tieneFirma={!!user?.firmaUrl}
        onClose={() => setAbierta(null)}
        onResuelta={() => { setAbierta(null); cargar(); }}
      />
    </div>
  );
}

function TarjetaRequisicion({ r, onClick }: { r: Requisicion; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="flex cursor-pointer items-center gap-3.5 px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <Avatar nombre={r.solicitanteNombre ?? "?"} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-bold text-[var(--color-text-primary)]">{r.concepto}</span>
          <Badge tone={ESTADO_TONE[r.estado]} className="flex-shrink-0">{ESTADO_LABEL[r.estado]}</Badge>
        </div>
        <p className="truncate text-xs text-[var(--color-text-muted)]">
          {r.folio} · Cantidad {r.cantidad} · {r.solicitanteNombre ?? "—"}
        </p>
      </div>
    </Card>
  );
}

function NuevaRequisicionModal({
  open, servicioId, onClose, onCreada,
}: { open: boolean; servicioId: string; onClose: () => void; onCreada: () => void }) {
  const [concepto, setConcepto] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setConcepto(""); setCantidad(1); setNotas(""); setError(null); }
  }, [open]);

  async function crear() {
    setEnviando(true);
    setError(null);
    try {
      await db.crearRequisicion({ servicioId, concepto: concepto.trim(), cantidad, notas: notas.trim() || undefined });
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la requisición.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nueva requisición" subtitle="Solicita material o una compra para este servicio">
      <div className="flex flex-col gap-3">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</p>
        )}
        <Field label="¿Qué necesitas?">
          <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej. Papel para impresora, guantes de látex…" autoFocus />
        </Field>
        <Field label="Cantidad">
          <Input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Notas (opcional)">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={3}
            placeholder="Cualquier detalle que le sirva a quien la apruebe…"
            className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
          />
        </Field>
        <Button disabled={enviando || !concepto.trim()} onClick={crear}>
          {enviando ? "Enviando…" : "Enviar requisición"}
        </Button>
      </div>
    </Modal>
  );
}

function DetalleRequisicionModal({
  requisicion: r, esAdmin, tieneFirma, onClose, onResuelta,
}: { requisicion: Requisicion | null; esAdmin: boolean; tieneFirma: boolean; onClose: () => void; onResuelta: () => void }) {
  const [conFirma, setConFirma] = useState(true);
  const [rechazando, setRechazando] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConFirma(tieneFirma);
    setRechazando(false);
    setMotivoRechazo("");
    setError(null);
  }, [r, tieneFirma]);

  if (!r) return null;

  async function aprobar() {
    setProcesando(true);
    setError(null);
    try {
      await db.resolverRequisicion(r!.id, "aprobada", { conFirma });
      onResuelta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aprobar.");
    } finally {
      setProcesando(false);
    }
  }

  async function rechazar() {
    setProcesando(true);
    setError(null);
    try {
      await db.resolverRequisicion(r!.id, "rechazada", { motivoRechazo: motivoRechazo.trim() || undefined });
      onResuelta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo rechazar.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal open={!!r} onClose={onClose} title={r.folio} subtitle={r.concepto}>
      <div className="flex flex-col gap-3">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</p>
        )}
        <Row label="Cantidad" value={String(r.cantidad)} />
        <Row label="Solicitado por" value={r.solicitanteNombre ?? "—"} />
        <Row label="Estado" value={<Badge tone={ESTADO_TONE[r.estado]}>{ESTADO_LABEL[r.estado]}</Badge>} />
        {r.notas && <Row label="Notas" value={r.notas} />}
        {r.estado !== "pendiente" && (
          <>
            <Row label={r.estado === "aprobada" ? "Aprobado por" : "Rechazado por"} value={r.aprobadorNombre ?? "—"} />
            {r.motivoRechazo && <Row label="Motivo" value={r.motivoRechazo} />}
            {r.firmaResolucion && (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Firma</p>
                <img src={r.firmaResolucion} alt="Firma de resolución" className="h-16 rounded-lg border border-[var(--color-border)] bg-white object-contain px-2" />
              </div>
            )}
          </>
        )}

        {esAdmin && r.estado === "pendiente" && (
          rechazando ? (
            <div className="mt-2 flex flex-col gap-2.5 border-t border-[var(--color-border)] pt-3">
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
                <Button variant="danger" disabled={procesando} onClick={rechazar}>{procesando ? "Rechazando…" : "Confirmar rechazo"}</Button>
                <Button variant="ghost" onClick={() => setRechazando(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2.5 border-t border-[var(--color-border)] pt-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={conFirma} disabled={!tieneFirma} onChange={(e) => setConFirma(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                <PenLine size={14} /> Agregar mi firma
              </label>
              {!tieneFirma && <p className="text-xs text-[var(--color-text-muted)]">No tienes una firma guardada — agrégala en Mi perfil para poder estamparla.</p>}
              <div className="flex gap-2">
                <Button icon={<Check size={16} />} disabled={procesando} onClick={aprobar}>{procesando ? "Aprobando…" : "Aprobar"}</Button>
                <Button variant="secondary" icon={<X size={16} />} disabled={procesando} onClick={() => setRechazando(true)}>Rechazar</Button>
              </div>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-right font-semibold text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}
