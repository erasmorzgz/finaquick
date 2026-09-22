import type { ReactNode } from "react";

const FORMATO_GENERADO = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
});

/** Encabezado de un reporte imprimible (corte de caja, resumen financiero,
 * etc.) — título + contexto a la izquierda, sello de "generado" a la
 * derecha. Solo aparece dentro de #-report sections, pensado para verse
 * bien tanto en pantalla como en el PDF que sale de window.print(). */
export function PrintReportHeader({
  titulo,
  contexto,
  meta,
}: {
  titulo: string;
  contexto?: ReactNode;
  meta?: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] pb-4 print:border-black/15">
      <div>
        <h2 className="text-xl font-extrabold text-[var(--color-text-primary)] print:text-black">{titulo}</h2>
        {contexto && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)] print:text-black/70">{contexto}</p>}
      </div>
      {meta && meta.length > 0 && (
        <div className="flex flex-shrink-0 gap-6 text-right">
          {meta.map((m) => (
            <div key={m.label}>
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] print:text-black/50">{m.label}</p>
              <p className="tabular text-sm font-bold text-[var(--color-text-primary)] print:text-black">{m.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pie de página del reporte — nombre de la organización a la izquierda,
 * fecha/hora de generación a la derecha. */
export function PrintReportFooter({ orgNombre }: { orgNombre?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)] print:border-black/15 print:text-black/50">
      <span>{orgNombre} — Finaquick</span>
      <span>Generado: {FORMATO_GENERADO.format(new Date())}</span>
    </div>
  );
}

/** Barra de total al final de un reporte — mismo trato visual en toda la
 * app para que un corte de caja y un resumen financiero se sientan del
 * mismo sistema. */
export function PrintReportTotalBar({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[var(--color-brand-50)] px-4 py-3 dark:bg-brand-500/10 print:border print:border-black/15 print:bg-transparent">
      <span className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-text-primary)] print:text-black">{label}</span>
      <span className="tabular text-lg font-extrabold text-brand-600 print:text-black">{value}</span>
    </div>
  );
}
