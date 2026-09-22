import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, Mail, Lock, ShieldCheck } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { SocialButtons } from "../../components/ui/SocialButtons";
import { useAuth } from "../../lib/auth/AuthContext";

export default function Login() {
  const { login, completarLogin2FA } = useAuth();
  const navigate = useNavigate();
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [trampa, setTrampa] = useState(""); // honeypot — ver el campo oculto más abajo
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Segundo paso, solo si la cuenta tiene 2FA activo — la contraseña ya
  // se verificó correcta en ese momento (o, si se llegó aquí desde
  // MicrosoftCompletado.tsx, ya se validó la cuenta de Microsoft), falta
  // el código. Iniciarlo desde la URL cubre ese segundo caso: el
  // servidor manda de vuelta un tokenPre en vez de la cookie de sesión
  // cuando la cuenta tiene 2FA local activo, para que el SSO de
  // Microsoft no pueda saltárselo — viaja en el fragmento (#), nunca en
  // un parámetro de consulta normal, para que no quede en ningún log
  // de acceso o de proxy.
  const [tokenPre, setTokenPre] = useState<string | null>(
    () => new URLSearchParams(window.location.hash.slice(1)).get("tokenPre")
  );
  const [codigo, setCodigo] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resultado = await login(correo, password, trampa);
      if (resultado && "requiere2FA" in resultado) {
        setTokenPre(resultado.tokenPre);
        return;
      }
      navigate("/app/servicios");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitCodigo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await completarLogin2FA(tokenPre!, codigo);
      navigate("/app/servicios");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenPre) {
    return (
      <AuthLayout>
        <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)]">Verificación en dos pasos</h2>
        <p className="mt-1 mb-7 text-sm text-[var(--color-text-secondary)]">
          Abre tu app autenticadora y escribe el código de 6 dígitos que muestra.
        </p>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={onSubmitCodigo}>
          <Field label="Código de verificación" id="login-codigo-2fa">
            <div className="relative">
              <ShieldCheck size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <Input
                id="login-codigo-2fa"
                className="pl-10 tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                placeholder="000000"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
              />
            </div>
          </Field>
          <Button type="submit" variant="dark" fullWidth size="lg" icon={<ShieldCheck size={17} />} disabled={loading || codigo.length !== 6}>
            {loading ? "Verificando…" : "Verificar"}
          </Button>
        </form>

        <button
          onClick={() => { setTokenPre(null); setCodigo(""); setError(null); }}
          className="mt-6 w-full text-center text-sm font-semibold text-[var(--color-text-secondary)] hover:underline"
        >
          Volver a intentar con otra cuenta
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)]">Inicia sesión</h2>
      <p className="mt-1 mb-7 text-sm text-[var(--color-text-secondary)]">
        Usa tu correo institucional para continuar.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      <SocialButtons />
      <div className="mb-5 flex items-center gap-3 text-xs font-semibold text-[var(--color-text-muted)]">
        <span className="h-px flex-1 bg-[var(--color-border)]" /> O CON TU CORREO <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      <form onSubmit={onSubmit}>
        {/* Honeypot anti-bot — ver el mismo campo en Register.tsx. */}
        <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
          <label htmlFor="sitio_web">Sitio web</label>
          <input
            id="sitio_web"
            name="sitio_web"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trampa}
            onChange={(e) => setTrampa(e.target.value)}
          />
        </div>
        <Field label="Correo institucional" id="login-correo">
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              id="login-correo"
              className="pl-10"
              type="email"
              required
              placeholder="tucorreo@empresa.com"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </div>
        </Field>
        <Field
          label="Contraseña"
          id="login-password"
          labelRight={
            <Link to="/olvide-password" className="text-xs font-semibold text-[var(--color-text-secondary)] hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          }
        >
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              id="login-password"
              className="pl-10"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </Field>

        <Button type="submit" variant="dark" fullWidth size="lg" icon={<LogIn size={17} />} disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        ¿No tienes cuenta?{" "}
        <Link to="/registro" className="font-bold text-[var(--color-text-primary)] hover:underline">
          Regístrate
        </Link>
      </p>
    </AuthLayout>
  );
}
