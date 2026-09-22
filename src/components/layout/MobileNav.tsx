import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import {
  Home,
  FilePlus2,
  History,
  CalendarDays,
  CreditCard,
  ClipboardList,
  Wallet,
  BarChart3,
  Search,
  User,
  Settings,
} from "lucide-react";
import { useAuth } from "../../lib/auth/AuthContext";
import { useService } from "../../lib/service/ServiceContext";

export function MobileNav() {
  const { user, effectiveRole } = useAuth();
  const { servicioActual, salirDeServicio } = useService();
  const f = servicioActual?.features;
  const soloConsulta = !!(servicioActual && user?.serviciosSoloConsulta?.includes(servicioActual.id));

  const item = (to: string, Icon: typeof Home, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors duration-150 ease-out-emil",
          isActive ? "material-brand text-white" : "bg-black/5 text-[var(--color-text-secondary)] dark:bg-white/10"
        )
      }
    >
      <Icon size={14} /> {label}
    </NavLink>
  );

  return (
    <div className="glass flex md:hidden items-center gap-2 overflow-x-auto rounded-none border-x-0 border-t-0 px-4 py-2.5 scrollbar-thin print:hidden">
      <button
        onClick={salirDeServicio}
        className="material-dark flex flex-shrink-0 items-center justify-center rounded-full p-2 text-white"
      >
        <Home size={14} />
      </button>
      {!soloConsulta && item("/app/nuevo", FilePlus2, "Folio")}
      {item("/app/historial", History, "Historial")}
      {item("/app/actividad", CalendarDays, "Actividad")}
      {f?.creditos && item("/app/creditos", CreditCard, "Créditos")}
      {f?.requisiciones && item("/app/requisiciones", ClipboardList, "Requisiciones")}
      {f?.cierreCaja && item("/app/cierre-caja", Wallet, servicioActual?.cierreCajaLabel ?? "Cierre")}
      {(effectiveRole === "admin" || effectiveRole === "finanzas") && item("/app/finanzas", BarChart3, "Finanzas")}
      {(effectiveRole === "admin" || effectiveRole === "finanzas") && item("/app/buscar", Search, "Buscar")}
      {effectiveRole === "admin" && item("/app/admin", Settings, "Config.")}
      {item("/app/perfil", User, "Perfil")}
    </div>
  );
}
