import { useState } from "react";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { Check, ChevronsUpDown } from "lucide-react";

export interface Option {
  id: string;
  label: string;
  meta?: string;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  id,
}: {
  options: Option[];
  value: string;
  onChange: (label: string) => void;
  placeholder?: string;
  /** <Field> se lo pasa automáticamente cuando este es su hijo directo,
   * para que la etiqueta quede asociada de verdad con el campo (ver
   * Input.tsx) — sin esto, ComboboxInput no tenía forma de recibirlo. */
  id?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered =
    query === ""
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Combobox value={value} onChange={(v) => v && onChange(v)} onClose={() => setQuery("")}>
      <div className="relative">
        <ComboboxInput
          id={id}
          className="glow-focus w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 pr-9 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          displayValue={(v: string) => v}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
          }}
        />
        <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--color-text-muted)]">
          <ChevronsUpDown size={15} />
        </ComboboxButton>
        <ComboboxOptions
          anchor="bottom start"
          className="z-50 mt-1.5 max-h-56 w-[var(--input-width)] overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 shadow-xl focus:outline-none empty:invisible"
        >
          {filtered.map((o) => (
            <ComboboxOption
              key={o.id}
              value={o.label}
              className="flex cursor-pointer items-center justify-between px-3.5 py-2 text-sm text-[var(--color-text-primary)] data-[focus]:bg-brand-50 dark:data-[focus]:bg-brand-500/10"
            >
              {({ selected }) => (
                <>
                  <span>{o.label}</span>
                  <span className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    {o.meta}
                    {selected && <Check size={14} className="text-brand-600" />}
                  </span>
                </>
              )}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
