import { AuthContext, type AuthState } from "./AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { UserProfile } from "../db/types";
import * as db from "../db";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsPersonal, setViewAsPersonal] = useState(false);

  const refresh = useCallback(async () => {
    const u = await db.sesionActual();
    setUser(u);
  }, []);

  useEffect(() => {
    let activo = true;
    db.sesionActual().then((u) => { if (activo) setUser(u); })
      .catch(() => { if (activo) setUser(null); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

  const login = useCallback(async (correo: string, password: string, trampa?: string) => {
    const resultado = await db.iniciarSesion(correo, password, trampa);
    if ("requiere2FA" in resultado) return resultado;
    setUser(resultado);
  }, []);

  const completarLogin2FA = useCallback(async (tokenPre: string, codigo: string) => {
    const u = await db.completar2FA(tokenPre, codigo);
    setUser(u);
  }, []);

  const register = useCallback(async (nombre: string, correo: string, password: string, token: string, trampa?: string) => {
    const u = await db.registrar(nombre, correo, password, token, trampa);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await db.cerrarSesion();
    setUser(null);
    setViewAsPersonal(false);
  }, []);

  const effectiveRole = useMemo(() => {
    if (!user) return null;
    return viewAsPersonal ? "personal" : user.rol;
  }, [user, viewAsPersonal]);

  const value: AuthState = {
    user,
    loading,
    viewAsPersonal,
    setViewAsPersonal,
    login,
    completarLogin2FA,
    register,
    logout,
    refresh,
    effectiveRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
