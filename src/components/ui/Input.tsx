import { isValidElement, cloneElement, useId } from "react";
import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, ReactElement, ReactNode } from "react";
import { clsx } from "clsx";

export function Field({
  label,
  labelRight,
  hint,
  id,
  children,
}: {
  label?: string;
  labelRight?: ReactNode;
  hint?: string;
  /** Solo hace falta pasarlo cuando el campo real (el <input>, el
   * <select>...) no es el hijo directo de <Field> — por ejemplo, un
   * ícono envolviéndolo en su propio <div> — y hay que ponerlo a mano
   * en ese campo con este mismo id. Sin esto, <Field> genera uno solo
   * y se lo pasa automáticamente al hijo, para que un lector de
   * pantalla anuncie la etiqueta al enfocar el campo — antes de esto,
   * la etiqueta se veía bien pero no estaba realmente asociada a nada. */
  id?: string;
  children: ReactNode;
}) {
  const idGenerado = useId();
  // Solo se autoinyecta el id cuando hay exactamente un hijo y es un
  // elemento de verdad — un campo con varios hijos (por ejemplo, chips
  // seleccionados MÁS el campo de búsqueda debajo) no cae en este
  // caso, y es mejor que la etiqueta se quede SIN htmlFor a que apunte
  // a un id que ningún elemento tiene de verdad.
  const puedeAutoinyectar = !id && isValidElement(children);
  const fieldId = id ?? (puedeAutoinyectar ? idGenerado : undefined);
  const conId = puedeAutoinyectar
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: fieldId })
    : children;
  return (
    <div className="mb-4">
      {label &&
        (labelRight ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label htmlFor={fieldId} className="mb-0">{label}</Label>
            {labelRight}
          </div>
        ) : (
          <Label htmlFor={fieldId}>{label}</Label>
        ))}
      {conId}
      {hint && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={clsx(
        "block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2",
        props.className
      )}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)]",
        "placeholder:text-[var(--color-text-muted)] outline-none",
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)]",
        "outline-none",
        className
      )}
      {...rest}
    />
  );
}
