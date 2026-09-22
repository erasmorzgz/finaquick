import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, KeyRound } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import * as db from "../../lib/db";

export default function RestablecerPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmar) {
      setError("Las dos contraseñas no son iguales.");
      return;
    }
    setLoading(true);
    try {
      await db.restablecerPasswordConToken(token, password);
      setListo(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <h2 className="text-xl font-extrabold text-[var(--color-text-primary)]">Enlace incompleto</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Este enlace no trae la información necesaria — pide uno nuevo desde{" "}
          <Link to="/olvide-password" className="font-bold underline">
            ¿Olvidaste tu contraseña?
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)]">Nueva contraseña</h2>
      <p className="mt-1 mb-7 text-sm text-[var(--color-text-secondary)]">Escribe tu nueva contraseña, dos veces.</p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {listo ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3.5 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          Listo — tu contraseña se actualizó. Te llevamos a iniciar sesión…
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label="Nueva contraseña" id="reset-password">
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input
                id="reset-password"
                className="pl-10"
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Repite la contraseña" id="reset-password-confirmar">
            <div className="relative">
              <KeyRound size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input
                id="reset-password-confirmar"
                className="pl-10"
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
              />
            </div>
          </Field>
          <Button type="submit" variant="dark" fullWidth size="lg" disabled={loading}>
            {loading ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
