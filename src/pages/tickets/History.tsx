import { useEffect, useMemo, useState } from "react";
import { Search, Send } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Avatar, Badge } from "../../components/ui/Misc";
import { EmptyState } from "../../components/ui/Misc";
import { Modal } from "../../components/ui/Modal";
import { EnviarArchivoModal } from "../../components/ui/EnviarArchivoModal";
import { useService } from "../../lib/service/ServiceContext";
import * as db from "../../lib/db";
import type { Ticket } from "../../lib/db/types";
import { formatoMXN, generarCSV } from "../../lib/utils";

export default function History() {
  const { servicioActual } = useService();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [q, setQ] = useState("");
  const [seleccionado, setSeleccionado] = useState<Ticket | null>(null);
  const [enviarTicket, setEnviarTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    if (!servicioActual) return;
    db.listarTickets(servicioActual.id).then(setTickets);
  }, [servicioActual]);

  const filtrados = useMemo(
    () =>
      tickets.filter(
        (t) =>
          !q ||
          t.nombre.toLowerCase().includes(q.toLowerCase()) ||
          t.folio.toLowerCase().includes(q.toLowerCase()) ||
          (t.identificador ?? "").toLowerCase().includes(q.toLowerCase())
      ),
    [tickets, q]
  );
  const total = filtrados.reduce((s, t) => s + t.total, 0);

  const csvDelSeleccionado = useMemo(() => {
    if (!enviarTicket) return "";
    const filas: (string | number)[][] = [
      ["Folio", enviarTicket.folio],
      [servicioActual?.campoPersonaLabel ?? "Nombre", enviarTicket.nombre],
      [servicioActual?.campoCategoriaLabel ?? "Categoría", enviarTicket.categoria],
      ["Fecha", new Date(enviarTicket.fecha).toLocaleString("es-MX")],
      [],
      ["Procedimiento", "Costo"],
      ...enviarTicket.procedimientos.map((p) => [p.nombre, p.costo]),
      [],
      ["Total", enviarTicket.total],
      ["Forma de pago", enviarTicket.estado === "credito" ? "Pendiente (crédito)" : enviarTicket.formaPago ?? "—"],
    ];
    return generarCSV(["Campo", "Valor"], filas);
  }, [enviarTicket, servicioActual]);

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input className="pl-10" placeholder="Buscar por nombre, ID o folio…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {filtrados.length === 0 ? (
        <EmptyState title="Sin registros" hint={q ? "No hay resultados para esa búsqueda." : "Todavía no hay folios en este servicio."} />
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between border-b border-[var(--color-border)] pb-3 text-sm text-[var(--color-text-secondary)]">
            <span><strong className="text-[var(--color-text-primary)]">{filtrados.length}</strong> folio{filtrados.length === 1 ? "" : "s"}</span>
            <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(total)}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {filtrados.map((t) => (
              <Card
                key={t.id}
                onClick={() => setSeleccionado(t)}
                className="flex cursor-pointer items-center gap-3.5 px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
              >
                <Avatar nombre={t.nombre} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-[var(--color-text-primary)]">{t.nombre}</span>
                    <Badge tone={t.estado === "credito" ? "warning" : "good"} className="flex-shrink-0">
                      {t.estado === "credito" ? "Crédito" : "Pagado"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {t.categoria} · {new Date(t.fecha).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · <span className="font-mono">{t.folio}</span>
                  </p>
                </div>
                <span className="tabular flex-shrink-0 text-base font-extrabold text-[var(--color-text-primary)]">{formatoMXN(t.total)}</span>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!seleccionado}
        onClose={() => setSeleccionado(null)}
        title={seleccionado ? `${seleccionado.folio} — ${seleccionado.nombre}` : undefined}
        footer={
          seleccionado && (
            <Button
              variant="secondary"
              icon={<Send size={15} />}
              onClick={() => {
                setEnviarTicket(seleccionado);
                setSeleccionado(null);
              }}
            >
              Enviar folio
            </Button>
          )
        }
      >
        {seleccionado && (
          <div className="space-y-2 text-sm">
            <Row label={servicioActual?.campoPersonaLabel ?? "Nombre"} value={seleccionado.nombre} />
            {seleccionado.identificador && <Row label={servicioActual?.campoIdLabel ?? "ID"} value={seleccionado.identificador} />}
            <Row label="Tipo de usuario" value={seleccionado.tipoUsuario} />
            <Row label={servicioActual?.campoCategoriaLabel ?? "Categoría"} value={seleccionado.categoria} />
            <Row label="Fecha" value={new Date(seleccionado.fecha).toLocaleString("es-MX")} />
            <div className="!mt-4 border-t border-[var(--color-border)] pt-3">
              {seleccionado.procedimientos.map((p, i) => (
                <div key={i} className="flex justify-between py-0.5 text-[var(--color-text-secondary)]">
                  <span>{p.nombre}</span>
                  <span className="tabular">{formatoMXN(p.costo)}</span>
                </div>
              ))}
              <div className="mt-1.5 flex justify-between border-t border-[var(--color-border)] pt-1.5 font-bold text-[var(--color-text-primary)]">
                <span>Total</span>
                <span className="tabular">{formatoMXN(seleccionado.total)}</span>
              </div>
            </div>
            <Row label="Forma de pago" value={seleccionado.estado === "credito" ? "Pendiente (crédito)" : seleccionado.formaPago ?? "—"} />
          </div>
        )}
      </Modal>

      {servicioActual && enviarTicket && (
        <EnviarArchivoModal
          open={!!enviarTicket}
          onClose={() => setEnviarTicket(null)}
          titulo="Enviar folio"
          subtitulo={`${enviarTicket.folio} · ${enviarTicket.nombre} · ${formatoMXN(enviarTicket.total)}`}
          tipo="Folio"
          servicioId={servicioActual.id}
          servicioNombre={servicioActual.nombre}
          nombreArchivo={`folio-${enviarTicket.folio}.csv`}
          contenido={csvDelSeleccionado}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-right font-semibold text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}
