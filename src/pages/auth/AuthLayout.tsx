import type { ReactNode } from "react";
import anahuacMark from "../../assets/anahuac-a-mark-white.png";
import appMark from "/app-mark.png";

// El portón de entrada (login/registro) es el único lugar de toda la app
// que no depende del color de marca de la organización — pero esta
// instalación es para Anáhuac, así que su logotipo (no el de Finaquick)
// es lo que se ve aquí: minimalista a propósito, sin copy, sin pie de
// página, solo el logotipo, centrado.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-page)]">
      <div className="relative hidden w-[42%] flex-col items-center justify-center bg-black lg:flex">
        <img src={anahuacMark} alt="Universidad Anáhuac" className="h-40 w-40 object-contain" />
      </div>

      <div className="ambient-glow flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <img src={appMark} alt="Universidad Anáhuac" className="h-14 w-14 rounded-[14px] object-contain" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
