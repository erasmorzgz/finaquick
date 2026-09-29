// Adaptado de beUI (beui.dev) — licencia MIT, ver LICENCIAS_DE_TERCEROS.md.
import type { CSSProperties } from "react";

// La animación (@keyframes beui-text-shimmer) y su regla de movimiento
// reducido viven en src/index.css; aquí solo la clase y el estilo en línea.
export const TEXT_SHIMMER_CLASS_NAME =
  "beui-text-shimmer bg-[length:200%_100%] bg-clip-text text-transparent bg-[linear-gradient(110deg,var(--muted-foreground)_30%,var(--foreground)_50%,var(--muted-foreground)_70%)]";

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}
