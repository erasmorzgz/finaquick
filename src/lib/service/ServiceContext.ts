import { createContext, useContext } from "react";
import type { ServiceConfig } from "../db/types";
export interface ServiceState {
  servicios: ServiceConfig[];
  servicioActual: ServiceConfig | null;
  cargando: boolean;
  elegirServicio: (id: string) => void;
  salirDeServicio: () => void;
  recargarServicios: () => Promise<void>;
}

export const ServiceContext = createContext<ServiceState | null>(null);
export function useService() {
  const ctx = useContext(ServiceContext);
  if (!ctx) throw new Error("useService debe usarse dentro de <ServiceProvider>");
  return ctx;
}
