// Funciones de fecha compartidas entre CashClose.tsx y
// SmartSearchModal.tsx — separadas en su propio archivo (no exportadas
// desde CashClose.tsx) a propósito: App.tsx carga CashClose.tsx de
// forma perezosa (lazy) porque es una pantalla completa que no hace
// falta en el primer render, pero SmartSearchModal.tsx (que sí se
// carga siempre, desde Topbar.tsx) solo necesita estas tres funciones
// diminutas — importarlas desde CashClose.tsx arrastraba la pantalla
// entera al paquete principal, anulando esa carga perezosa (visto
// como advertencia "INEFFECTIVE_DYNAMIC_IMPORT" al compilar).
import type { Ticket } from "./db/types";

export function fechaLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// El cierre de caja existe para cuadrar el dinero que de verdad entró
// un día dado — así que agrupa por cuándo se COBRÓ (fechaPago), no por
// cuándo se generó el folio. Antes usaba siempre "fecha": un crédito
// emitido el 31 de agosto y cobrado el 7 de septiembre se sumaba al
// corte de agosto para siempre, aunque ese dinero nunca hubiera estado
// en la caja de agosto. fechaPago solo existe en folios que se pagaron
// después de crearse (ver esquema_local.sql) — en los que nacieron ya
// "pagado" coincide con "fecha", así que ahí no hace falta.
export function fechaEfectiva(t: Ticket): string {
  return t.fechaPago ?? t.fecha;
}

export function mesLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
