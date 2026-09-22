import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../../lib/auth/AuthContext";
import { useService } from "../../lib/service/ServiceContext";
import { useOrg } from "../../lib/theme/OrgContext";
import {
  Home as IconHome,
  FilePlus2 as IconFilePlus,
  History as IconHistory,
  CalendarDays as IconCalendar,
  CreditCard as IconCreditCard,
  ClipboardList as IconRequisicion,
  Wallet as IconCash,
  BarChart3 as IconChartBar,
  Search as IconSearch,
  User as IconUser,
  Settings as IconSettings,
} from "lucide-react";

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "group flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold transition-colors duration-150 ease-out-emil",
          isActive ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out-emil [&>svg]:h-[18px] [&>svg]:w-[18px]",
              isActive
                ? "bg-[var(--color-text-primary)] text-[var(--color-page)]"
                : "bg-black/[0.04] text-[var(--color-text-muted)] group-hover:bg-black/[0.06] dark:bg-white/5 dark:group-hover:bg-white/10"
            )}
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
          {isActive && <span className="ml-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { user, effectiveRole } = useAuth();
  const { servicioActual, salirDeServicio } = useService();
  const { org } = useOrg();
  const f = servicioActual?.features;
  // Acceso de "solo consulta": ve historial/actividad de este servicio,
  // pero no genera folios nuevos ahí — así que ni el atajo aparece.
  const soloConsulta = !!(servicioActual && user?.serviciosSoloConsulta?.includes(servicioActual.id));

  return (
    <aside className="glass hidden md:flex w-[236px] flex-shrink-0 flex-col gap-1 rounded-none border-r border-y-0 border-l-0 px-4 py-5 print:hidden">
      <div className="mb-6 flex items-center gap-2.5 px-1">
        <button
          onClick={salirDeServicio}
          title="Ir al menú de servicios"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-[var(--color-text-secondary)] transition-transform duration-150 ease-out-emil hover:scale-105 hover:bg-black/[0.07] active:scale-95 dark:bg-white/5 dark:hover:bg-white/10"
        >
          <IconHome size={17} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Perteneces a</p>
          <p className="truncate text-sm font-extrabold leading-tight text-[var(--color-text-primary)]">
            {org?.nombre ?? "tu organización"}
          </p>
        </div>
      </div>

      <nav className="flex w-full flex-col gap-0.5">
        {!soloConsulta && <NavItem to="/app/nuevo" icon={<IconFilePlus />} label="Nuevo folio" />}
        <NavItem to="/app/historial" icon={<IconHistory />} label="Historial" />
        <NavItem to="/app/actividad" icon={<IconCalendar />} label="Actividad" />
        {f?.creditos && <NavItem to="/app/creditos" icon={<IconCreditCard />} label="Créditos" />}
        {f?.requisiciones && <NavItem to="/app/requisiciones" icon={<IconRequisicion />} label="Requisiciones" />}
        {f?.cierreCaja && (
          <NavItem to="/app/cierre-caja" icon={<IconCash />} label={servicioActual?.cierreCajaLabel ?? "Cierre"} />
        )}
        {(effectiveRole === "admin" || effectiveRole === "finanzas") && (
          <>
            <NavItem to="/app/finanzas" icon={<IconChartBar />} label="Finanzas" />
            <NavItem to="/app/buscar" icon={<IconSearch />} label="Buscar folio" />
          </>
        )}
      </nav>

      <div className="my-3 border-t border-[var(--color-border)]" />

      <div className="mt-auto flex w-full flex-col gap-0.5">
        {effectiveRole === "admin" && <NavItem to="/app/admin" icon={<IconSettings />} label="Configuración" />}
        <NavItem to="/app/perfil" icon={<IconUser />} label="Mi perfil" />
      </div>
    </aside>
  );
}
