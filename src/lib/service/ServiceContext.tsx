import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ServiceConfig } from "../db/types";
import * as db from "../db";
import { useOrg } from "../theme/OrgContext";

interface ServiceState {
  servicios: ServiceConfig[];
  servicioActual: ServiceConfig | null;
  cargando: boolean;
  elegirServicio: (id: string) => void;
  salirDeServicio: () => void;
  recargarServicios: () => Promise<void>;
}

const ServiceContext = createContext<ServiceState | null>(null);
const LS_KEY = "asp_servicio_actual";

export function ServiceProvider({ children }: { children: ReactNode }) {
  const { org, cargando: orgCargando } = useOrg();
  const navigate = useNavigate();
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [servicioActual, setServicioActual] = useState<ServiceConfig | null>(null);
  const [cargando, setCargando] = useState(true);

  // Los servicios pertenecen a una organización — al cambiar de equipo
  // (o al cerrar sesión, cuando `org` se vuelve null) esto se vuelve a
  // cargar solo y limpia cualquier servicio elegido que ya no aplique.
  const recargarServicios = useCallback(async () => {
    if (!org) {
      setServicios([]);
      setServicioActual(null);
      return;
    }
    const list = await db.listarServicios(org.id);
    setServicios(list);
    const savedId = localStorage.getItem(LS_KEY);
    const found = savedId ? list.find((s) => s.id === savedId) : undefined;
    setServicioActual(found ?? null);
    if (!found) localStorage.removeItem(LS_KEY);
  }, [org]);

  useEffect(() => {
    if (orgCargando) return;
    recargarServicios().finally(() => setCargando(false));
  }, [orgCargando, recargarServicios]);

  const elegirServicio = useCallback(
    (id: string) => {
      const found = servicios.find((s) => s.id === id);
      if (!found) return;
      setServicioActual(found);
      localStorage.setItem(LS_KEY, id);
      navigate("/app/nuevo");
    },
    [servicios, navigate]
  );

  const salirDeServicio = useCallback(() => {
    setServicioActual(null);
    localStorage.removeItem(LS_KEY);
    navigate("/app/servicios");
  }, [navigate]);

  return (
    <ServiceContext.Provider
      value={{ servicios, servicioActual, cargando, elegirServicio, salirDeServicio, recargarServicios }}
    >
      {children}
    </ServiceContext.Provider>
  );
}

export function useService() {
  const ctx = useContext(ServiceContext);
  if (!ctx) throw new Error("useService debe usarse dentro de <ServiceProvider>");
  return ctx;
}
