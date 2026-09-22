import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Requiere2FA, UserProfile } from "../db/types";
import * as db from "../db";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  /** Modo de vista activo: un admin puede "actuar como usuario" para ver la app como el resto del personal. */
  viewAsPersonal: boolean;
  setViewAsPersonal: (v: boolean) => void;
  // Si la cuenta tiene 2FA activo, la contraseña correcta regresa
  // Requiere2FA (todavía no hay sesión) en vez de completar el login —
  // quien llama debe pedir el código y llamar completarLogin2FA().
  login: (correo: string, password: string, trampa?: string) => Promise<Requiere2FA | void>;
  completarLogin2FA: (tokenPre: string, codigo: string) => Promise<void>;
  register: (nombre: string, correo: string, password: string, token: string, trampa?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  effectiveRole: UserProfile["rol"] | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsPersonal, setViewAsPersonal] = useState(false);

  const refresh = useCallback(async () => {
    const u = await db.sesionActual();
    setUser(u);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

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

  const logout = useCallback(() => {
    db.cerrarSesion();
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
