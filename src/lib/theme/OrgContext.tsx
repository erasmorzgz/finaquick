import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as db from "../db";
import type { Organization } from "../db/types";
import { aplicarColorMarca } from "./brand";
import { useAuth } from "../auth/AuthContext";

interface OrgState {
  org: Organization | null;
  orgs: Organization[];
  cargando: boolean;
  cambiarOrganizacion: (id: string) => Promise<void>;
  crearOrganizacion: (nombre: string) => Promise<Organization>;
  eliminarOrganizacion: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [org, setOrg] = useState<Organization | null>(null);
  const [cargando, setCargando] = useState(true);

  // Recarga la lista de organizaciones a las que pertenece la cuenta
  // activa y decide cuál es "la actual" (la última elegida en este
  // navegador, o la primera disponible si no hay ninguna guardada).
  const refresh = useCallback(async () => {
    if (!user) {
      setOrgs([]);
      setOrg(null);
      return;
    }
    const misOrgs = await db.listarOrganizaciones(user.id);
    setOrgs(misOrgs);
    const actualId = await db.obtenerOrgActualId();
    const encontrada = misOrgs.find((o) => o.id === actualId) ?? misOrgs[0] ?? null;
    setOrg(encontrada);
    if (encontrada) {
      await db.establecerOrgActualId(encontrada.id);
      aplicarColorMarca(encontrada.colorPrimario);
    }
    // El título de pestaña NO se toca aquí — "Finaquick" (index.html) es la
    // marca del producto y debe verse siempre en el portón de entrada. El
    // nombre de la organización se refleja en el título solo dentro de la
    // app (ver AppShell), donde sí tiene sentido saber "de quién" es.
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    refresh().finally(() => setCargando(false));
  }, [authLoading, refresh]);

  const cambiarOrganizacion = useCallback(
    async (id: string) => {
      const encontrada = orgs.find((o) => o.id === id);
      if (!encontrada) return;
      await db.establecerOrgActualId(id);
      setOrg(encontrada);
      aplicarColorMarca(encontrada.colorPrimario);
    },
    [orgs]
  );

  const crearOrganizacion = useCallback(
    async (nombre: string) => {
      if (!user) throw new Error("Debes iniciar sesión.");
      const nueva = await db.crearOrganizacion(nombre, user.id);
      setOrgs((prev) => [...prev, nueva]);
      await db.establecerOrgActualId(nueva.id);
      setOrg(nueva);
      aplicarColorMarca(nueva.colorPrimario);
      return nueva;
    },
    [user]
  );

  // Después de eliminar, se refresca todo desde cero — así, si era la
  // organización activa, OrgContext elige otra por sí solo (misma lógica
  // que usa al iniciar sesión).
  const eliminarOrganizacion = useCallback(
    async (id: string) => {
      await db.eliminarOrganizacion(id);
      await refresh();
    },
    [refresh]
  );

  return (
    <OrgContext.Provider value={{ org, orgs, cargando, cambiarOrganizacion, crearOrganizacion, eliminarOrganizacion, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg debe usarse dentro de <OrgProvider>");
  return ctx;
}
