import { createContext, useContext } from "react";
import type { Requiere2FA, UserProfile } from "../db/types";
export interface AuthState {
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
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  effectiveRole: UserProfile["rol"] | null;
}

export const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
