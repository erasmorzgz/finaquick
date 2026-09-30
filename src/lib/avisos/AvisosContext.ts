import { createContext, useContext } from "react";

import type { ToastInput } from "@/components/motion/animated-toast-stack";
type Avisar = (aviso: ToastInput) => void;

export const AvisosContext = createContext<Avisar>(() => {});
export function useAvisos(): Avisar {
  return useContext(AvisosContext);
}
