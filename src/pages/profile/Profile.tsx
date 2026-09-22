import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, Eraser, PenLine, Save, ShieldCheck, KeyRound, Eye, Smartphone, X } from "lucide-react";
import { Card, CardBody, SectionLabel } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Avatar, Badge } from "../../components/ui/Misc";
import { ServiceIcon } from "../../components/ui/ServiceIcon";
import { useAuth } from "../../lib/auth/AuthContext";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { ServiceConfig } from "../../lib/db/types";
import { URL_BASE } from "../../lib/db/localApiAdapter";

const ROLE_LABEL: Record<string, string> = { admin: "Administrador", finanzas: "Finanzas", personal: "Personal" };

// La autenticación de dos factores solo existe en el servidor propio
// por ahora.
const enModoLocal = import.meta.env.VITE_BACKEND_MODE === "local";

export default function Profile() {
  const { user, refresh } = useAuth();
  const { org } = useOrg();
  const [nombre, setNombre] = useState(user?.nombre ?? "");
  const [telefono, setTelefono] = useState(user?.telefono ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [fotoUrl, setFotoUrl] = useState(user?.fotoUrl);
  const [firmaUrl, setFirmaUrl] = useState(user?.firmaUrl);
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [passActual, setPassActual] = useState("");
  const [passNueva, setPassNueva] = useState("");
  const [passError, setPassError] = useState<string | null>(null);
  const [passOk, setPassOk] = useState(false);

  useEffect(() => {
    if (org) db.listarServicios(org.id).then(setServicios);
  }, [org]);

  if (!user) return null;

  function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFotoUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function guardar() {
    if (!user) return;
    setErrorGuardar(null);
    setGuardando(true);
    try {
      await db.actualizarPerfil(user.id, { nombre, telefono, bio, fotoUrl, firmaUrl });
      await refresh();
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } catch (err) {
      // Caso real, no solo teórico: una foto tomada con el celular
      // fácilmente pesa varios MB, y el servidor la rechaza pasado
      // cierto tamaño (ver validarImagenDataUrl en rutas.ts) — sin
      // este catch, tocar "Guardar" ahí no hacía nada visible, sin
      // ninguna pista de por qué.
      setErrorGuardar(err instanceof Error ? err.message : "No se pudo guardar — vuelve a intentar.");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarPass(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setPassError(null);
    try {
      await db.cambiarPassword(user.correo, passActual, passNueva);
      setPassActual("");
      setPassNueva("");
      setPassOk(true);
      setTimeout(() => setPassOk(false), 2500);
    } catch (err) {
      setPassError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card glass>
        <CardBody className="pt-6">
          <div className="mb-6 flex items-center gap-5">
            <div className="relative">
              <Avatar nombre={nombre || user.nombre} fotoUrl={fotoUrl} size={76} />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white shadow-md ring-2 ring-[var(--color-surface)]"
                title="Cambiar foto"
              >
                <Camera size={13} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFoto} />
            </div>
            <div>
              <p className="text-lg font-extrabold text-[var(--color-text-primary)]">{user.nombre}</p>
              <p className="text-sm text-[var(--color-text-muted)]">{user.correo}</p>
              <Badge tone="brand" className="mt-1.5">{ROLE_LABEL[user.rol]}</Badge>
            </div>
          </div>

          <SectionLabel>Datos personales</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre completo">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field label="Teléfono">
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="(228) 000 0000" />
            </Field>
          </div>
          <Field label="Correo institucional" hint="El correo no se puede modificar aquí.">
            <Input value={user.correo} disabled className="opacity-60" />
          </Field>
          <Field label="Sobre ti (opcional)">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Ej. Coordinadora de clínica, turno matutino…"
              className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm outline-none"
            />
          </Field>

          <SectionLabel className="mt-2">Firma</SectionLabel>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            Dibújala una sola vez aquí — después, al aprobar o rechazar una requisición, un solo botón la
            estampa sin que tengas que volver a dibujarla.
          </p>
          <FirmaCanvas value={firmaUrl} onChange={setFirmaUrl} />

          <SectionLabel className="mt-6">Servicios asignados</SectionLabel>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            {user.rol === "admin"
              ? "Como administrador ves todos los servicios automáticamente."
              : "Un administrador decide a cuáles tienes acceso, desde Configuración → Usuarios."}
          </p>
          <div className="mb-6 flex flex-wrap gap-2">
            {user.rol === "admin"
              ? servicios.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3.5 py-2 text-sm font-semibold text-[var(--color-text-secondary)]">
                    <ServiceIcon name={s.icono} size={15} /> {s.nombre}
                  </span>
                ))
              : servicios
                  .filter((s) => user.servicioIds.includes(s.id))
                  .map((s) => {
                    const soloConsulta = !!user.serviciosSoloConsulta?.includes(s.id);
                    return (
                      <span key={s.id} className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                        <Check size={14} /> <ServiceIcon name={s.icono} size={15} /> {s.nombre}
                        {soloConsulta && (
                          <span className="flex items-center gap-1 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10.5px] font-bold text-[var(--color-text-secondary)] dark:bg-white/10">
                            <Eye size={10} /> Solo consulta
                          </span>
                        )}
                      </span>
                    );
                  })}
            {user.rol !== "admin" && user.servicioIds.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">Todavía no tienes ningún servicio asignado.</p>
            )}
          </div>

          {errorGuardar && (
            <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {errorGuardar}
            </p>
          )}
          <Button icon={guardado ? <Check size={16} /> : <Save size={16} />} disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando…" : guardado ? "Guardado" : "Guardar cambios"}
          </Button>
        </CardBody>
      </Card>

      <Card glass className="mt-6">
        <CardBody className="pt-6">
          <div className="mb-1 flex items-center gap-2">
            <ShieldCheck size={17} className="text-[var(--color-text-secondary)]" />
            <SectionLabel className="mb-0">Seguridad de la cuenta</SectionLabel>
          </div>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">Cambia tu contraseña de acceso.</p>

          {passError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {passError}
            </div>
          )}

          <form onSubmit={cambiarPass}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contraseña actual">
                <Input type="password" required value={passActual} onChange={(e) => setPassActual(e.target.value)} placeholder="••••••••" />
              </Field>
              <Field label="Nueva contraseña">
                <Input type="password" required minLength={8} value={passNueva} onChange={(e) => setPassNueva(e.target.value)} placeholder="Mínimo 8 caracteres" />
              </Field>
            </div>
            <Button type="submit" variant="secondary" icon={passOk ? <Check size={16} /> : <KeyRound size={16} />}>
              {passOk ? "Contraseña actualizada" : "Actualizar contraseña"}
            </Button>
          </form>
        </CardBody>
      </Card>

      {enModoLocal && <Tarjeta2FA />}
    </div>
  );
}

