import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useService } from "../service/ServiceContext";
import type { Role } from "../db/types";

const ChangePasswordRequired = lazy(() => import("../../pages/auth/ChangePasswordRequired"));

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  // El servidor ya bloquea cualquier otra ruta mientras esto sea true
  // (ver requerirSesion en servidor/api/src/auth.ts) — esto solo evita
  // que el resto de la app intente pintar algo con datos a medias antes
  // de que el servidor lo rechace.
  if (user.debeCambiarPassword) {
    return (
      <Suspense fallback={<FullscreenSpinner />}>
        <ChangePasswordRequired />
      </Suspense>
    );
  }
  return <>{children}</>;
}

export function RequireService({ children }: { children: ReactNode }) {
  const { servicioActual, cargando } = useService();
  if (cargando) return <FullscreenSpinner />;
  if (!servicioActual) return <Navigate to="/app/servicios" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { effectiveRole } = useAuth();
  if (!effectiveRole || !roles.includes(effectiveRole)) return <Navigate to="/app/nuevo" replace />;
  return <>{children}</>;
}

export function FullscreenSpinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-page)]">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-500" />
    </div>
  );
}
