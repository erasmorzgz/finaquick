import type { HTMLAttributes, ReactNode } from "react";
import { Inbox } from "lucide-react";
import { clsx } from "clsx";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "good" | "warning" | "critical";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-[var(--color-text-secondary)] dark:bg-white/10",
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
    good: "bg-[color:var(--color-good)]/10 text-[color:var(--color-good)]",
    warning: "bg-[color:var(--color-warning)]/15 text-amber-700 dark:text-amber-400",
    critical: "bg-[color:var(--color-critical)]/10 text-[color:var(--color-critical)]",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Avatar({ nombre, fotoUrl, size = 36 }: { nombre: string; fotoUrl?: string; size?: number }) {
  const iniciales = nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt={nombre}
        style={{ width: size, height: size }}
        className="rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="material-brand rounded-full text-white flex items-center justify-center font-bold flex-shrink-0"
    >
      {iniciales || "?"}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.04] text-[var(--color-text-muted)] dark:bg-white/5">
        {icon ?? <Inbox size={24} strokeWidth={1.75} />}
      </span>
      <p className="font-semibold text-[var(--color-text-primary)]">{title}</p>
      {hint && <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">{hint}</p>}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  delta,
  icon,
  hero,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: { value: string; positive: boolean } | null;
  icon?: ReactNode;
  /** Tarjeta protagonista con gradiente de marca — como máximo una por vista. */
  hero?: boolean;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-[var(--radius-card)] p-5",
        hero ? "hero-gradient hero-dots" : "glass",
        className
      )}
    >
      <div className="relative flex items-center justify-between mb-3">
        <span className={clsx("text-xs font-semibold uppercase tracking-wide", hero ? "text-white/75" : "text-[var(--color-text-muted)]")}>
          {label}
        </span>
        {icon}
      </div>
      <div className="relative flex items-end justify-between gap-2">
        <div className={clsx("tabular font-extrabold leading-none", hero ? "text-3xl text-white" : "text-2xl text-[var(--color-text-primary)]")}>
          {value}
        </div>
        {delta && (
          <span
            className={clsx(
              "tabular text-xs font-bold rounded-full px-2 py-0.5 mb-0.5",
              hero
                ? "bg-white/20 text-white"
                : delta.positive
                ? "bg-[color:var(--color-good)]/10 text-[color:var(--color-good)]"
                : "bg-[color:var(--color-critical)]/10 text-[color:var(--color-critical)]"
            )}
          >
            {delta.positive ? "↑" : "↓"} {delta.value}
          </span>
        )}
      </div>
      {sub && <div className={clsx("relative mt-2 text-xs", hero ? "text-white/70" : "text-[var(--color-text-muted)]")}>{sub}</div>}
    </div>
  );
}

export function Divider(props: HTMLAttributes<HTMLHRElement>) {
  return <hr className={clsx("border-[var(--color-border)]", props.className)} />;
}
