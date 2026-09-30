import { createContext, useContext } from "react";
import type { ArchivoEnviado } from "../db/types";
export interface NotificationsState {
  archivos: ArchivoEnviado[];
  noLeidos: number;
  refresh: () => Promise<void>;
  marcarLeido: (id: string) => Promise<void>;
}

export const NotificationsContext = createContext<NotificationsState | null>(null);
export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications debe usarse dentro de <NotificationsProvider>");
  return ctx;
}
