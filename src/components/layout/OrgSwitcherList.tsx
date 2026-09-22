import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "../../lib/auth/AuthContext";
import { useOrg } from "../../lib/theme/OrgContext";

// Lista de organizaciones a las que pertenece la cuenta, con el cambio
// entre ellas y (si eres admin) crear una nueva — el mismo contenido se usa
// dentro del menú de cuenta (Topbar) y del selector de servicios
// (ServicePicker), para que cambiar de campus nunca sea un callejón sin
// salida: si tus servicios están en otra organización, siempre hay un
// lugar desde el que puedes volver a elegirla.
export function OrgSwitcherList({ onClose }: { onClose: () => void }) {
  const { effectiveRole } = useAuth();
  const { org, orgs, cambiarOrganizacion, crearOrganizacion } = useOrg();
  const [creandoOrg, setCreandoOrg] = useState(false);
  const [nombreOrgNueva, setNombreOrgNueva] = useState("");

  if (orgs.length === 0) return null;

  async function seleccionarOrg(id: string) {
    if (id !== org?.id) await cambiarOrganizacion(id);
    onClose();
  }

  async function confirmarCrearOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreOrgNueva.trim()) return;
    await crearOrganizacion(nombreOrgNueva.trim());
    setNombreOrgNueva("");
    setCreandoOrg(false);
    onClose();
  }

  return (
    <>
      <p className="px-4 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        Tus organizaciones
      </p>
      <div className="flex flex-col gap-0.5 px-1.5">
        {orgs.map((o) => {
          const activa = o.id === org?.id;
          return (
            <button
              key={o.id}
              onClick={() => seleccionarOrg(o.id)}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 ease-out-emil",
                activa ? "bg-black/[0.04] dark:bg-white/5" : "hover:bg-black/[0.04] dark:hover:bg-white/5"
              )}
            >
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-extrabold text-white"
                style={{ background: o.colorPrimario }}
              >
                {o.nombre.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                {o.nombre}
              </span>
              {activa && <Check size={15} className="flex-shrink-0 text-brand-600" />}
            </button>
          );
        })}
      </div>

      {effectiveRole === "admin" && (
        <div className="px-1.5 pt-0.5">
          {!creandoOrg ? (
            <button
              onClick={() => setCreandoOrg(true)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-[var(--color-text-secondary)] transition-colors duration-150 ease-out-emil hover:bg-black/[0.04] dark:hover:bg-white/5"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)]">
                <Plus size={14} />
              </span>
              Crear organización
            </button>
          ) : (
            <form onSubmit={confirmarCrearOrg} className="flex items-center gap-1.5 px-1 py-1">
              <input
                autoFocus
                value={nombreOrgNueva}
                onChange={(e) => setNombreOrgNueva(e.target.value)}
                placeholder="Nombre del equipo…"
                className="glow-focus min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={!nombreOrgNueva.trim()}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40"
              >
                <Check size={15} />
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
