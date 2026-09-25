"use client";
// beui.dev/components/motion/number
// Adaptado: `from` permite arrancar ya en el valor real (sin contar
// desde 0) y animar solo los cambios posteriores.

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  startOnView?: boolean;
  /** Valor inicial del contador. Por default 0 (cuenta desde cero). */
  from?: number;
}

export function AnimatedNumber({
  value,
  duration = 1.2,
  format = (n) => Math.round(n).toLocaleString(),
  className,
  startOnView = true,
  from = 0,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(from);
  const fromRef = useRef(from);

  useEffect(() => {
    if (startOnView && !inView) return;
    if (reduce) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(fromRef.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    fromRef.current = value;
    return () => controls.stop();
  }, [value, duration, inView, startOnView, reduce]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(display)}
    </span>
  );
}
