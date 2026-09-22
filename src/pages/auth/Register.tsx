import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, Mail, Lock, User as UserIcon, KeyRound } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { SocialButtons } from "../../components/ui/SocialButtons";
import { useAuth } from "../../lib/auth/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  // Prellenada para esta etapa de revisión con datos demo — quien
  // registra la primera cuenta (el propio revisor) puede dejarla tal
  // cual o cambiarla antes de enviar el formulario. No es un valor
  // fijo del lado del servidor: sigue siendo un campo normal, editable,
  // y la cuenta real queda con lo que se envíe en este formulario.
  const [password, setPassword] = useState("Admin123");
  // Lo da quien invita (Configuración → Usuarios), por el canal que
  // elija — sin esto, cualquiera que supiera o adivinara un correo con
  // invitación pendiente podía registrarlo primero.
  const [token, setToken] = useState("");
  const [trampa, setTrampa] = useState(""); // honeypot — ver el campo oculto más abajo
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(nombre, correo, password, token, trampa);
      navigate("/app/servicios");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="mb-7 text-2xl font-extrabold text-[var(--color-text-primary)]">Crea tu cuenta</h2>

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
        {/* Honeypot anti-bot: invisible para una persona real (fuera de
            pantalla, sin tabulación, oculto a lectores de pantalla) —
            solo un bot que autocompleta todo lo llena. Si trae algo,
            el servidor rechaza la petición sin decir por qué. */}
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
        <Field label="Nombre completo" id="reg-nombre">
          <div className="relative">
            <UserIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input id="reg-nombre" className="pl-10" required placeholder="Ej. María López" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
        </Field>
        <Field label="Correo" id="reg-correo">
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input id="reg-correo" className="pl-10" type="email" required placeholder="tucorreo@empresa.com" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </div>
        </Field>
        <Field label="Contraseña" id="reg-password">
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input id="reg-password" className="pl-10" type="password" required minLength={8} placeholder="Mínimo 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </Field>
        <Field label="Código de invitación" id="reg-token" hint="Te lo da quien te invitó, aparte del correo.">
          <div className="relative">
            <KeyRound size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input id="reg-token" className="pl-10" required placeholder="El que te compartió tu administrador" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
        </Field>

        <Button type="submit" variant="dark" fullWidth size="lg" icon={<UserPlus size={17} />} disabled={loading}>
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        ¿Ya tienes cuenta?{" "}
        <Link to="/login" className="font-bold text-[var(--color-text-primary)] hover:underline">
          Inicia sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
