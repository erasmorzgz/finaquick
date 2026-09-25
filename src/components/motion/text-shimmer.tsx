// beui.dev/components/motion/text-shimmer
// Adaptado: los @keyframes y la regla de movimiento reducido viven en
// src/index.css en vez de inyectarse con una etiqueta <style> en línea.
import { cn } from "@/lib/utils";
import type { ElementType, ReactNode } from "react";
import { TEXT_SHIMMER_CLASS_NAME, textShimmerStyle } from "@/lib/text-shimmer";

export interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  duration?: number;
  className?: string;
}

export function TextShimmer({ children, as: Comp = "span", duration = 2.5, className }: TextShimmerProps) {
  return (
    <Comp style={textShimmerStyle(duration)} className={cn("inline-block", TEXT_SHIMMER_CLASS_NAME, className)}>
      {children}
    </Comp>
  );
}