// ---------------- Verificación en dos pasos (2FA) ----------------
function Tarjeta2FA() {
  const { user, refresh } = useAuth();
  const [pidiendoPassword, setPidiendoPassword] = useState(false);
  const [passwordIniciar, setPasswordIniciar] = useState("");
  const [configurando, setConfigurando] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secretoManual, setSecretoManual] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [desactivando, setDesactivando] = useState(false);
  const [passwordDesactivar, setPasswordDesactivar] = useState("");

  // Cuenta sin contraseña propia (se creó por Microsoft) que acaba de
  // volver de reautenticarse ahí — ver MicrosoftCompletado.tsx y
  // microsoft.ts (?intent=2fa). El token viaja en el fragmento (#), no
  // en la URL normal, así que solo se lee aquí, del lado del cliente;
  // se limpia de la URL de inmediato para que un refresh no lo
  // reenvíe. No hace falta que la persona haga nada más — la
  // reautenticación con Microsoft YA demostró quién es, así que esto
  // continúa solo, igual que si hubiera escrito su contraseña.
  useEffect(() => {
    const reauthToken = new URLSearchParams(window.location.hash.slice(1)).get("reauth2fa");
    if (!reauthToken) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setError(null);
    setCargando(true);
    db.iniciarConfiguracion2FA({ reauthToken })
      .then(({ qr: qrNuevo, secretoManual: secretoNuevo }) => {
        setQr(qrNuevo);
        setSecretoManual(secretoNuevo);
        setConfigurando(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo iniciar la configuración."))
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return null;

  // Pide la contraseña actual antes de generar un secreto nuevo — ni
  // siquiera para la primera activación: con una sesión abierta pero
  // sin la contraseña, no debería bastar para tocar el segundo factor
  // de la cuenta en ningún sentido.
  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { qr: qrNuevo, secretoManual: secretoNuevo } = await db.iniciarConfiguracion2FA({ password: passwordIniciar });
      setQr(qrNuevo);
      setSecretoManual(secretoNuevo);
      setConfigurando(true);
      setPidiendoPassword(false);
      setPasswordIniciar("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la configuración.");
    } finally {
      setCargando(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await db.confirmar2FA(codigo);
      setConfigurando(false);
      setQr(null);
      setCodigo("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo activar.");
    } finally {
      setCargando(false);
    }
  }

  async function desactivar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await db.desactivar2FA(passwordDesactivar);
      setDesactivando(false);
      setPasswordDesactivar("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo desactivar.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card glass className="mt-6">
      <CardBody className="pt-6">
        <div className="mb-1 flex items-center gap-2">
          <Smartphone size={17} className="text-[var(--color-text-secondary)]" />
          <SectionLabel className="mb-0">Verificación en dos pasos</SectionLabel>
        </div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Además de tu contraseña, pide un código de tu teléfono al iniciar sesión — con cualquier app
          autenticadora (Google Authenticator, Authy, Microsoft Authenticator…), sin depender de ningún
          servicio externo: el código se genera y se verifica todo dentro de este sistema.
        </p>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        {user.totpHabilitado ? (
          desactivando ? (
            <form onSubmit={desactivar} className="flex flex-col gap-3">
              <Field label="Confirma tu contraseña para desactivarla">
                <Input type="password" required value={passwordDesactivar} onChange={(e) => setPasswordDesactivar(e.target.value)} placeholder="••••••••" autoFocus />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" disabled={cargando}>{cargando ? "Desactivando…" : "Desactivar"}</Button>
                <Button type="button" variant="ghost" onClick={() => { setDesactivando(false); setPasswordDesactivar(""); setError(null); }}>Cancelar</Button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <Badge tone="brand"><Check size={12} className="mr-1 inline" /> Activada</Badge>
              <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setDesactivando(true)}>Desactivar</Button>
            </div>
          )
        ) : configurando ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qr && <img src={qr} alt="Código QR para configurar la verificación en dos pasos" className="h-40 w-40 flex-shrink-0 rounded-xl border border-[var(--color-border)]" />}
            <div className="flex-1">
              <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
                Escanea el código con tu app autenticadora, o escribe esta clave a mano:
              </p>
              <code className="mb-3 block break-all rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-xs font-bold text-[var(--color-text-primary)] dark:bg-white/10">{secretoManual}</code>
              <form onSubmit={confirmar} className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Field label="Código de 6 dígitos">
                    <Input
                      inputMode="numeric"
                      required
                      maxLength={6}
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="tracking-[0.3em]"
                    />
                  </Field>
                </div>
                <Button type="submit" disabled={cargando || codigo.length !== 6}>{cargando ? "Verificando…" : "Activar"}</Button>
                <Button type="button" variant="ghost" onClick={() => { setConfigurando(false); setQr(null); setCodigo(""); setError(null); }}>Cancelar</Button>
              </form>
            </div>
          </div>
        ) : pidiendoPassword ? (
          <form onSubmit={iniciar} className="flex flex-col gap-3">
            <Field label="Confirma tu contraseña para continuar">
              <Input type="password" required value={passwordIniciar} onChange={(e) => setPasswordIniciar(e.target.value)} placeholder="••••••••" autoFocus />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={cargando}>{cargando ? "Preparando…" : "Continuar"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setPidiendoPassword(false); setPasswordIniciar(""); setError(null); }}>Cancelar</Button>
            </div>
          </form>
        ) : user.soloMicrosoft ? (
          // Esta cuenta se creó por Microsoft y nunca tuvo una
          // contraseña propia que pedirle — en su lugar, se reautentica
          // ahí mismo (navegación completa de verdad, no una llamada de
          // la API — es un flujo OAuth, con prompt=login para exigir
          // credenciales nuevas, no una sesión de Microsoft ya abierta)
          // y vuelve derecho aquí con un token de un solo propósito —
          // vencido a los 5 minutos y firmado para esta cuenta
          // específica, pero no consumido de un solo uso: dentro de esa
          // ventana, reenviarlo solo repite el mismo efecto (dejar un
          // secreto pendiente, todavía sin activar hasta confirmarlo
          // con un código real) — que retoma la configuración sola.
          <Button
            variant="secondary"
            icon={<ShieldCheck size={16} />}
            disabled={cargando}
            onClick={() => { window.location.href = `${URL_BASE}/auth/microsoft/iniciar?intent=2fa`; }}
          >
            {cargando ? "Preparando…" : "Reautenticar con Microsoft para continuar"}
          </Button>
        ) : (
          <Button variant="secondary" icon={<ShieldCheck size={16} />} onClick={() => setPidiendoPassword(true)} disabled={cargando}>
            Activar verificación en dos pasos
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------- Firma dibujada a mano ----------------
// Fondo transparente a propósito (nunca se pinta un blanco de fondo):
// solo el trazo en sí queda en el PNG exportado, para que se vea bien
// estampada sobre cualquier documento, no como una caja blanca encima
// de otro contenido. El recuadro blanco que se ve mientras se dibuja
// es solo la superficie visible del canvas, no parte de la imagen
// guardada.
function FirmaCanvas({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  // Estado, no ref — el aviso "Dibuja tu firma aquí" tiene que
  // desaparecer en cuanto empieza el trazo, no hasta soltar el mouse
  // (que es cuando recién se avisa hacia afuera con onChange).
  const [vacio, setVacio] = useState(!value);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !value) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = value;
    // Solo al montar — si "value" cambiara por el propio dibujo de acá
    // abajo, redibujar la imagen encimaría trazos viejos sobre nuevos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function posicion(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function iniciar(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = posicion(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function mover(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = posicion(e);
    ctx.lineWidth = 2.25;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#18181b";
    ctx.lineTo(x, y);
    ctx.stroke();
    if (vacio) setVacio(false); // una sola vez por trazo, no en cada evento de movimiento
  }

  function terminar() {
    if (!dibujando.current) return;
    dibujando.current = false;
    onChange(vacio ? undefined : canvasRef.current!.toDataURL("image/png"));
  }

  function limpiar() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setVacio(true);
    onChange(undefined);
  }

  return (
    <div className="mb-6">
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-[var(--color-border)] bg-white">
        <canvas
          ref={canvasRef}
          width={480}
          height={160}
          className="block w-full touch-none"
          style={{ aspectRatio: "3 / 1" }}
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
        />
        {!value && vacio && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-black/30">
            <PenLine size={16} /> Dibuja tu firma aquí
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" icon={<Eraser size={14} />} onClick={limpiar} className="mt-2">
        Borrar
      </Button>
    </div>
  );
}
