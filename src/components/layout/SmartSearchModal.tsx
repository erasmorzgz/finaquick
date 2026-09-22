import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Receipt, Banknote, CreditCard, ClipboardList, TrendingUp, ArrowRight, ArrowUpRight, ArrowDownRight, Minus, Wallet, UserRound, Download, SendHorizontal } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Avatar, Badge, EmptyState } from "../ui/Misc";
import { useService } from "../../lib/service/ServiceContext";
import { useOrg } from "../../lib/theme/OrgContext";
import * as db from "../../lib/db";
import type { Procedimiento, Requisicion, Ticket } from "../../lib/db/types";
import { fechaEfectiva, fechaLocal, mesLocal } from "../../lib/fechaFolio";
import { interpretarConsulta, esSaludo, type Consulta } from "../../lib/smartSearch";
import { formatoMXN, generarCSV, descargarTexto } from "../../lib/utils";
import type { Grafica, PuntoGrafica } from "./QuickChart";

// recharts (grande) solo se descarga la primera vez que de verdad se
// pide una gráfica — ver el comentario en QuickChart.tsx.
const QuickChart = lazy(() => import("./QuickChart"));

const FORMATO_MES = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
const FORMATO_MES_CORTO = new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit" });
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

// Respuesta fija a un saludo cuando NO hay IA configurada (con IA, el
// propio chat libre ya contesta un saludo de forma natural — esto es
// solo la red de seguridad sin proveedor). Una nada más, no una lista
// al azar: no hay nada que "variar" en un saludo tan corto, y variarlo
// solo complicaría el código sin que se note la diferencia.
const RESPUESTA_SALUDO_SIN_IA =
  "¡Hola! Soy Quick. Puedo ayudarte con tus datos de folios y finanzas — pregúntame algo como \"cuánto cobré ayer\", \"resumen de este mes\" o \"folios de Ana García\".";

type DesgloseCorte = { total: number; grupos: { etiqueta: string; icono: typeof Banknote; tickets: Ticket[]; subtotal: number }[] };
type ResumenMes = { total: number; folios: number; top: { nombre: string; cantidad: number; total: number }[] };
type ResultadosBusqueda = (Ticket & { servicioNombre: string })[];
type Estadistica = {
  total: number;
  folios: number;
  promedio: number;
  top: { nombre: string; cantidad: number; total: number }[];
  porForma: { etiqueta: string; icono: typeof Banknote; cantidad: number; subtotal: number }[];
};
type Comparacion = { mesA: string; mesB: string; totalA: number; totalB: number; deltaPct: number | null };
type Creditos = { total: number; folios: number; top: { nombre: string; folio: string; total: number }[] };
type Persona = { nombre: string; totalPagado: number; foliosPagados: number; pendiente: number; foliosPendientes: number };
// Sin agruparPor, `filas` trae una sola entrada ("Total"). Con
// agruparPor, hasta 10 filas ordenadas de mayor a menor — el resto del
// desglose sigue disponible en el CSV.
type Libre = { filas: { etiqueta: string; valor: number }[]; folios: number; agrupado: boolean; metrica: string };

interface MensajeUsuario {
  id: string;
  rol: "usuario";
  texto: string;
}
interface MensajeAsistente {
  id: string;
  rol: "asistente";
  cargando: boolean;
  consulta?: Consulta;
  desglose?: DesgloseCorte;
  resumen?: ResumenMes;
  resultados?: ResultadosBusqueda;
  estadistica?: Estadistica;
  grafica?: Grafica;
  comparacion?: Comparacion;
  creditos?: Creditos;
  persona?: Persona;
  libre?: Libre;
  // Redactada por Gemini a partir de un resumen ya calculado (ver
  // db.narrarResultado) — llega un momento después de que el resto de
  // la respuesta ya se muestra, y reemplaza solo la frase de
  // introducción fija. Si nunca llega (sin IA, o el proveedor falla),
  // la frase fija de siempre se queda tal cual — nunca bloquea nada.
  narracion?: string;
  // Respuesta del chat libre (ver db.chatLibre): Gemini contestó
  // directamente, con sus propias palabras, a partir de un resumen ya
  // agregado — sin pasar por ninguna de las nueve formas de arriba.
  // Cuando este campo existe, la respuesta se muestra como texto
  // normal de chat, no como tarjeta de datos.
  respuestaLibre?: string;
  digesto?: Record<string, unknown>;
}
type Mensaje = MensajeUsuario | MensajeAsistente;

function calcularDesgloseCorte(tickets: Ticket[]): DesgloseCorte {
  const efectivo = tickets.filter((t) => (t.formaPago ?? "Efectivo") === "Efectivo");
  const debito = tickets.filter((t) => t.formaPago === "Tarjeta de débito");
  const credito = tickets.filter((t) => t.formaPago === "Tarjeta de crédito");
  const suma = (lista: Ticket[]) => lista.reduce((s, t) => s + t.total, 0);
  return {
    total: suma(tickets),
    grupos: [
      { etiqueta: "Efectivo", icono: Banknote, tickets: efectivo, subtotal: suma(efectivo) },
      { etiqueta: "Tarjeta de débito", icono: CreditCard, tickets: debito, subtotal: suma(debito) },
      { etiqueta: "Tarjeta de crédito", icono: CreditCard, tickets: credito, subtotal: suma(credito) },
    ].filter((g) => g.tickets.length > 0),
  };
}

function calcularResumenMes(tickets: Ticket[]): ResumenMes {
  const total = tickets.reduce((s, t) => s + t.total, 0);
  const porProcedimiento = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const t of tickets) {
    for (const p of t.procedimientos) {
      const actual = porProcedimiento.get(p.nombre) ?? { nombre: p.nombre, cantidad: 0, total: 0 };
      actual.cantidad += 1;
      actual.total += p.costo;
      porProcedimiento.set(p.nombre, actual);
    }
  }
  return { total, folios: tickets.length, top: Array.from(porProcedimiento.values()).sort((a, b) => b.total - a.total).slice(0, 5) };
}

