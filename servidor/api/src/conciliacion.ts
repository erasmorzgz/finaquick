import { createHash } from "node:crypto";

// Conciliación del cierre de caja: compara los cobros con tarjeta que
// registró el sistema en un día contra los movimientos del reporte
// diario de Getnet. Es lógica pura (sin base de datos ni red) para poder
// probarla a fondo — rutas.ts solo le da los datos y guarda el resultado.
//
// Todo se compara en CENTAVOS enteros: sumar pesos con decimales en
// punto flotante daría diferencias falsas de una fracción de centavo.

export interface MovimientoGetnet {
  /** Magnitud del movimiento, siempre positiva (la dirección la da `tipo`). */
  monto: number;
  tipo: "venta" | "cancelacion";
  autorizacion?: string;
  hora?: string;
}

export interface MovimientoSistema {
  id: string;
  folio: string;
  nombre: string;
  total: number;
  hora: string;
}

export interface ParejaConciliada {
  folio: string;
  nombre: string;
  monto: number;
  autorizacion?: string;
  hora?: string;
}

export interface ResultadoConciliacion {
  totalSistema: number;
  totalGetnet: number;
  /** Getnet menos sistema: positivo = Getnet reporta de más. */
  diferencia: number;
  movimientosSistema: number;
  movimientosGetnet: number;
  coinciden: ParejaConciliada[];
  /** Cobros con tarjeta que el sistema tiene y Getnet no reporta. */
  soloSistema: { folio: string; nombre: string; monto: number; hora?: string }[];
  /** Ventas que Getnet reporta y el sistema no tiene. */
  soloGetnet: { monto: number; autorizacion?: string; hora?: string }[];
  /** Ventas y cancelaciones de Getnet que se anulan entre sí (mismo monto). */
  cancelaciones: { monto: number; autorizacion?: string; hora?: string }[];
  cuadra: boolean;
}

const aCentavos = (pesos: number) => Math.round(pesos * 100);
const aPesos = (centavos: number) => centavos / 100;

export function conciliar(sistema: MovimientoSistema[], getnet: MovimientoGetnet[]): ResultadoConciliacion {
  const ventas = getnet.filter((m) => m.tipo === "venta").map((m) => ({ ...m, centavos: aCentavos(m.monto), usada: false }));
  const cancelaciones = getnet.filter((m) => m.tipo === "cancelacion").map((m) => ({ ...m, centavos: aCentavos(m.monto) }));

  // Una cancelación anula UNA venta del mismo monto (la más antigua que
  // siga sin anular); esa venta ya no debe encontrar pareja en el sistema.
  const anuladas: typeof cancelaciones = [];
  const cancelacionesSueltas: typeof cancelaciones = [];
  for (const c of cancelaciones) {
    const venta = ventas.find((v) => !v.usada && v.centavos === c.centavos);
    if (venta) {
      venta.usada = true;
      anuladas.push(c);
    } else {
      cancelacionesSueltas.push(c);
    }
  }

  const totalGetnetCentavos =
    ventas.reduce((s, v) => s + v.centavos, 0) - cancelaciones.reduce((s, c) => s + c.centavos, 0);
  const totalSistemaCentavos = sistema.reduce((s, m) => s + aCentavos(m.total), 0);

  const pendientesSistema = sistema.map((m) => ({ ...m, centavos: aCentavos(m.total), usada: false }));
  const coinciden: ParejaConciliada[] = [];
  const soloGetnet: ResultadoConciliacion["soloGetnet"] = [];
  for (const v of ventas) {
    if (v.usada) continue;
    const pareja = pendientesSistema.find((m) => !m.usada && m.centavos === v.centavos);
    if (pareja) {
      pareja.usada = true;
      coinciden.push({ folio: pareja.folio, nombre: pareja.nombre, monto: aPesos(v.centavos), autorizacion: v.autorizacion, hora: v.hora ?? pareja.hora });
    } else {
      soloGetnet.push({ monto: aPesos(v.centavos), autorizacion: v.autorizacion, hora: v.hora });
    }
  }
  // Una cancelación sin venta del mismo monto (de otro día, o de un
  // cobro que no está aquí) cuenta como diferencia, en negativo.
  for (const c of cancelacionesSueltas) soloGetnet.push({ monto: -aPesos(c.centavos), autorizacion: c.autorizacion, hora: c.hora });
  const soloSistema = pendientesSistema
    .filter((m) => !m.usada)
    .map((m) => ({ folio: m.folio, nombre: m.nombre, monto: aPesos(m.centavos), hora: m.hora }));

  const diferenciaCentavos = totalGetnetCentavos - totalSistemaCentavos;
  return {
    totalSistema: aPesos(totalSistemaCentavos),
    totalGetnet: aPesos(totalGetnetCentavos),
    diferencia: aPesos(diferenciaCentavos),
    movimientosSistema: sistema.length,
    movimientosGetnet: getnet.length,
    coinciden,
    soloSistema,
    soloGetnet,
    cancelaciones: anuladas.map((c) => ({ monto: aPesos(c.centavos), autorizacion: c.autorizacion, hora: c.hora })),
    cuadra: diferenciaCentavos === 0 && soloSistema.length === 0 && soloGetnet.length === 0,
  };
}

/** Cobro con tarjeta del sistema, con lo que hace falta para fijar su huella. */
export interface CobroParaHuella {
  id: string;
  total: number;
  /** Fecha efectiva (pago o creación) en ISO, tal como la entrega PostgreSQL. */
  fechaEfectiva: string;
  formaPago: string;
}

/** Huella SHA-256 de los cobros: cualquier cambio de importe, de fecha, de
 * forma de pago, o que entre o salga un cobro, la cambia — incluso si la
 * suma y la cantidad quedan iguales (150+150 en lugar de 100+200). */
export function huellaDeCobros(cobros: CobroParaHuella[]): string {
  const lineas = cobros.map((c) => `${c.id}|${aCentavos(c.total)}|${c.fechaEfectiva}|${c.formaPago}`).sort();
  return createHash("sha256").update(lineas.join("\n")).digest("hex");
}
