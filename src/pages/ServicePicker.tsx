import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Building2, ChevronDown, Sparkles, Settings, Lock } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "../lib/auth/AuthContext";
import { FullscreenSpinner } from "../lib/auth/Guards";
import { useService } from "../lib/service/ServiceContext";
import { useOrg } from "../lib/theme/OrgContext";
import { Avatar, Badge, EmptyState } from "../components/ui/Misc";
import { Button } from "../components/ui/Button";
import { ServiceIcon } from "../components/ui/ServiceIcon";
import { OrgSwitcherList } from "../components/layout/OrgSwitcherList";

export default function ServicePicker() {
  const { user, logout } = useAuth();
  const { servicios, elegirServicio, cargando } = useService();
  const { org, orgs } = useOrg();
  const [openOrgs, setOpenOrgs] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const yaRedirigido = useRef(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenOrgs(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const visibles = useMemo(
    () => (user ? servicios.filter((s) => s.activo && (user.rol === "admin" || user.servicioIds.includes(s.id))) : []),
    [servicios, user]
  );

  // Con un solo servicio asignado no tiene caso "elegir" — entra directo,
  // como si el menú no existiera. Aplica sin importar cómo se llegó aquí
  // (login recién hecho, o el botón de inicio del sidebar).
  useEffect(() => {
    if (!cargando && !yaRedirigido.current && visibles.length === 1) {
      yaRedirigido.current = true;
      elegirServicio(visibles[0].id);
    }
  }, [cargando, visibles, elegirServicio]);

  if (!user) return null;
  // Mientras se decide si hay que saltarse el menú (o durante la carga),
  // no se muestra nada de la pantalla completa — así nadie ve parpadear
  // "¿Con cuál vas a trabajar?" un instante antes de salir derecho a su
  // único servicio.
  if (cargando || visibles.length === 1) return <FullscreenSpinner />;

  const puedeCambiarOrg = orgs.length > 1;

  return (
    <div className="ambient-glow min-h-screen w-screen bg-[var(--color-page)]">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="relative" ref={ref}>
          <button
            onClick={() => puedeCambiarOrg && setOpenOrgs((o) => !o)}
            className={clsx(
              "glass flex items-center gap-3 rounded-2xl py-1.5 pl-1.5 pr-3 text-left transition-transform duration-150 ease-out-emil",
              puedeCambiarOrg && "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-[var(--color-text-secondary)] dark:bg-white/5">
              <Building2 size={18} strokeWidth={1.75} />
            </span>
            <div className="leading-tight">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Perteneces a</p>
              <p className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "tu organización"}</p>
            </div>
            {puedeCambiarOrg && <ChevronDown size={14} className="ml-1 flex-shrink-0 text-[var(--color-text-muted)]" />}
          </button>

          {openOrgs && puedeCambiarOrg && (
            <div className="glass animate-pop-in absolute left-0 top-[calc(100%+8px)] z-40 w-72 overflow-hidden rounded-2xl py-2">
              <OrgSwitcherList onClose={() => setOpenOrgs(false)} />
            </div>
          )}
        </div>

        <div className="glass flex items-center gap-3 rounded-full py-1.5 pl-2 pr-3">
          <Avatar nombre={user.nombre} fotoUrl={user.fotoUrl} size={30} />
          <div className="hidden sm:block">
            <p className="text-sm font-bold leading-tight text-[var(--color-text-primary)]">{user.nombre}</p>
            <Badge tone="brand">{user.rol === "admin" ? "Administrador" : user.rol === "finanzas" ? "Finanzas" : "Personal"}</Badge>
          </div>
          <button onClick={logout} title="Cerrar sesión" className="ml-1 rounded-full p-1.5 text-[var(--color-text-muted)] hover:bg-black/5 dark:hover:bg-white/10">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-20 pt-8 text-center md:pt-14">
        <h1 className="text-3xl font-extrabold text-[var(--color-text-primary)] md:text-4xl">¿Con cuál vas a trabajar?</h1>
        <p className="mx-auto mt-3 max-w-lg text-[var(--color-text-secondary)]">
          {user.rol === "admin"
            ? "Como administrador ves todos los servicios activos de tu organización."
            : "Estos son los servicios que tienes asignados. Si falta alguno, pídele a un administrador que te lo asigne."}
        </p>

        {visibles.length > 0 ? (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((s, i) => (
              <button
                key={s.id}
                onClick={() => elegirServicio(s.id)}
                style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
                className="glass animate-pop-in group relative flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-9 text-center transition-all duration-150 ease-out-emil [animation-fill-mode:backwards] hover:-translate-y-1"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.04] text-[var(--color-text-secondary)] transition-colors duration-150 ease-out-emil group-hover:bg-[var(--color-text-primary)] group-hover:text-[var(--color-page)] dark:bg-white/5">
                  <ServiceIcon name={s.icono} size={26} />
                </span>
                <span className="text-base font-bold text-[var(--color-text-primary)]">{s.nombre}</span>
                <span className="text-xs font-semibold text-brand-600">Entrar al panel →</span>
              </button>
            ))}
          </div>
        ) : user.rol === "admin" ? (
          // Si un admin ve cero servicios, es que la organización entera
          // no tiene ninguno todavía (un admin ve todos automáticamente) —
          // eso es una organización recién creada, no un error.
          <div className="mt-10">
            <div className="mx-auto max-w-sm">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <Sparkles size={24} />
              </span>
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                ¡Bienvenido a {org?.nombre ?? "tu organización"}!
              </h2>
              <p className="mt-1.5 mb-5 text-sm text-[var(--color-text-secondary)]">
                Todavía no tiene ningún servicio. Agrega el primero desde Configuración para empezar a generar folios.
              </p>
              <Link to="/app/admin">
                <Button icon={<Settings size={16} />}>Ir a Configuración</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-10">
            <EmptyState
              icon={<Lock size={24} strokeWidth={1.75} />}
              title="Todavía no tienes servicios asignados"
              hint={
                puedeCambiarOrg
                  ? `Aquí en ${org?.nombre ?? "esta organización"} no tienes ninguno — puede que tus servicios estén en otra. Usa "Perteneces a" arriba para cambiar de organización, o pídele a un administrador que te asigne uno aquí.`
                  : "Un administrador debe asignarte al menos uno desde Configuración → Usuarios."
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