function calcularEstadistica(tickets: Ticket[]): Estadistica {
  const total = tickets.reduce((s, t) => s + t.total, 0);
  const folios = tickets.length;

  const porProcedimiento = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const t of tickets) {
    for (const p of t.procedimientos) {
      const actual = porProcedimiento.get(p.nombre) ?? { nombre: p.nombre, cantidad: 0, total: 0 };
      actual.cantidad += 1;
      actual.total += p.costo;
      porProcedimiento.set(p.nombre, actual);
    }
  }

  const efectivo = tickets.filter((t) => (t.formaPago ?? "Efectivo") === "Efectivo");
  const debito = tickets.filter((t) => t.formaPago === "Tarjeta de débito");
  const credito = tickets.filter((t) => t.formaPago === "Tarjeta de crédito");
  const suma = (lista: Ticket[]) => lista.reduce((s, t) => s + t.total, 0);

  return {
    total,
    folios,
    promedio: folios > 0 ? total / folios : 0,
    top: Array.from(porProcedimiento.values()).sort((a, b) => b.total - a.total).slice(0, 5),
    porForma: [
      { etiqueta: "Efectivo", icono: Banknote, cantidad: efectivo.length, subtotal: suma(efectivo) },
      { etiqueta: "Tarjeta de débito", icono: CreditCard, cantidad: debito.length, subtotal: suma(debito) },
      { etiqueta: "Tarjeta de crédito", icono: CreditCard, cantidad: credito.length, subtotal: suma(credito) },
    ].filter((g) => g.cantidad > 0),
  };
}

function sumaMes(tickets: Ticket[], mes: string): number {
  return tickets.filter((t) => t.estado === "pagado" && mesLocal(fechaEfectiva(t)) === mes).reduce((s, t) => s + t.total, 0);
}

/** Ajuste lineal simple (mínimos cuadrados) sobre los totales
 * mensuales ya calculados — el único cálculo detrás de la proyección,
 * siempre con los números reales de la propia cuenta. El modelo de IA
 * nunca ve estos valores ni los toca: solo decidió, al clasificar la
 * pregunta, que hacía falta una proyección — el número lo calcula este
 * código. Con menos de dos meses de historial no hay tendencia que
 * calcular, así que no se proyecta nada en vez de inventar un número.
 * Nunca baja de cero: un ingreso negativo no tiene sentido aunque la
 * tendencia sea decreciente. */
function proyectarSiguientes(valores: number[], cuantos: number): number[] {
  const n = valores.length;
  if (n < 2) return [];
  const sumaX = valores.reduce((s, _v, i) => s + i, 0);
  const sumaY = valores.reduce((s, v) => s + v, 0);
  const sumaXY = valores.reduce((s, v, i) => s + i * v, 0);
  const sumaX2 = valores.reduce((s, _v, i) => s + i * i, 0);
  const denominador = n * sumaX2 - sumaX * sumaX;
  const pendiente = denominador === 0 ? 0 : (n * sumaXY - sumaX * sumaY) / denominador;
  const interseccion = (sumaY - pendiente * sumaX) / n;
  return Array.from({ length: cuantos }, (_, i) => Math.max(0, pendiente * (n + i) + interseccion));
}

// Proyecta siempre 2 meses hacia adelante cuando se pide — ni tan
// poco que no se note, ni tanto que se sienta como una promesa de
// largo plazo a partir de solo unos meses de historial.
const MESES_A_PROYECTAR = 2;

function calcularGrafica(tickets: Ticket[], meses: number, proyectar: boolean): Grafica {
  const ahora = new Date();
  const historico: PuntoGrafica[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    historico.push({ mes, label: FORMATO_MES_CORTO.format(d), total: sumaMes(tickets, mes) });
  }

  let proyeccion: PuntoGrafica[] = [];
  if (proyectar) {
    const estimados = proyectarSiguientes(historico.map((p) => p.total ?? 0), MESES_A_PROYECTAR);
    proyeccion = estimados.map((valor, i) => {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() + i + 1, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { mes, label: FORMATO_MES_CORTO.format(d), estimado: Math.round(valor) };
    });
  }

  return { historico, proyeccion };
}

function calcularComparacion(tickets: Ticket[], mesA: string, mesB: string): Comparacion {
  const totalA = sumaMes(tickets, mesA);
  const totalB = sumaMes(tickets, mesB);
  return { mesA, mesB, totalA, totalB, deltaPct: totalB > 0 ? ((totalA - totalB) / totalB) * 100 : null };
}

function calcularCreditos(tickets: Ticket[]): Creditos {
  const pendientes = tickets.filter((t) => t.estado === "credito");
  return {
    total: pendientes.reduce((s, t) => s + t.total, 0),
    folios: pendientes.length,
    top: [...pendientes].sort((a, b) => b.total - a.total).slice(0, 5).map((t) => ({ nombre: t.nombre, folio: t.folio, total: t.total })),
  };
}

function calcularPersona(tickets: Ticket[], nombreBuscado: string): Persona {
  const buscado = nombreBuscado.toLowerCase();
  const coincidencias = tickets.filter((t) => t.nombre.toLowerCase().includes(buscado));
  const pagados = coincidencias.filter((t) => t.estado === "pagado");
  const pendientes = coincidencias.filter((t) => t.estado === "credito");
  return {
    nombre: nombreBuscado,
    totalPagado: pagados.reduce((s, t) => s + t.total, 0),
    foliosPagados: pagados.length,
    pendiente: pendientes.reduce((s, t) => s + t.total, 0),
    foliosPendientes: pendientes.length,
  };
}

/** Un nombre propio ("de Ana García", "a Juan Pérez") dentro de la
 * pregunta tal como la escribieron (con mayúsculas) — heurística
 * simple, a propósito: si no encuentra nada, el chat libre solo se
 * queda sin ese dato extra, no rompe nada. */
function posibleNombreEnPregunta(textoOriginal: string): string | null {
  const m = textoOriginal.match(/\b(?:de|a)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/);
  return m ? m[1].trim() : null;
}

/** El resumen que se le manda a Gemini para el chat libre — sobre todo
 * totales ya agregados (por mes, categoría, forma de pago,
 * procedimiento), más una lista de folios individuales recientes con
 * nombre real (`foliosDetalle`, ver abajo) para preguntas que de
 * verdad necesitan el detalle ("quién no ha pagado", "los folios de
 * esta semana con nombre"). Pedido explícito: que Quick pueda ver
 * folios y nombres cuando la pregunta lo amerite, con las mismas
 * restricciones de acceso que ya tiene el resto de la app — que es
 * justo lo que pasa aquí sin código nuevo para eso: `tickets` es el
 * mismo arreglo que ya cargó el navegador para ESTE servicio, con el
 * mismo acceso que ya tiene la sesión actual (RLS del servidor +
 * service_access) — un "personal" con acceso a un solo servicio jamás
 * tiene folios de otro servicio en este arreglo para empezar, así que
 * Quick tampoco puede mostrárselos. Nada de esto amplía lo que esa
 * sesión ya podía ver en el resto de la app — solo deja que Quick lo
 * use para contestar, en vez de que la persona lo busque a mano. */
