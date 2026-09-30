import { createContext, useContext } from "react";
import type { Organization } from "../db/types";
export interface OrgState {
  org: Organization | null;
  orgs: Organization[];
  cargando: boolean;
  cambiarOrganizacion: (id: string) => Promise<void>;
  crearOrganizacion: (nombre: string) => Promise<Organization>;
  eliminarOrganizacion: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const OrgContext = createContext<OrgState | null>(null);
export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg debe usarse dentro de <OrgProvider>");
  return ctx;
}
