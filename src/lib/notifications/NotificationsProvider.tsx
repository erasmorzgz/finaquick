import { NotificationsContext } from "./NotificationsContext";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as db from "../db";
import type { ArchivoEnviado } from "../db/types";
import { useAuth } from "../auth/AuthContext";

// Los archivos se guardan de verdad en el servidor — lo que no existe
// todavía es una notificación push real avisando al instante cuando
// llega uno nuevo. Para que se sienta como una notificación de verdad
// (y no solo algo que aparece al recargar la página), esto se
// refresca solo cada rato y también al volver a la pestaña, además de
// cuando el usuario abre la campana.
const INTERVALO_MS = 12_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <NotificationsSession key={(user?.id ?? "sin-sesion")}>{children}</NotificationsSession>;
}

function NotificationsSession({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [archivos, setArchivos] = useState<ArchivoEnviado[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setArchivos([]);
      return;
    }
    try {
      setArchivos(await db.listarArchivosRecibidos(user.id));
    } catch {
      // Se reintenta solo en el siguiente ciclo (cada INTERVALO_MS) o al
      // volver a la pestaña — un fallo pasajero de red, o la sesión
      // que expiró justo entre que "user" se cargó y esta llamada salió,
      // no debe tronar como una promesa sin capturar. La campana
      // simplemente no se actualiza esta vez.
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let activo = true;
    db.listarArchivosRecibidos(user.id).then((lista) => { if (activo) setArchivos(lista); }).catch(() => {});
    return () => { activo = false; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(refresh, INTERVALO_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, refresh]);

  const marcarLeido = useCallback(async (id: string) => {
    await db.marcarArchivoLeido(id);
    setArchivos((prev) => prev.map((a) => (a.id === id ? { ...a, leido: true } : a)));
  }, []);

  const noLeidos = archivos.filter((a) => !a.leido).length;

  return (
    <NotificationsContext.Provider value={{ archivos, noLeidos, refresh, marcarLeido }}>
      {children}
    </NotificationsContext.Provider>
  );
}
