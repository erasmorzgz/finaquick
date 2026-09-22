import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut, UserRound, ShieldCheck, Settings, CircleHelp, Sparkles } from "lucide-react";
import { useAuth } from "../../lib/auth/AuthContext";
import { useService } from "../../lib/service/ServiceContext";
import { useOrg } from "../../lib/theme/OrgContext";
import { Avatar, Badge } from "../ui/Misc";
import { ServiceIcon } from "../ui/ServiceIcon";
import { RoleSwitch } from "./RoleSwitch";
import { OrgSwitcherList } from "./OrgSwitcherList";
import { NotificationsBell } from "./NotificationsBell";
import { SmartSearchModal } from "./SmartSearchModal";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  finanzas: "Finanzas",
  personal: "Personal",
};

export function Topbar({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  const { user, logout, viewAsPersonal } = useAuth();
  const { servicioActual } = useService();
  const { orgs } = useOrg();
  const [open, setOpen] = useState(false);
  const [buscarAbierto, setBuscarAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;
  const rolMostrado = viewAsPersonal ? "personal" : user.rol;

  return (
    <header className="glass sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-none border-x-0 border-t-0 px-6 py-4 print:hidden">
      {/* min-w-[9rem], no min-w-0: min-w-0 es precisamente lo que
          causaba el bug — le quita al título cualquier ancho mínimo, así
          que el navegador nunca tiene motivo para mandar los controles
          (interruptor Usuario/Admin de ancho fijo + campana + avatar,
          que solos ya casi llenan los 375px de un celular) a una segunda
          línea: simplemente sigue achicando el título hasta casi
          desaparecer, porque "encogerlo" técnicamente sí lo hace caber
          en una sola fila. Con un mínimo real, cuando de plano no cabe
          todo, flex-wrap (en el header) manda los controles abajo en vez
          de aplastar el título — visto y corregido en vivo, en un
          celular real de 375px. */}
      <div className="min-w-[9rem] flex-1">
        <h1 className="truncate text-lg font-extrabold text-[var(--color-text-primary)]">{title}</h1>
        {subtitle && <p className="flex items-center gap-1.5 truncate text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
        {!subtitle && servicioActual && (
          <p className="flex items-center gap-1.5 truncate text-sm text-[var(--color-text-secondary)]">
            <ServiceIcon name={servicioActual.icono} size={14} /> {servicioActual.nombre}
          </p>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-2.5">
        <button
          onClick={() => setBuscarAbierto(true)}
          title="Quick (Ctrl+K)"
          className="elevate flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-transform duration-150 ease-out-emil hover:scale-105 active:scale-95"
        >
          <Sparkles size={18} />
        </button>
        <RoleSwitch />
        <NotificationsBell />

        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="elevate flex items-center gap-2 rounded-full bg-[var(--color-surface)] py-1 pl-1 pr-2.5 transition-transform duration-150 ease-out-emil hover:scale-[1.02] active:scale-[0.98]"
          >
            <Avatar nombre={user.nombre} fotoUrl={user.fotoUrl} size={30} />
            <div className="hidden text-left sm:block">
              <p className="text-[13px] font-bold leading-tight text-[var(--color-text-primary)]">{user.nombre}</p>
              <p className="text-[11px] leading-tight text-[var(--color-text-muted)]">{ROLE_LABEL[rolMostrado]}</p>
            </div>
            <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
          </button>

          {open && (
            <div className="glass animate-pop-in absolute right-0 top-[calc(100%+8px)] z-40 w-72 overflow-hidden rounded-2xl py-2">
              <div className="px-4 py-2">
                <p className="truncate text-sm font-bold text-[var(--color-text-primary)]">{user.nombre}</p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{user.correo}</p>
                <Badge tone="brand" className="mt-1.5">{ROLE_LABEL[rolMostrado]}</Badge>
              </div>

              {orgs.length > 0 && (
                <>
                  <div className="my-1 border-t border-[var(--color-border)]" />
                  <OrgSwitcherList onClose={() => setOpen(false)} />
                </>
              )}

              <div className="my-1 border-t border-[var(--color-border)]" />
              <Link
                to="/app/perfil"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              >
                <UserRound size={16} /> Datos personales
              </Link>
              <Link
                to="/app/perfil"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              >
                <ShieldCheck size={16} /> Seguridad de la cuenta
              </Link>
              {rolMostrado === "admin" && (
                <Link
                  to="/app/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Settings size={16} /> Configuración
                </Link>
              )}
              <button
                type="button"
                disabled
                title="Próximamente"
                className="flex w-full cursor-default items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-[var(--color-text-muted)] opacity-60"
              >
                <CircleHelp size={16} /> Ayuda <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wide">Próximamente</span>
              </button>
              <div className="my-1 border-t border-[var(--color-border)]" />
              <button
                onClick={logout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <LogOut size={16} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      <SmartSearchModal open={buscarAbierto} onClose={() => setBuscarAbierto(false)} />
    </header>
  );
}