function construirDigesto(
  tickets: Ticket[],
  procedimientosCatalogo: Procedimiento[],
  requisiciones: Requisicion[],
  preguntaOriginal: string
): Record<string, unknown> {
  const ahora = new Date();
  const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
  const mesAnteriorDate = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const mesAnterior = `${mesAnteriorDate.getFullYear()}-${String(mesAnteriorDate.getMonth() + 1).padStart(2, "0")}`;
  const anioActual = String(ahora.getFullYear());
  const hoyStr = fechaLocal(ahora.toISOString());

  const pagados = tickets.filter((t) => t.estado === "pagado");
  const deMes = (mes: string) => pagados.filter((t) => mesLocal(fechaEfectiva(t)) === mes);
  const esteMesTickets = deMes(mesActual);
  const mesAnteriorTickets = deMes(mesAnterior);
  const esteAnioTickets = pagados.filter((t) => mesLocal(fechaEfectiva(t)).startsWith(anioActual));
  const deHoyTickets = pagados.filter((t) => fechaLocal(fechaEfectiva(t)) === hoyStr);
  const sumaTotal = (lista: Ticket[]) => lista.reduce((s, t) => s + t.total, 0);

  const ultimos12Meses: { mes: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ultimos12Meses.push({ mes, total: sumaMes(tickets, mes) });
  }

  const porFormaPagoMapa = new Map<string, number>();
  const porCategoriaMapa = new Map<string, number>();
  const porProcedimientoMapa = new Map<string, number>();
  for (const t of esteAnioTickets) {
    const forma = t.formaPago ?? "Efectivo";
    porFormaPagoMapa.set(forma, (porFormaPagoMapa.get(forma) ?? 0) + t.total);
    porCategoriaMapa.set(t.categoria, (porCategoriaMapa.get(t.categoria) ?? 0) + t.total);
    for (const p of t.procedimientos) {
      porProcedimientoMapa.set(p.nombre, (porProcedimientoMapa.get(p.nombre) ?? 0) + p.costo);
    }
  }
  const top = (mapa: Map<string, number>, n: number) =>
    Array.from(mapa.entries())
      .map(([etiqueta, total]) => ({ etiqueta, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, n);

  const creditos = tickets.filter((t) => t.estado === "credito");

  // Tendencia mensual (últimos 6 meses) de las 5 categorías y los 5
  // procedimientos con más ingresos este año — la base para que Gemini
  // pueda dar una aproximación a futuro de algo específico ("tal
  // procedimiento", "tal categoría"), no solo del total general.
  const ultimos6Meses: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    ultimos6Meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const sumaMesCategoria = (categoria: string, mes: string) =>
    tickets
      .filter((t) => t.estado === "pagado" && mesLocal(fechaEfectiva(t)) === mes && t.categoria === categoria)
      .reduce((s, t) => s + t.total, 0);
  const sumaMesProcedimiento = (nombreProcedimiento: string, mes: string) => {
    let total = 0;
    for (const t of tickets) {
      if (t.estado !== "pagado" || mesLocal(fechaEfectiva(t)) !== mes) continue;
      for (const p of t.procedimientos) if (p.nombre === nombreProcedimiento) total += p.costo;
    }
    return total;
  };
  const tendenciaPorCategoria = top(porCategoriaMapa, 5).map(({ etiqueta }) => ({
    etiqueta,
    meses: ultimos6Meses.map((mes) => ({ mes, total: sumaMesCategoria(etiqueta, mes) })),
  }));
  const tendenciaPorProcedimiento = top(porProcedimientoMapa, 5).map(({ etiqueta }) => ({
    etiqueta,
    meses: ultimos6Meses.map((mes) => ({ mes, total: sumaMesProcedimiento(etiqueta, mes) })),
  }));

  const reqEsteMes = requisiciones.filter((r) => mesLocal(r.creadoEn) === mesActual);

  // Folios individuales recientes, con nombre real — para preguntas
  // que de verdad necesitan el detalle ("quién no ha pagado", "los
  // folios de esta semana con nombre"), no solo un total. Capado a los
  // 300 más recientes (pagados + en crédito) — no toda la historia de
  // un jalón, por tamaño y por costo real de cada pregunta a Gemini;
  // el histórico completo sigue disponible como agregados arriba
  // (ultimos12Meses, tendencias). Mismo alcance que el resto del
  // resumen: viene de `tickets`, ya acotado por la sesión actual.
  const LIMITE_FOLIOS_DETALLE = 300;
  const foliosDetalle = [...tickets]
    .filter((t) => t.estado === "pagado" || t.estado === "credito")
    .sort((a, b) => (fechaEfectiva(a) < fechaEfectiva(b) ? 1 : -1))
    .slice(0, LIMITE_FOLIOS_DETALLE)
    .map((t) => ({
      folio: t.folio,
      nombre: t.nombre,
      fecha: fechaEfectiva(t),
      categoria: t.categoria,
      total: t.total,
      estado: t.estado,
      formaPago: t.formaPago ?? null,
    }));

  const digesto: Record<string, unknown> = {
    hoy: hoyStr,
    resumenHoy: { total: sumaTotal(deHoyTickets), folios: deHoyTickets.length },
    esteMes: { mes: mesActual, total: sumaTotal(esteMesTickets), folios: esteMesTickets.length },
    mesPasado: { mes: mesAnterior, total: sumaTotal(mesAnteriorTickets), folios: mesAnteriorTickets.length },
    esteAnio: { total: sumaTotal(esteAnioTickets), folios: esteAnioTickets.length },
    ultimos12Meses,
    porFormaPago: top(porFormaPagoMapa, 5),
    topProcedimientos: top(porProcedimientoMapa, 5),
    topCategorias: top(porCategoriaMapa, 5),
    tendenciaPorCategoria,
    tendenciaPorProcedimiento,
    catalogoProcedimientos: procedimientosCatalogo.slice(0, 60).map((p) => ({ nombre: p.nombre, precio: p.precio })),
    foliosDetalle,
    creditosPendientes: { total: sumaTotal(creditos), folios: creditos.length },
    requisiciones: {
      pendientes: reqEsteMes.filter((r) => r.estado === "pendiente").length,
      aprobadas: reqEsteMes.filter((r) => r.estado === "aprobada").length,
      rechazadas: reqEsteMes.filter((r) => r.estado === "rechazada").length,
      esteMes: reqEsteMes.length,
      conceptosEsteMes: reqEsteMes.slice(0, 10).map((r) => r.concepto),
    },
  };

  const nombre = posibleNombreEnPregunta(preguntaOriginal);
  if (nombre) {
    digesto.personaMencionada = calcularPersona(tickets, nombre);
  }

  return digesto;
}

const ETIQUETA_METRICA: Record<string, string> = {
  total: "Total",
  conteo: "Folios",
  promedio: "Promedio",
  maximo: "Máximo",
  minimo: "Mínimo",
};

/** El comodín: filtra los folios pagados del rango por nombre/forma de
 * pago/categoría (los que se hayan pedido), y agrega el resultado —
 * en un solo número si no se pidió agrupar, o en hasta 10 filas
 * ordenadas de mayor a menor si sí. "conteo" cuenta cuántos valores
 * entraron a la agregación (tickets, o instancias de procedimiento),
 * que es justo el largo del arreglo que ya se le pasa a `agregar`. */
function calcularLibre(tickets: Ticket[], c: Extract<Consulta, { tipo: "libre" }>): Libre {
  let filtrados = tickets.filter(
    (t) => t.estado === "pagado" && fechaLocal(fechaEfectiva(t)) >= c.desde && fechaLocal(fechaEfectiva(t)) <= c.hasta
  );
  if (c.nombre) {
    const buscado = c.nombre.toLowerCase();
    filtrados = filtrados.filter((t) => t.nombre.toLowerCase().includes(buscado));
  }
  if (c.formaPago) {
    filtrados = filtrados.filter((t) => (t.formaPago ?? "Efectivo") === c.formaPago);
  }
  if (c.categoria) {
    const buscado = c.categoria.toLowerCase();
    filtrados = filtrados.filter((t) => t.categoria.toLowerCase().includes(buscado));
  }

  function agregar(valores: number[]): number {
    if (valores.length === 0) return 0;
    if (c.metrica === "conteo") return valores.length;
    if (c.metrica === "promedio") return valores.reduce((s, v) => s + v, 0) / valores.length;
    if (c.metrica === "maximo") return Math.max(...valores);
    if (c.metrica === "minimo") return Math.min(...valores);
    return valores.reduce((s, v) => s + v, 0);
  }

  if (!c.agruparPor) {
    const valor = agregar(filtrados.map((t) => t.total));
    return { filas: [{ etiqueta: "Total", valor }], folios: filtrados.length, agrupado: false, metrica: c.metrica };
  }

  if (c.agruparPor === "procedimiento") {
    const porProcedimiento = new Map<string, number[]>();
    for (const t of filtrados) {
      for (const p of t.procedimientos) {
        porProcedimiento.set(p.nombre, [...(porProcedimiento.get(p.nombre) ?? []), p.costo]);
      }
    }
    const filas = Array.from(porProcedimiento.entries())
      .map(([etiqueta, valores]) => ({ etiqueta, valor: agregar(valores) }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
    return { filas, folios: filtrados.length, agrupado: true, metrica: c.metrica };
  }

  const grupos = new Map<string, Ticket[]>();
  for (const t of filtrados) {
    const clave = c.agruparPor === "dia" ? fechaLocal(fechaEfectiva(t)) : c.agruparPor === "categoria" ? t.categoria : t.formaPago ?? "Efectivo";
    grupos.set(clave, [...(grupos.get(clave) ?? []), t]);
  }
  const filas = Array.from(grupos.entries())
    .map(([etiqueta, lista]) => ({ etiqueta, valor: agregar(lista.map((t) => t.total)) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10);
  return { filas, folios: filtrados.length, agrupado: true, metrica: c.metrica };
}

function formatoEtiquetaLibre(etiqueta: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(etiqueta) ? FORMATO_FECHA_LARGA.format(new Date(etiqueta + "T00:00:00")) : etiqueta;
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function descargarCorte(fecha: string, d: DesgloseCorte) {
  const filas: (string | number)[][] = [];
  for (const g of d.grupos) {
    for (const t of g.tickets) filas.push([t.folio, t.nombre, g.etiqueta, t.total]);
    filas.push(["", "", `Subtotal ${g.etiqueta}`, g.subtotal]);
  }
  filas.push(["", "", "Total del día", d.total]);
  descargarTexto(`cierre-de-caja-${fecha}.csv`, generarCSV(["Folio", "Nombre", "Forma de pago", "Total"], filas));
}

function descargarResumen(mes: string, r: ResumenMes) {
  const filas: (string | number)[][] = r.top.map((p) => [p.nombre, p.cantidad, p.total]);
  filas.push(["", "Total", r.total]);
  descargarTexto(`resumen-${mes}.csv`, generarCSV(["Procedimiento", "Cantidad", "Total"], filas));
}

function descargarBusqueda(texto: string, resultados: ResultadosBusqueda) {
  const filas = resultados.map((t) => [t.folio, t.nombre, t.servicioNombre, t.estado === "credito" ? "Crédito" : "Pagado", t.total]);
  descargarTexto(`busqueda-${slug(texto) || "resultados"}.csv`, generarCSV(["Folio", "Nombre", "Servicio", "Estado", "Total"], filas));
}

// Un folio suelto, listo para bajar de inmediato desde un resultado de
// búsqueda — sin tener que pasar por el CSV de todos los resultados
// juntos cuando lo que alguien pidió fue justo ese folio.
function descargarUnFolio(t: Ticket & { servicioNombre: string }) {
  const filas = t.procedimientos.map((p) => [p.nombre, p.costo]);
  filas.push(["Total", t.total]);
  descargarTexto(
    `folio-${slug(t.folio)}.csv`,
    generarCSV(["Concepto", "Costo"], [
      ["Folio", t.folio],
      ["Nombre", t.nombre],
      ["Servicio", t.servicioNombre],
      ["Categoría", t.categoria],
      ["Estado", t.estado === "credito" ? "Crédito" : "Pagado"],
      ["Forma de pago", t.formaPago ?? "—"],
      ["Fecha", new Date(fechaEfectiva(t)).toLocaleDateString("es-MX")],
      [],
      ...filas,
    ])
  );
}

function descargarEstadistica(desde: string, hasta: string, e: Estadistica) {
  const filas: (string | number)[][] = [["Total", e.total], ["Folios", e.folios], ["Promedio por folio", e.promedio]];
  if (e.top.length > 0) {
    filas.push([]);
    filas.push(["Procedimiento", "Cantidad", "Total"]);
    for (const p of e.top) filas.push([p.nombre, p.cantidad, p.total]);
  }
  if (e.porForma.length > 0) {
    filas.push([]);
    filas.push(["Forma de pago", "Cantidad", "Total"]);
    for (const g of e.porForma) filas.push([g.etiqueta, g.cantidad, g.subtotal]);
  }
  descargarTexto(`estadisticas-${desde}-a-${hasta}.csv`, generarCSV(["Campo", "Valor", ""], filas));
}

function descargarGrafica(g: Grafica) {
  const filas: (string | number)[][] = g.historico.map((p) => [p.label, p.total ?? 0, "Real"]);
  for (const p of g.proyeccion) filas.push([p.label, p.estimado ?? 0, "Estimado"]);
  descargarTexto("grafica-ingresos.csv", generarCSV(["Mes", "Total", "Tipo"], filas));
}

function descargarComparacion(c: Comparacion) {
  descargarTexto(
    `comparacion-${c.mesA}-vs-${c.mesB}.csv`,
    generarCSV(["Mes", "Total"], [[c.mesB, c.totalB], [c.mesA, c.totalA]])
  );
}

function descargarCreditos(cr: Creditos) {
  const filas: (string | number)[][] = cr.top.map((t) => [t.folio, t.nombre, t.total]);
  filas.push(["", "Total pendiente", cr.total]);
  descargarTexto("creditos-pendientes.csv", generarCSV(["Folio", "Nombre", "Total"], filas));
}

function descargarPersona(p: Persona) {
  descargarTexto(
    `persona-${slug(p.nombre) || "resultado"}.csv`,
    generarCSV(["Campo", "Valor"], [
      ["Nombre", p.nombre],
      ["Total pagado", p.totalPagado],
      ["Folios pagados", p.foliosPagados],
      ["Pendiente (crédito)", p.pendiente],
      ["Folios pendientes", p.foliosPendientes],
    ])
  );
}

function descargarLibre(l: Libre) {
  descargarTexto("consulta.csv", generarCSV(["Concepto", ETIQUETA_METRICA[l.metrica] ?? "Valor"], l.filas.map((f) => [f.etiqueta, f.valor])));
}

/** El mismo resumen que se le mandó a Gemini para el chat libre,
 * aplanado a filas — así quien pregunta puede revisar exactamente con
 * qué números se armó la respuesta. */
function descargarDigesto(d: Record<string, unknown>) {
  const filas: (string | number)[][] = [];
  const aplanar = (valor: unknown, prefijo: string) => {
    if (Array.isArray(valor)) {
      for (const item of valor) aplanar(item, prefijo);
    } else if (valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) aplanar(v, prefijo ? `${prefijo} · ${k}` : k);
    } else {
      filas.push([prefijo, String(valor)]);
    }
  };
  for (const [clave, valor] of Object.entries(d)) aplanar(valor, clave);
  descargarTexto("resumen-de-datos.csv", generarCSV(["Concepto", "Valor"], filas));
}

// Quick — el asistente de chat de Finaquick para tus propios datos
// (folios, cortes de caja, resúmenes, estadísticas, gráficas con
// proyección a futuro). Nunca modifica nada, no acepta archivos, y
// cada respuesta se puede descargar como CSV. Cuando el servidor tiene
// Gemini configurado (ver servidor/api/src/asistente.ts), Quick
// entiende preguntas libres de dos formas distintas:
//   - Clasificación (interpretarConIA): el modelo SOLO clasifica la
//     pregunta en una de las nueve formas fijas de ConsultaIA — nunca
//     ve datos reales, nunca genera ninguna consulta ni el número de
//     una proyección (eso lo calcula este archivo, con los tickets ya
//     cargados).
//   - Chat libre (responderChatLibre): el modelo SÍ recibe un resumen
//     con datos reales — agregados, más folios individuales recientes
//     con nombre (foliosDetalle, ver construirDigesto) — para poder
//     contestar preguntas que necesitan el detalle, no solo un total.
//     Nunca es MÁS de lo que la propia sesión ya podía ver en el resto
//     de la app — mismo alcance, mismas políticas de seguridad de
//     siempre.
// Con preguntas de seguimiento ("¿y el mes pasado?") gracias al
// historial de la propia conversación que se le manda como contexto;
// sin IA configurada, entiende un buen puñado de patrones comunes por
// su cuenta (src/lib/smartSearch.ts), sin memoria de conversación —
// para cualquier otra cosa, cae de vuelta a buscar por folio o nombre.
export function SmartSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { servicioActual } = useService();
  const { org } = useOrg();
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setTexto("");
  }, [open]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes]);

  async function enviar() {
    const pregunta = texto.trim();
    if (!pregunta || !org) return;
    setTexto("");
    const idUsuario = crypto.randomUUID();
    const idAsistente = crypto.randomUUID();
    setMensajes((m) => [...m, { id: idUsuario, rol: "usuario", texto: pregunta }, { id: idAsistente, rol: "asistente", cargando: true }]);

    // Las últimas preguntas de esta misma conversación (nunca las
    // respuestas ni datos reales) — así "¿y el mes pasado?" se puede
    // resolver sin repetir todo el contexto. Se lee de `mensajes` tal
    // como está ANTES de agregar esta pregunta nueva, que es
    // justamente "lo anterior". Solo tiene efecto con IA configurada;
    // la búsqueda por patrones no tiene memoria de conversación.
    const historial = mensajes
      .filter((msg): msg is MensajeUsuario => msg.rol === "usuario")
      .slice(-5)
      .map((msg) => msg.texto);

    // Tickets, catálogo de procedimientos (con precios) y requisiciones
    // del servicio actual — las tres fuentes que arman el resumen del
    // chat libre. listarRequisiciones funciona igual esté o no
    // habilitada la función en este servicio (el flag solo controla si
    // aparece en el menú); si de plano nunca se usa, solo regresa una
    // lista vacía, que el resumen refleja como "sin requisiciones".
    const [tickets, procedimientosCatalogo, requisiciones] = servicioActual
      ? await Promise.all([
          db.listarTickets(servicioActual.id),
          db.listarProcedimientos(servicioActual.id),
          db.listarRequisiciones(servicioActual.id).catch(() => []),
        ])
      : [[], [], []];

    // Primero intenta el chat libre: le mandamos a Gemini un resumen ya
    // agregado de la cuenta (nunca folios ni nombres de estudiantes) y
    // dejamos que conteste con sus propias palabras, sin pasar primero
    // por ninguna clasificación fija — así entiende preguntas compuestas
    // o con una redacción que ninguna de las nueve formas de abajo
    // anticipa. Sin IA configurada, o si Gemini falla, chatLibre
    // regresa null sin lanzar, y aquí se cae de vuelta al flujo de
    // clasificación de siempre (que sigue intacto como red de
    // seguridad, con sus tarjetas y descargas).
    const digesto = construirDigesto(tickets, procedimientosCatalogo, requisiciones, pregunta);
    const respuestaLibre = await db.chatLibre(pregunta, historial, digesto);
    if (respuestaLibre) {
      const actualizado: MensajeAsistente = { id: idAsistente, rol: "asistente", cargando: false, respuestaLibre, digesto };
      setMensajes((m) => m.map((msg) => (msg.id === idAsistente ? actualizado : msg)));
      return;
    }

    // Sin IA (o si Gemini falló), un saludo no debería caer en el
    // flujo de clasificación de datos — "hola" no es una pregunta de
    // folios, y mostrar "Sin resultados" para eso se siente como una
    // caja de búsqueda rota, no como un chat. Misma forma de mensaje
    // que respuestaLibre (texto normal de chat), solo que fija —
    // ningún proveedor externo de por medio.
    if (esSaludo(pregunta)) {
      const actualizado: MensajeAsistente = { id: idAsistente, rol: "asistente", cargando: false, respuestaLibre: RESPUESTA_SALUDO_SIN_IA };
      setMensajes((m) => m.map((msg) => (msg.id === idAsistente ? actualizado : msg)));
      return;
    }

    const c = (await db.interpretarConsultaIA(pregunta, historial)) ?? interpretarConsulta(pregunta);

    let actualizado: MensajeAsistente = { id: idAsistente, rol: "asistente", cargando: false, consulta: c };
    // Resumen chico y ya agregado (solo números/etiquetas, nunca
    // nombres de personas ni listas de folios) que se le manda a Gemini
    // para redactar la respuesta en prosa — ver db.narrarResultado.
    // "busqueda" nunca pasa por aquí porque sus resultados sí traen
    // nombres reales.
    let resumenSeguro: Record<string, unknown> | null = null;
    if (c.tipo === "corte") {
      const delDia = tickets.filter((t) => t.estado === "pagado" && fechaLocal(fechaEfectiva(t)) === c.fecha);
      const d = calcularDesgloseCorte(delDia);
      actualizado = { ...actualizado, desglose: d };
      resumenSeguro = { fecha: c.fecha, total: d.total, folios: delDia.length };
    } else if (c.tipo === "resumen") {
      const delMes = tickets.filter((t) => t.estado === "pagado" && mesLocal(fechaEfectiva(t)) === c.mes);
      const r = calcularResumenMes(delMes);
      actualizado = { ...actualizado, resumen: r };
      resumenSeguro = { mes: c.mes, total: r.total, folios: r.folios, topProcedimiento: r.top[0]?.nombre ?? null };
    } else if (c.tipo === "estadistica") {
      const delRango = tickets.filter(
        (t) => t.estado === "pagado" && fechaLocal(fechaEfectiva(t)) >= c.desde && fechaLocal(fechaEfectiva(t)) <= c.hasta
      );
      const e = calcularEstadistica(delRango);
      actualizado = { ...actualizado, estadistica: e };
      resumenSeguro = { metrica: c.metrica, desde: c.desde, hasta: c.hasta, total: e.total, folios: e.folios, promedio: Math.round(e.promedio) };
    } else if (c.tipo === "grafica") {
      const g = calcularGrafica(tickets, c.meses, c.proyectar);
      actualizado = { ...actualizado, grafica: g };
      const ultimo = g.historico[g.historico.length - 1];
      resumenSeguro = {
        meses: c.meses,
        proyectar: c.proyectar,
        ultimoMes: ultimo?.label ?? null,
        ultimoTotal: ultimo?.total ?? 0,
        mesesProyectados: g.proyeccion.map((p) => p.label),
        valoresProyectados: g.proyeccion.map((p) => p.estimado ?? 0),
      };
    } else if (c.tipo === "comparacion") {
      const comp = calcularComparacion(tickets, c.mesA, c.mesB);
      actualizado = { ...actualizado, comparacion: comp };
      resumenSeguro = { mesA: comp.mesA, mesB: comp.mesB, totalA: comp.totalA, totalB: comp.totalB, deltaPct: comp.deltaPct !== null ? Math.round(comp.deltaPct) : null };
    } else if (c.tipo === "creditos") {
      const cr = calcularCreditos(tickets);
      actualizado = { ...actualizado, creditos: cr };
      resumenSeguro = { total: cr.total, folios: cr.folios };
    } else if (c.tipo === "persona") {
      const p = calcularPersona(tickets, c.nombre);
      actualizado = { ...actualizado, persona: p };
      resumenSeguro = { nombre: p.nombre, totalPagado: p.totalPagado, foliosPagados: p.foliosPagados, pendiente: p.pendiente, foliosPendientes: p.foliosPendientes };
    } else if (c.tipo === "libre") {
      const l = calcularLibre(tickets, c);
      actualizado = { ...actualizado, libre: l };
      resumenSeguro = {
        metrica: c.metrica,
        agrupado: l.agrupado,
        folios: l.folios,
        filas: l.filas.map((f) => `${formatoEtiquetaLibre(f.etiqueta)}: ${f.valor}`),
      };
    } else {
      actualizado = { ...actualizado, resultados: await db.buscarFolioGlobal(org.id, c.texto) };
    }
    setMensajes((m) => m.map((msg) => (msg.id === idAsistente ? actualizado : msg)));

    // Narración opcional en prosa, en segundo plano: la respuesta de
    // arriba ya se mostró, así que si esto tarda, falla, o la IA no
    // está configurada, no se nota — solo se queda la frase fija de
    // siempre (ver RespuestaAsistente).
    if (resumenSeguro) {
      const narracion = await db.narrarResultado(c.tipo, resumenSeguro);
      if (narracion) {
        setMensajes((m) => m.map((msg) => (msg.id === idAsistente ? { ...msg, narracion } : msg)));
      }
    }
  }

  function irACierre(fecha: string) {
    navigate(`/app/cierre-caja?fecha=${fecha}`);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick" width={560}>
      <div className="flex max-h-[70vh] min-h-[320px] flex-col">
        <div className="-mx-1 mb-3 flex-1 overflow-y-auto px-1">
          {mensajes.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={24} strokeWidth={1.75} />}
              title="Hola, soy Quick"
              hint='Pregúntame casi cualquier cosa de tus propios datos — cortes de caja, resúmenes, comparaciones, gráficas, "mi mejor día de agosto", "cuánto se cobró en efectivo este mes". Puedes hacer preguntas de seguimiento sin repetir el contexto. Nunca modifico nada, nunca hablo de código, y cada respuesta se puede descargar.'
            />
          ) : (
            <div className="flex flex-col gap-3">
              {mensajes.map((m) =>
                m.rol === "usuario" ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="animate-pop-in max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-brand-500)] px-3.5 py-2 text-sm font-medium text-white">{m.texto}</p>
                  </div>
                ) : (
                  <div key={m.id} className="animate-pop-in flex items-start gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-500)] text-white">
                      <Sparkles size={13} />
                    </div>
                    <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-black/[0.03] px-3.5 py-3 dark:bg-white/[0.05]">
                      <p className="mb-1.5 text-[11px] font-bold text-[var(--color-text-muted)]">Quick</p>
                      <RespuestaAsistente mensaje={m} onIrACierre={irACierre} />
                    </div>
                  </div>
                )
              )}
            </div>
          )}
          <div ref={finRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
          className="flex flex-shrink-0 items-center gap-2 border-t border-[var(--color-border)] pt-3"
        >
          <input
            className="min-w-0 flex-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-brand-400"
            placeholder="Escribe tu pregunta…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            disabled={!texto.trim()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-500)] text-white transition-transform duration-150 ease-out-emil hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          >
            <SendHorizontal size={16} />
          </button>
        </form>
      </div>
    </Modal>
  );
}

