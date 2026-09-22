import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import * as db from "../../lib/db";

export default function OlvidePassword() {
  const [correo, setCorreo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { mensaje: m } = await db.pedirRestablecerPassword(correo);
      setMensaje(m);
      setEnviado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)]">¿Olvidaste tu contraseña?</h2>
      <p className="mt-1 mb-7 text-sm text-[var(--color-text-secondary)]">
        Escribe tu correo y, si tu instalación tiene correo configurado, te mandamos un enlace para restablecerla.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {enviado ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3.5 text-sm text-[var(--color-text-secondary)]">
          {mensaje}
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label="Correo" id="olvide-correo">
            <div className="relative">
              <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input
                id="olvide-correo"
                className="pl-10"
                type="email"
                required
                placeholder="tucorreo@empresa.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
          </Field>
          <Button type="submit" variant="dark" fullWidth size="lg" disabled={loading}>
            {loading ? "Enviando…" : "Mandar enlace"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="inline-flex items-center gap-1 font-bold text-[var(--color-text-primary)] hover:underline">
          <ArrowLeft size={14} /> Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
