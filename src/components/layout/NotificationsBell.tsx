import { useEffect, useRef, useState } from "react";
import { Bell, Download, Inbox } from "lucide-react";
import { clsx } from "clsx";
import { useNotifications } from "../../lib/notifications/NotificationsContext";
import * as db from "../../lib/db";
import { descargarTexto } from "../../lib/utils";

const FORMATO_FECHA = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Bandeja de "archivos recibidos" — reportes que otro compañero de la
// organización te mandó (ej. un cierre de caja), guardados de verdad
// en el servidor. No hay una notificación push real todavía: el
// contexto refresca solo cada rato, y también al abrir la campana, en
// vez de enterarse al instante de que algo llegó.
export function NotificationsBell() {
  const { archivos, noLeidos, refresh, marcarLeido } = useNotifications();
  const [open, setOpen] = useState(false);
  const [descargando, setDescargando] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function abrir() {
    refresh();
    setOpen((o) => !o);
  }

  // El contenido ya no viene en la lista (ver ArchivoEnviado en
  // types.ts) — se pide aparte, y solo en este momento, para no
  // transferir el archivo completo de todos los recibidos cada vez que
  // se refresca la campana.
  async function descargar(id: string, nombreArchivo: string) {
    setDescargando(id);
    try {
      const contenido = await db.obtenerContenidoArchivo(id);
      descargarTexto(nombreArchivo, contenido);
      await marcarLeido(id);
    } finally {
      setDescargando(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className="elevate relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-transform duration-150 ease-out-emil hover:scale-105 active:scale-95"
        title="Archivos recibidos"
      >
        <Bell size={18} />
        {noLeidos > 0 && (
          <span className="absolute right-2 top-2 flex h-2 w-2 rounded-full bg-brand-500 ring-2 ring-[var(--color-surface)]" />
        )}
      </button>

      {open && (
        <div className="glass animate-pop-in absolute right-0 top-[calc(100%+8px)] z-40 w-80 overflow-hidden rounded-2xl py-2">
          <p className="px-4 py-2 text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Archivos recibidos
          </p>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {archivos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <Inbox size={22} className="text-[var(--color-text-muted)]" />
                <p className="text-xs text-[var(--color-text-muted)]">Todavía no te han enviado nada.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 px-1.5">
                {archivos.map((a) => (
                  <div
                    key={a.id}
                    className={clsx(
                      "rounded-xl px-3 py-2.5",
                      !a.leido && "bg-brand-50 dark:bg-brand-500/10"
                    )}
                  >
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[var(--color-text-primary)]">{a.tipo}</span>
                      {!a.leido && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />}
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {a.servicioNombre ?? "General"} · {FORMATO_FECHA.format(new Date(a.fecha))}
                    </p>
                    {a.mensaje && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">“{a.mensaje}”</p>}
                    <button
                      onClick={() => descargar(a.id, a.nombreArchivo)}
                      disabled={descargando === a.id}
                      className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-bold text-[var(--color-text-secondary)] transition-colors duration-150 ease-out-emil hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                    >
                      <Download size={13} /> {descargando === a.id ? "Descargando…" : "Descargar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
