import { useEffect, useState } from "react";
import { Send, Check } from "lucide-react";
import { Modal } from "./Modal";
import { Field } from "./Input";
import { Button } from "./Button";
import { SearchSelect } from "./SearchSelect";
import { useAuth } from "../../lib/auth/AuthContext";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { UserProfile } from "../../lib/db/types";

const ROLE_LABEL: Record<string, string> = { admin: "Administrador", finanzas: "Finanzas", personal: "Personal" };

// Modal reutilizable para mandarle un reporte (CSV) a un compañero de la
// misma organización — la usan Cierre de caja, Historial y Créditos, cada
// uno solo arma su propio `contenido` y le pasa este componente el resto.
export function EnviarArchivoModal({
  open,
  onClose,
  titulo,
  subtitulo,
  tipo,
  servicioId,
  servicioNombre,
  nombreArchivo,
  contenido,
}: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  subtitulo?: string;
  tipo: string;
  servicioId?: string;
  servicioNombre?: string;
  nombreArchivo: string;
  contenido: string;
}) {
  const { user } = useAuth();
  const { org } = useOrg();
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [destinatarioQuery, setDestinatarioQuery] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !org) return;
    setEnviado(false);
    setError(null);
    setDestinatarioQuery("");
    setMensaje("");
    db.listarUsuarios().then((lista) =>
      setUsuarios(lista.filter((u) => u.id !== user?.id && (u.rol === "admin" || u.orgIds.includes(org.id))))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, org]);

  async function confirmarEnvio() {
    const destinatario = usuarios.find((u) => u.nombre === destinatarioQuery);
    if (!destinatario || !user || !org) return;
    setError(null);
    setEnviando(true);
    try {
      await db.enviarArchivo({
        orgId: org.id,
        deId: user.id,
        paraId: destinatario.id,
        servicioId,
        servicioNombre,
        tipo,
        nombreArchivo,
        contenido,
        mensaje: mensaje.trim() || undefined,
      });
      setEnviado(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      // Sin este catch, el botón se quedaba diciendo "Enviando…" para
      // siempre si algo fallaba — deshabilitado, sin ningún mensaje, y
      // sin forma de volver a intentar salvo cerrar y reabrir el modal.
      setError(err instanceof Error ? err.message : "No se pudo enviar el archivo — vuelve a intentar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={titulo} subtitle={subtitulo}>
      <Field label="Enviar a">
        <SearchSelect
          options={usuarios.map((u) => ({ id: u.id, label: u.nombre, meta: ROLE_LABEL[u.rol] }))}
          value={destinatarioQuery}
          onChange={setDestinatarioQuery}
          placeholder="Busca a un compañero…"
        />
        {usuarios.length === 0 && (
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">No hay más nadie en tu organización todavía.</p>
        )}
      </Field>
      <Field label="Mensaje (opcional)">
        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          rows={2}
          placeholder="Ej. Aquí está lo que pediste…"
          className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
        />
      </Field>
      {error && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
      <Button
        fullWidth
        icon={enviado ? <Check size={16} /> : <Send size={16} />}
        disabled={!usuarios.some((u) => u.nombre === destinatarioQuery) || enviando || enviado}
        onClick={confirmarEnvio}
      >
        {enviado ? "Enviado" : enviando ? "Enviando…" : "Enviar archivo"}
      </Button>
    </Modal>
  );
}