// Tres puntos rebotando en cadena, mientras Quick resuelve la
// pregunta (por patrones o, si está configurada, por IA) — el mismo
// lenguaje visual que cualquier chat: confirma que "sí escuchó" y que
// algo sigue en curso, sin poner un texto distinto cada vez.
function PuntosPensando() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-dot-bounce h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function RespuestaAsistente({ mensaje: m, onIrACierre }: { mensaje: MensajeAsistente; onIrACierre: (fecha: string) => void }) {
  if (m.cargando) {
    return <PuntosPensando />;
  }

  // Chat libre: Gemini contestó directamente, sin pasar por ninguna de
  // las nueve formas de abajo — se muestra como un mensaje de chat
  // normal (texto corrido), no como tarjeta de datos.
  if (m.respuestaLibre) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-sm text-[var(--color-text-primary)]">{m.respuestaLibre}</p>
        {m.digesto && (
          <button
            type="button"
            onClick={() => descargarDigesto(m.digesto!)}
            className="flex w-fit items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors duration-150 ease-out-emil hover:text-[var(--color-text-primary)]"
          >
            <Download size={12} /> Descargar los datos que usó
          </button>
        )}
      </div>
    );
  }

  if (m.consulta?.tipo === "corte" && m.desglose) {
    const c = m.consulta;
    const d = m.desglose;
    if (d.grupos.length === 0) {
      return <EmptyState icon={<Receipt size={20} strokeWidth={1.75} />} title={`Sin pagos el ${FORMATO_FECHA_LARGA.format(new Date(c.fecha + "T00:00:00"))}`} />;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? "Aquí está el corte de caja:"}</p>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{FORMATO_FECHA_LARGA.format(new Date(c.fecha + "T00:00:00"))}</span>
          <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(d.total)}</span>
        </div>
        {d.grupos.map((g) => {
          const Icono = g.icono;
          return (
            <div key={g.etiqueta} className="flex items-center gap-2.5 rounded-xl bg-[var(--color-surface)] px-3.5 py-2.5">
              <Icono size={16} className="text-[var(--color-text-secondary)]" />
              <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">{g.etiqueta}</span>
              <Badge tone="neutral">{g.tickets.length}</Badge>
              <span className="tabular text-sm font-bold text-[var(--color-text-primary)]">{formatoMXN(g.subtotal)}</span>
            </div>
          );
        })}
        <div className="flex gap-2">
          <Button className="flex-1" icon={<ArrowRight size={16} />} onClick={() => onIrACierre(c.fecha)}>
            Ver cierre completo
          </Button>
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarCorte(c.fecha, d)}>
            CSV
          </Button>
        </div>
      </div>
    );
  }

  if (m.consulta?.tipo === "resumen" && m.resumen) {
    const c = m.consulta;
    const r = m.resumen;
    if (r.folios === 0) {
      return <EmptyState icon={<ClipboardList size={20} strokeWidth={1.75} />} title={`Sin pagos en ${FORMATO_MES.format(new Date(c.mes + "-02"))}`} />;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? "Aquí está el resumen del mes:"}</p>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{FORMATO_MES.format(new Date(c.mes + "-02"))}</span>
          <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(r.total)}</span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">{r.folios} folio{r.folios === 1 ? "" : "s"} pagado{r.folios === 1 ? "" : "s"}</p>
        {r.top.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Procedimientos más frecuentes</span>
            {r.top.map((p) => (
              <div key={p.nombre} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-primary)]">{p.nombre} <span className="text-[var(--color-text-muted)]">× {p.cantidad}</span></span>
                <span className="tabular font-semibold text-[var(--color-text-primary)]">{formatoMXN(p.total)}</span>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarResumen(c.mes, r)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "estadistica" && m.estadistica) {
    const c = m.consulta;
    const e = m.estadistica;
    if (e.folios === 0) {
      return <EmptyState icon={<ClipboardList size={20} strokeWidth={1.75} />} title="Sin pagos en ese rango" />;
    }
    const introEstadistica: Record<typeof c.metrica, string> = {
      promedio_ticket: "Este es el promedio por folio en ese rango:",
      formas_pago: "Así se desglosan las formas de pago en ese rango:",
      top_procedimientos: "Estos son los procedimientos más frecuentes en ese rango:",
      total: "Aquí está lo que encontré para ese rango:",
    };
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? introEstadistica[c.metrica]}</p>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
          <span className="text-sm font-bold text-[var(--color-text-primary)]">
            {FORMATO_FECHA_LARGA.format(new Date(c.desde + "T00:00:00"))} – {FORMATO_FECHA_LARGA.format(new Date(c.hasta + "T00:00:00"))}
          </span>
          <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(e.total)}</span>
        </div>
        <div className="flex gap-4 text-sm text-[var(--color-text-secondary)]">
          <span>{e.folios} folio{e.folios === 1 ? "" : "s"}</span>
          <span>Promedio: <span className="font-semibold text-[var(--color-text-primary)]">{formatoMXN(e.promedio)}</span></span>
        </div>
        {c.metrica === "formas_pago" && e.porForma.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {e.porForma.map((g) => {
              const Icono = g.icono;
              return (
                <div key={g.etiqueta} className="flex items-center gap-2.5 rounded-xl bg-[var(--color-surface)] px-3.5 py-2.5">
                  <Icono size={16} className="text-[var(--color-text-secondary)]" />
                  <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">{g.etiqueta}</span>
                  <Badge tone="neutral">{g.cantidad}</Badge>
                  <span className="tabular text-sm font-bold text-[var(--color-text-primary)]">{formatoMXN(g.subtotal)}</span>
                </div>
              );
            })}
          </div>
        )}
        {(c.metrica === "top_procedimientos" || c.metrica === "total") && e.top.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Procedimientos más frecuentes</span>
            {e.top.map((p) => (
              <div key={p.nombre} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-primary)]">{p.nombre} <span className="text-[var(--color-text-muted)]">× {p.cantidad}</span></span>
                <span className="tabular font-semibold text-[var(--color-text-primary)]">{formatoMXN(p.total)}</span>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarEstadistica(c.desde, c.hasta, e)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "grafica" && m.grafica) {
    const g = m.grafica;
    const hayDatos = g.historico.some((p) => (p.total ?? 0) > 0);
    if (!hayDatos && g.proyeccion.length === 0) {
      return <EmptyState icon={<TrendingUp size={20} strokeWidth={1.75} />} title="Sin pagos en ese periodo" />;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">
          {m.narracion ?? (g.proyeccion.length > 0 ? "Así van tus ingresos, con una proyección de los próximos meses:" : "Así van tus ingresos:")}
        </p>
        <Suspense fallback={<div className="flex h-48 w-full items-center justify-center"><PuntosPensando /></div>}>
          <QuickChart g={g} />
        </Suspense>
        {g.proyeccion.length > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            La parte punteada es un estimado según la tendencia de estos meses — no una cifra garantizada.
          </p>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarGrafica(g)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "comparacion" && m.comparacion) {
    const comp = m.comparacion;
    const subiendo = comp.deltaPct !== null && comp.deltaPct >= 0;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? "Así se compara un mes contra el otro:"}</p>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface)] px-3.5 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{FORMATO_MES.format(new Date(comp.mesB + "-02"))}</p>
            <p className="tabular text-base font-extrabold text-[var(--color-text-primary)]">{formatoMXN(comp.totalB)}</p>
          </div>
          {comp.deltaPct === null ? (
            <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-text-muted)]"><Minus size={12} /> —</span>
          ) : subiendo ? (
            <span className="flex items-center gap-0.5 rounded-full bg-[color:var(--color-good)]/10 px-2 py-1 text-xs font-bold text-[color:var(--color-good)]">
              <ArrowUpRight size={13} /> {comp.deltaPct.toFixed(0)}%
            </span>
          ) : (
            <span className="flex items-center gap-0.5 rounded-full bg-[color:var(--color-critical)]/10 px-2 py-1 text-xs font-bold text-[color:var(--color-critical)]">
              <ArrowDownRight size={13} /> {comp.deltaPct.toFixed(0)}%
            </span>
          )}
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{FORMATO_MES.format(new Date(comp.mesA + "-02"))}</p>
            <p className="tabular text-base font-extrabold text-brand-600">{formatoMXN(comp.totalA)}</p>
          </div>
        </div>
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarComparacion(comp)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "creditos" && m.creditos) {
    const cr = m.creditos;
    if (cr.folios === 0) {
      return <EmptyState icon={<Wallet size={20} strokeWidth={1.75} />} title="Sin créditos pendientes" hint="No hay ningún folio en crédito ahora mismo." />;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? "Esto es lo que sigue pendiente de cobro:"}</p>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{cr.folios} folio{cr.folios === 1 ? "" : "s"} en crédito</span>
          <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(cr.total)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {cr.top.map((t) => (
            <div key={t.folio} className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-primary)]">{t.nombre} <span className="font-mono text-xs text-[var(--color-text-muted)]">{t.folio}</span></span>
              <span className="tabular font-semibold text-[var(--color-text-primary)]">{formatoMXN(t.total)}</span>
            </div>
          ))}
        </div>
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarCreditos(cr)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "persona" && m.persona) {
    const p = m.persona;
    if (p.foliosPagados === 0 && p.foliosPendientes === 0) {
      return <EmptyState icon={<UserRound size={20} strokeWidth={1.75} />} title="Sin resultados" hint={`No encontré folios para "${p.nombre}".`} />;
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? `Esto es lo que encontré de ${p.nombre}:`}</p>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{p.foliosPagados} folio{p.foliosPagados === 1 ? "" : "s"} pagado{p.foliosPagados === 1 ? "" : "s"}</span>
          <span className="tabular text-base font-extrabold text-brand-600">{formatoMXN(p.totalPagado)}</span>
        </div>
        {p.foliosPendientes > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">{p.foliosPendientes} pendiente{p.foliosPendientes === 1 ? "" : "s"} de cobro</span>
            <Badge tone="warning">{formatoMXN(p.pendiente)}</Badge>
          </div>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarPersona(p)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "libre" && m.libre) {
    const c = m.consulta;
    const l = m.libre;
    if (l.folios === 0) {
      return <EmptyState icon={<ClipboardList size={20} strokeWidth={1.75} />} title="Sin resultados para ese filtro" />;
    }
    const formatoValor = (v: number) => (c.metrica === "conteo" ? `${v} folio${v === 1 ? "" : "s"}` : formatoMXN(v));
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-primary)]">{m.narracion ?? "Esto es lo que encontré:"}</p>
        {!l.agrupado ? (
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
            <span className="text-sm font-bold text-[var(--color-text-primary)]">
              {ETIQUETA_METRICA[c.metrica]} · {l.folios} folio{l.folios === 1 ? "" : "s"}
            </span>
            <span className="tabular text-base font-extrabold text-brand-600">{formatoValor(l.filas[0]?.valor ?? 0)}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {l.filas.map((f) => (
              <div key={f.etiqueta} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-primary)]">{formatoEtiquetaLibre(f.etiqueta)}</span>
                <span className="tabular font-semibold text-[var(--color-text-primary)]">{formatoValor(f.valor)}</span>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarLibre(l)}>
          Descargar CSV
        </Button>
      </div>
    );
  }

  if (m.consulta?.tipo === "busqueda" && m.resultados) {
    const c = m.consulta;
    const resultados = m.resultados;
    if (resultados.length === 0) {
      return (
        <EmptyState
          title={`No encontré nada para "${c.texto}"`}
          hint='Prueba con un nombre o folio, o pregúntame algo como "cuánto cobré ayer" o "resumen de este mes".'
        />
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--color-text-primary)]">
          Encontré {resultados.length} resultado{resultados.length === 1 ? "" : "s"}:
        </p>
        {resultados.slice(0, 6).map((t) => (
          <Card key={t.id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar nombre={t.nombre} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-bold text-[var(--color-text-primary)]">{t.nombre}</span>
                <Badge tone={t.estado === "credito" ? "warning" : "good"} className="flex-shrink-0">
                  {t.estado === "credito" ? "Crédito" : "Pagado"}
                </Badge>
              </div>
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                <span className="font-semibold text-[var(--color-text-secondary)]">{t.servicioNombre}</span> · <span className="font-mono">{t.folio}</span>
              </p>
            </div>
            <span className="tabular flex-shrink-0 text-sm font-extrabold text-[var(--color-text-primary)]">{formatoMXN(t.total)}</span>
            <button
              type="button"
              title={`Descargar ${t.folio}`}
              onClick={() => descargarUnFolio(t)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-[background-color,color,transform] duration-150 ease-out-emil hover:scale-105 hover:bg-black/5 hover:text-[var(--color-text-primary)] active:scale-90 dark:hover:bg-white/10"
            >
              <Download size={14} />
            </button>
          </Card>
        ))}
        {resultados.length > 6 && (
          <p className="text-center text-xs text-[var(--color-text-muted)]">Y {resultados.length - 6} más — el CSV los trae todos.</p>
        )}
        <Button variant="secondary" icon={<Download size={16} />} onClick={() => descargarBusqueda(c.texto, resultados)}>
          Descargar CSV ({resultados.length})
        </Button>
      </div>
    );
  }

  return null;
}
