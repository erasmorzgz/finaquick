import { useAnimatedToastStack } from "@/components/motion/useAnimatedToastStack";
import { AvisosContext } from "./AvisosContext";
import { type ReactNode } from "react";
import { AnimatedToastStack } from "@/components/motion/animated-toast-stack";

// Avisos flotantes de confirmación ("Cambios guardados") para acciones
// que no cambian de pantalla — antes solo cambiaba el texto del botón
// un par de segundos, fácil de no ver.

export function AvisosProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ defaultDuration: 3500, limit: 4 });
  return (
    <AvisosContext.Provider value={showToast}>
      {children}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed className="print:hidden" />
    </AvisosContext.Provider>
  );
}
