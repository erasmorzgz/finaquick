import type { EstadoCierre } from "./db/types";

export const ESTADO_CIERRE_LABEL: Record<EstadoCierre, string> = {
  aprobado: "Cuadra con Getnet",
  no_aprobado: "No cuadra con Getnet",
  aprobado_con_diferencia: "Aprobado con diferencia",
};
