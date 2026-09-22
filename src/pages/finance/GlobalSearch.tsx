import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Avatar, Badge, EmptyState } from "../../components/ui/Misc";
import { Modal } from "../../components/ui/Modal";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { Ticket } from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";

type Resultado = Ticket & { servicioNombre: string };

// A diferencia de Historial (un solo servicio), esto busca en todos los
// servicios de la organización — para cuando finanzas/admin necesita
// encontrar un folio sin saber de antemano dónde quedó.
export default function GlobalSearch() {
  const { org } = useOrg();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [seleccionado, setSeleccionado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!org || !q.trim()) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const id = setTimeout(() => {
      db.buscarFolioGlobal(org.id, q).then((r) => {
        setResultados(r);
        setBuscando(false);
      });
    }, 200);
    return () => clearTimeout(id);
  }, [org, q]);

  const total = useMemo(() => resultados.reduce((s, t) => s + t.total, 0), [resultados]);

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input
          className="pl-10"
          placeholder="Busca por folio, nombre o ID en cualquier servicio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {!q.trim() ? (
        <EmptyState icon={<Search size={24} strokeWidth={1.75} />} title="Busca un folio" hint="Escribe un nombre, un ID o un número de folio — se busca en todos los servicios de tu organización a la vez." />
      ) : buscando ? null : resultados.length === 0 ? (
        <EmptyState title="Sin resultados" hint={`No encontramos nada para "${q}".`} />
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between border-b border-[var(--color-border)] pb-3 text-sm text-[var(--color-text-secondary)]">
            <span><strong className="text-[var(--color-text-primary)]">{resultados.length}</strong> resultado{resultados.length === 1 ? "" : "s"}</span>
            <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(total)}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {resultados.map((t) => (
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
                    <span className="font-semibold text-[var(--color-text-secondary)]">{t.servicioNombre}</span> · {t.categoria} ·{" "}
                    {new Date(t.fecha).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })} · <span className="font-mono">{t.folio}</span>
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
        subtitle={seleccionado?.servicioNombre}
      >
        {seleccionado && (
          <div className="space-y-2 text-sm">
            <Row label="Categoría" value={seleccionado.categoria} />
            <Row label="Tipo de usuario" value={seleccionado.tipoUsuario} />
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
