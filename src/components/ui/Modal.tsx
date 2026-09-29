import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const SELECTOR_ENFOCABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const tituloId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Qué tenía el foco justo antes de abrir — para devolvérselo al
  // cerrar. Sin esto, cerrar un modal (con Escape, con el botón de
  // "Cancelar", lo que sea) dejaba el foco del teclado en ningún lado
  // en concreto, obligando a alguien navegando solo con teclado a
  // volver a ubicarse desde arriba de la página.
  const disparadorRef = useRef<HTMLElement | null>(null);

  // Salida animada: al cerrar, el modal se queda montado ~150 ms
  // desvaneciéndose en vez de desaparecer de golpe. Se ajusta durante el
  // render (no en un efecto) para que no haya ni un cuadro sin modal
  // entre "cerrar" y "empezar la salida".
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  const [cerrando, setCerrando] = useState(false);
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    setCerrando(!open);
  }
  useEffect(() => {
    if (!cerrando) return;
    const t = window.setTimeout(() => setCerrando(false), 150);
    return () => window.clearTimeout(t);
  }, [cerrando]);
  // Durante la salida se muestra lo último que tenía abierto: quien usa
  // el modal suele limpiar sus datos al cerrar (el día elegido, el folio
  // creado), y sin esto el contenido se vaciaba mientras se desvanecía.
  // Leer/escribir una ref durante el render es a propósito aquí: es la
  // única forma de conservar el contenido del render anterior sin
  // disparar otro render (guardarlo en estado entraría en un ciclo).
  /* oxlint-disable react/refs */
  const ultimoContenido = useRef({ title, subtitle, children, footer });
  if (open) ultimoContenido.current = { title, subtitle, children, footer };
  const c = open ? { title, subtitle, children, footer } : ultimoContenido.current;
  /* oxlint-enable react/refs */

  useEffect(() => {
    if (!open) return;
    disparadorRef.current = document.activeElement as HTMLElement | null;
    // Un tick después de montar: el primer elemento enfocable de
    // adentro (o el panel mismo, si no hay ninguno) recibe el foco —
    // sin esto, el foco se quedaba en lo que fuera que estuviera
    // debajo del modal, invisible detrás del overlay.
    const primero = panelRef.current?.querySelector<HTMLElement>(SELECTOR_ENFOCABLE);
    (primero ?? panelRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Atrapa el Tab dentro del modal — sin esto, seguir tabulando
      // sacaba el foco hacia elementos de la página de atrás, todavía
      // visibles debajo del overlay pero fuera de lo que el modal deja
      // usar con el mouse.
      if (e.key !== "Tab" || !panelRef.current) return;
      const enfocables = panelRef.current.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE);
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      disparadorRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open && !cerrando) return null;
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${open ? "animate-fade-in" : "pointer-events-none animate-fade-out"}`}
      onClick={(e) => open && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? tituloId : undefined}
        tabIndex={-1}
        style={{ width }}
        className={`w-full max-h-[90vh] overflow-y-auto rounded-[var(--radius-card)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl ${open ? "animate-pop-in" : "animate-pop-out"} outline-none [box-shadow:inset_0_1px_0_rgba(255,255,255,0.5),0_25px_60px_-15px_rgba(0,0,0,0.3)] dark:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06),0_25px_60px_-15px_rgba(0,0,0,0.6)]`}
      >
        {c.title && (
          <div className="px-6 pt-6 pb-4 border-b border-[var(--color-border)]">
            <h3 id={tituloId} className="text-lg font-bold text-[var(--color-text-primary)]">{c.title}</h3>
            {c.subtitle && <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{c.subtitle}</p>}
          </div>
        )}
        <div className="px-6 py-5">{c.children}</div>
        {c.footer && <div className="px-6 py-4 border-t border-[var(--color-border)] flex justify-end gap-2 flex-wrap">{c.footer}</div>}
      </div>
    </div>,
    document.body
  );
}
