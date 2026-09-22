import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../lib/auth/AuthContext";
import * as db from "../../lib/db";

// Pantalla obligatoria cuando un administrador acaba de generarle a
// esta cuenta una contraseña temporal (ver RequireAuth en Guards.tsx,
// que la muestra en vez de cualquier otra ruta protegida). El servidor
// ya bloquea todo lo demás mientras user.debeCambiarPassword sea true
// — esta pantalla no es más que la forma de resolver esa condición.
export default function ChangePasswordRequired() {
  const { refresh, logout } = useAuth();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await db.cambiarPassword("", actual, nueva);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)]">Cambia tu contraseña</h2>
      <p className="mt-1 mb-7 text-sm text-[var(--color-text-secondary)]">
        Un administrador te generó una contraseña temporal. Antes de continuar, elige una nueva que solo tú conozcas.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Field label="Contraseña temporal">
          <Input
            type="password"
            required
            autoFocus
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="La que te dio tu administrador"
          />
        </Field>
        <Field label="Nueva contraseña">
          <Input
            type="password"
            required
            minLength={8}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Mínimo 8 caracteres"
          />
        </Field>
        <Button type="submit" variant="dark" fullWidth size="lg" icon={<KeyRound size={17} />} disabled={loading}>
          {loading ? "Cambiando…" : "Cambiar contraseña y continuar"}
        </Button>
      </form>

      <button
        onClick={logout}
        className="mt-6 flex w-full items-center justify-center gap-1.5 text-center text-sm font-semibold text-[var(--color-text-secondary)] hover:underline"
      >
        <LogOut size={14} /> Cerrar sesión
      </button>
    </AuthLayout>
  );
}
