import { clsx } from "clsx";
import { useAuth } from "../../lib/auth/AuthContext";

// Slide visible solo para administradores: alterna entre ver la app como
// "Usuario" (personal normal) o como "Administrador" (todos los permisos).
export function RoleSwitch() {
  const { user, viewAsPersonal, setViewAsPersonal } = useAuth();
  if (!user || user.rol !== "admin") return null;

  return (
    <button
      onClick={() => setViewAsPersonal(!viewAsPersonal)}
      className="relative flex h-11 w-[176px] flex-shrink-0 items-center rounded-full bg-black/5 p-1 text-xs font-bold [box-shadow:inset_0_1px_3px_rgba(0,0,0,0.12)] dark:bg-white/10 dark:[box-shadow:inset_0_1px_3px_rgba(0,0,0,0.4)]"
      title="Cambiar entre vista de usuario y administrador"
    >
      <span
        className={clsx(
          "toggle-knob-motion material-brand absolute top-1 bottom-1 w-[84px] rounded-full transition-transform duration-[250ms] ease-out-emil",
          viewAsPersonal ? "translate-x-0" : "translate-x-[84px]"
        )}
      />
      <span className={clsx("z-10 w-1/2 text-center transition-colors", viewAsPersonal ? "text-white" : "text-[var(--color-text-secondary)]")}>
        Usuario
      </span>
      <span className={clsx("z-10 w-1/2 text-center transition-colors", !viewAsPersonal ? "text-white" : "text-[var(--color-text-secondary)]")}>
        Admin
      </span>
    </button>
  );
}
