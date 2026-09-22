import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "dark";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: "material-brand text-white",
  // Negro puro, sin color de marca — para el portón de entrada (login/registro),
  // que es neutro para cualquier organización que use el producto.
  dark: "material-invert text-white dark:text-black",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-brand-50 dark:hover:bg-white/5",
  outline:
    "bg-transparent text-brand-600 dark:text-brand-400 border border-brand-300 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-500/10",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5",
  danger:
    "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30",
};

const SIZE: Record<Size, string> = {
  sm: "text-xs px-3.5 py-1.5 gap-1.5 rounded-full",
  md: "text-sm px-5 py-2.5 gap-2 rounded-full",
  lg: "text-base px-6 py-3 gap-2.5 rounded-full",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap",
        "transition-[background-color,transform,box-shadow] duration-150 ease-out-emil active:scale-[0.97]",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
