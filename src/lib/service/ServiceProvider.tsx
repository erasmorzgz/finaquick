import { ServiceContext } from "./ServiceContext";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ServiceConfig } from "../db/types";
import * as db from "../db";
import { useOrg } from "../theme/OrgContext";

const LS_KEY = "asp_servicio_actual";

export function ServiceProvider({ children }: { children: ReactNode }) {
  const { org, cargando: orgCargando } = useOrg();
  return <ServiceSession key={(org?.id ?? "sin-sesion") + String(orgCargando)}>{children}</ServiceSession>;
}

function ServiceSession({ children }: { children: ReactNode }) {
  const { org, cargando: orgCargando } = useOrg();
  const navigate = useNavigate();
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [servicioActual, setServicioActual] = useState<ServiceConfig | null>(null);
  const [cargando, setCargando] = useState(!!org || orgCargando);

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
    if (orgCargando || !org) return;
    let activo = true;
    db.listarServicios(org.id).then((list) => {
      if (!activo) return;
      setServicios(list);
      const found = list.find((s) => s.id === localStorage.getItem(LS_KEY));
      setServicioActual(found ?? null);
      if (!found) localStorage.removeItem(LS_KEY);
    }).catch(() => {}).finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [orgCargando, org]);

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
