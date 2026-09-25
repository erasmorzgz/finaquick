import { useEffect, useMemo, useState } from "react";
import { Search, Banknote, CreditCard, Send } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Avatar, Badge, EmptyState } from "../../components/ui/Misc";
import { Modal } from "../../components/ui/Modal";
import { EnviarArchivoModal } from "../../components/ui/EnviarArchivoModal";
import { useService } from "../../lib/service/ServiceContext";
import { useAuth } from "../../lib/auth/AuthContext";
import * as db from "../../lib/db";
import type { FormaPago, Ticket } from "../../lib/db/types";
import { formatoMXN, generarCSV } from "../../lib/utils";
import { useAvisos } from "@/lib/avisos/AvisosContext";

interface Grupo {
  key: string;
  nombre: string;
  identificador?: string;
  tickets: Ticket[];
  total: number;
}

export default function Credits() {
  const { servicioActual } = useService();
  const { user } = useAuth();
  const soloConsulta = !!(servicioActual && user?.serviciosSoloConsulta?.includes(servicioActual.id));
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [q, setQ] = useState("");
  const [grupoAbierto, setGrupoAbierto] = useState<Grupo | null>(null);
  const [enviarGrupo, setEnviarGrupo] = useState<Grupo | null>(null);
  const [saldando, setSaldando] = useState(false);
  const [errorSaldar, setErrorSaldar] = useState<string | null>(null);
  const avisar = useAvisos();

  async function cargar() {
    if (!servicioActual) return;
    const list = await db.listarTickets(servicioActual.id);
    setTickets(list.filter((t) => t.estado === "credito"));
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioActual]);

  const grupos: Grupo[] = useMemo(() => {
    const map = new Map<string, Grupo>();
    for (const t of tickets) {
      if (q && !t.nombre.toLowerCase().includes(q.toLowerCase()) && !t.folio.toLowerCase().includes(q.toLowerCase())) continue;
      const key = `${t.nombre}__${t.identificador ?? ""}`;
      if (!map.has(key)) map.set(key, { key, nombre: t.nombre, identificador: t.identificador, tickets: [], total: 0 });
      const g = map.get(key)!;
      g.tickets.push(t);
      g.total += t.total;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [tickets, q]);

  const totalPendiente = grupos.reduce((s, g) => s + g.total, 0);

  async function saldar(g: Grupo, formaPago: FormaPago) {
    setErrorSaldar(null);
    setSaldando(true);
    try {
      // Un solo POST para todo el grupo — el servidor lo aplica dentro
      // de una única transacción real (ver POST /tickets/pago-lote):
      // si UN folio del grupo ya no está disponible para pagar, NINGUNO
      // se marca como pagado. Antes, un folio por petición dejaba, si
      // el tercero de cinco fallaba, los dos primeros ya pagados y los
      // últimos dos no, sin que nada lo deshiciera.
      await db.registrarPagoLote(g.tickets.map((t) => t.id), formaPago);
      setGrupoAbierto(null);
      avisar({
        status: "success",
        title: `Cuenta de ${g.nombre} saldada`,
        description: `${g.tickets.length} folio${g.tickets.length === 1 ? "" : "s"} · ${formatoMXN(g.total)} · ${formaPago}`,
      });
    } catch (err) {
      setErrorSaldar(err instanceof Error ? err.message : "No se pudo saldar la cuenta — vuelve a intentar.");
    } finally {
      setSaldando(false);
      cargar();
    }
  }

  const csvDelGrupo = useMemo(() => {
    if (!enviarGrupo) return "";
    const filas: (string | number)[][] = enviarGrupo.tickets.map((t) => [
      t.folio,
      t.categoria,
      new Date(t.fecha).toLocaleDateString("es-MX"),
      t.total,
    ]);
    filas.push([]);
    filas.push(["", "", "Total pendiente", enviarGrupo.total]);
    return generarCSV(["Folio", "Categoría", "Fecha", "Total"], filas);
  }, [enviarGrupo]);

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input className="pl-10" placeholder="Buscar por nombre o folio…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {grupos.length === 0 ? (
        <EmptyState icon={<CreditCard size={24} strokeWidth={1.75} />} title="Sin créditos pendientes" hint="Cuando marques un folio como crédito, aparecerá aquí hasta que se liquide." />
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between border-b border-[var(--color-border)] pb-3 text-sm text-[var(--color-text-secondary)]">
            <span><strong className="text-[var(--color-text-primary)]">{grupos.length}</strong> cuenta{grupos.length === 1 ? "" : "s"} pendiente{grupos.length === 1 ? "" : "s"}</span>
            <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(totalPendiente)}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {grupos.map((g) => (
              <Card
                key={g.key}
                onClick={() => setGrupoAbierto(g)}
                className="flex cursor-pointer items-center gap-3.5 px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
              >
                <Avatar nombre={g.nombre} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-[var(--color-text-primary)]">{g.nombre}</span>
                    <Badge tone="warning" className="flex-shrink-0">Pendiente</Badge>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {g.tickets.length} folio{g.tickets.length > 1 ? "s" : ""} · {g.identificador ?? "—"}
                  </p>
                </div>
                <span className="tabular flex-shrink-0 text-base font-extrabold text-[var(--color-text-primary)]">{formatoMXN(g.total)}</span>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!grupoAbierto}
        onClose={() => { setGrupoAbierto(null); setErrorSaldar(null); }}
        title={grupoAbierto?.nombre}
        subtitle={grupoAbierto ? `${grupoAbierto.tickets.length} folio(s) pendientes` : undefined}
      >
        {grupoAbierto && (
          <div>
            <div className="mb-4 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {grupoAbierto.tickets.map((t) => (
                <div key={t.id} className="flex justify-between rounded-lg bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.04]">
                  <span className="text-[var(--color-text-secondary)]">{t.folio} · {t.categoria}</span>
                  <span className="tabular font-semibold">{formatoMXN(t.total)}</span>
                </div>
              ))}
            </div>
            <div className="mb-4 flex justify-between border-t border-[var(--color-border)] pt-3 text-base font-extrabold text-[var(--color-text-primary)]">
              <span>Total a saldar</span>
              <span className="tabular text-brand-600">{formatoMXN(grupoAbierto.total)}</span>
            </div>
            <Button
              variant="secondary"
              icon={<Send size={15} />}
              className="mb-4"
              fullWidth
              onClick={() => {
                setEnviarGrupo(grupoAbierto);
                setGrupoAbierto(null);
              }}
            >
              Enviar estado de cuenta
            </Button>
            {soloConsulta ? (
              <p className="rounded-xl border border-[var(--color-border)] bg-black/[0.02] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] dark:bg-white/[0.03]">
                Tienes acceso de solo consulta aquí — no puedes marcar créditos como pagados.
              </p>
            ) : (
              <>
                {errorSaldar && (
                  <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                    {errorSaldar}
                  </p>
                )}
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Marcar como pagado con:</p>
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" icon={<Banknote size={16} />} disabled={saldando} onClick={() => saldar(grupoAbierto, "Efectivo")}>Efectivo</Button>
                  <Button variant="secondary" icon={<CreditCard size={16} />} disabled={saldando} onClick={() => saldar(grupoAbierto, "Tarjeta de débito")}>Tarjeta de débito</Button>
                  <Button variant="secondary" icon={<CreditCard size={16} />} disabled={saldando} onClick={() => saldar(grupoAbierto, "Tarjeta de crédito")}>Tarjeta de crédito</Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {servicioActual && enviarGrupo && (
        <EnviarArchivoModal
          open={!!enviarGrupo}
          onClose={() => setEnviarGrupo(null)}
          titulo="Enviar estado de cuenta"
          subtitulo={`${enviarGrupo.nombre} · ${formatoMXN(enviarGrupo.total)} pendiente`}
          tipo="Estado de cuenta"
          servicioId={servicioActual.id}
          servicioNombre={servicioActual.nombre}
          nombreArchivo={`estado-cuenta-${enviarGrupo.nombre.toLowerCase().replace(/\s+/g, "-")}.csv`}
          contenido={csvDelGrupo}
        />
      )}
    </div>
  );
}
