import type { HTMLAttributes, MouseEvent } from "react";
import { clsx } from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Vidrio esmerilado (contenedores principales, sobre .ambient-glow).
   * Las filas de listas repetidas se quedan sólidas — el blur es caro
   * y estorba la lectura cuando hay muchas encimadas. */
  glass?: boolean;
}

export function Card({ className, onClick, onKeyDown, glass, ...rest }: CardProps) {
  // Una Card con onClick es un control: se vuelve alcanzable con teclado
  // (Tab) y activable con Enter/Espacio, no solo con el mouse.
  const interactive = !!onClick;
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-card)]",
        glass ? "glass" : "elevate bg-[var(--color-surface)] border border-[var(--color-border)]",
        className
      )}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.(e as unknown as MouseEvent<HTMLDivElement>);
        }
      }}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("px-5 pt-5", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("px-5 pb-5", className)} {...rest} />;
}

export function SectionLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3",
        className
      )}
      {...rest}
    />
  );
}
