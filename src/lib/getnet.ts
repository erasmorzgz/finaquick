// Lectura del reporte diario de Getnet (CSV o Excel .xlsx) para conciliar
// el corte de caja. No se sabe de antemano cómo viene exactamente el
// archivo, así que se detectan las columnas por el nombre de su
// encabezado, se filtra por la referencia (afiliación) del servicio y por
// el día, y quien lo sube puede corregir la columna del monto si no se
// reconoce. Todo corre en el navegador: el archivo no se sube a ningún
// lado — solo se manda al servidor la lista de movimientos ya
// interpretada, sin números de tarjeta.
import type { MovimientoGetnet } from "./db/types";

// ---------------------------------------------------------------------
// Texto y CSV
// ---------------------------------------------------------------------

/** UTF-8 si es válido; si no, Windows-1252 (así exporta Excel en español). */
export function decodificarTexto(bytes: Uint8Array): string {
  let inicio = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) inicio = 3;
  const cuerpo = bytes.subarray(inicio);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(cuerpo);
  } catch {
    return new TextDecoder("windows-1252").decode(cuerpo);
  }
}

function detectarDelimitador(texto: string): string {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 12);
  let mejor = ",";
  let mejorPuntaje = 0;
  for (const delimitador of [",", ";", "\t", "|"]) {
    const cuentas = lineas.map((linea) => {
      let n = 0;
      let entrecomillado = false;
      for (const ch of linea) {
        if (ch === '"') entrecomillado = !entrecomillado;
        else if (ch === delimitador && !entrecomillado) n++;
      }
      return n;
    });
    // Lo que importa es la cantidad de columnas que se repite en la
    // mayoría de las líneas: los títulos del reporte (sin separadores)
    // arriba de la tabla no deben contar en contra.
    const conSeparador = cuentas.filter((c) => c > 0);
    if (conSeparador.length === 0) continue;
    const frecuencias = new Map<number, number>();
    for (const c of conSeparador) frecuencias.set(c, (frecuencias.get(c) ?? 0) + 1);
    const [columnas, repeticiones] = [...frecuencias.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const puntaje = repeticiones * 10 + columnas;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = delimitador;
    }
  }
  return mejor;
}

export function parsearCSV(texto: string): string[][] {
  const delimitador = detectarDelimitador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entrecomillado = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (entrecomillado) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else entrecomillado = false;
      } else celda += ch;
    } else if (ch === '"') {
      entrecomillado = true;
    } else if (ch === delimitador) {
      fila.push(celda);
      celda = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      celda = "";
      filas.push(fila);
      fila = [];
    } else celda += ch;
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== "")).map((f) => f.map((c) => c.trim()));
}

// ---------------------------------------------------------------------
// Excel (.xlsx): un ZIP con XML dentro. Se lee sin dependencias con
// DecompressionStream (ya viene en los navegadores y en Node).
// ---------------------------------------------------------------------

interface EntradaZip {
  nombre: string;
  metodo: number;
  tamanoComprimido: number;
  desplazamiento: number;
}

function leerEntradasZip(bytes: Uint8Array): EntradaZip[] {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: firma 0x06054b50, en los últimos 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");
  const total = vista.getUint16(eocd + 10, true);
  let pos = vista.getUint32(eocd + 16, true);
  const entradas: EntradaZip[] = [];
  const decodificador = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (pos + 46 > bytes.length || vista.getUint32(pos, true) !== 0x02014b50) throw new Error("El archivo Excel está dañado.");
    const metodo = vista.getUint16(pos + 10, true);
    const tamanoComprimido = vista.getUint32(pos + 20, true);
    const largoNombre = vista.getUint16(pos + 28, true);
    const largoExtra = vista.getUint16(pos + 30, true);
    const largoComentario = vista.getUint16(pos + 32, true);
    const desplazamiento = vista.getUint32(pos + 42, true);
    entradas.push({ nombre: decodificador.decode(bytes.subarray(pos + 46, pos + 46 + largoNombre)), metodo, tamanoComprimido, desplazamiento });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

// Tope de lo que se descomprime de cada parte: un .xlsx "bomba" no debe
// agotar la memoria del navegador.
const MAX_XML_DESCOMPRIMIDO = 60_000_000;

async function descomprimirEntrada(bytes: Uint8Array, entrada: EntradaZip): Promise<string> {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inicioLocal = entrada.desplazamiento;
  if (vista.getUint32(inicioLocal, true) !== 0x04034b50) throw new Error("El archivo Excel está dañado.");
  const inicioDatos = inicioLocal + 30 + vista.getUint16(inicioLocal + 26, true) + vista.getUint16(inicioLocal + 28, true);
  const comprimido = bytes.subarray(inicioDatos, inicioDatos + entrada.tamanoComprimido);
  if (entrada.metodo === 0) return new TextDecoder().decode(comprimido);
  if (entrada.metodo !== 8) throw new Error("El Excel usa una compresión que no se puede leer. Guárdalo como CSV.");
  const flujo = new Blob([comprimido as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const lector = flujo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > MAX_XML_DESCOMPRIMIDO) {
      await lector.cancel();
      throw new Error("El archivo Excel es demasiado grande.");
    }
    partes.push(value);
  }
  const unido = new Uint8Array(total);
  let desplazamiento = 0;
  for (const p of partes) {
    unido.set(p, desplazamiento);
    desplazamiento += p.length;
  }
  return new TextDecoder().decode(unido);
}

function entidadesXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function indiceDeColumna(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function leerXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entradas = leerEntradasZip(bytes);
  const leer = async (nombre: string) => {
    const entrada = entradas.find((e) => e.nombre === nombre);
    return entrada ? descomprimirEntrada(bytes, entrada) : null;
  };

  const compartidas: string[] = [];
  const xmlCompartidas = await leer("xl/sharedStrings.xml");
  if (xmlCompartidas) {
    for (const si of xmlCompartidas.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      compartidas.push(entidadesXml([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    }
  }

  // La primera hoja del libro (no siempre se llama sheet1.xml).
  let rutaHoja = "xl/worksheets/sheet1.xml";
  const libro = await leer("xl/workbook.xml");
  const relaciones = await leer("xl/_rels/workbook.xml.rels");
  if (libro && relaciones) {
    const idHoja = libro.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    const destino = idHoja
      ? [...relaciones.matchAll(/<Relationship\b[^>]*>/g)].map((r) => r[0]).find((r) => r.includes(`Id="${idHoja}"`))?.match(/Target="([^"]+)"/)?.[1]
      : undefined;
    if (destino) rutaHoja = destino.startsWith("/") ? destino.slice(1) : `xl/${destino.replace(/^\.\//, "")}`;
  }
  const xmlHoja = await leer(rutaHoja);
  if (!xmlHoja) throw new Error("No se encontró la hoja de datos del Excel. Guárdalo como CSV.");

  const filas: string[][] = [];
  for (const fila of xmlHoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: string[] = [];
    for (const celda of fila[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celda[1];
      const referencia = atributos.match(/\br="([A-Za-z]+)\d+"/)?.[1];
      const indice = referencia ? indiceDeColumna(referencia) : celdas.length;
      if (indice > 500) continue; // hojas absurdamente anchas
      const tipo = atributos.match(/\bt="([^"]+)"/)?.[1];
      const cuerpo = celda[2] ?? "";
      let valor = "";
      if (tipo === "inlineStr") valor = entidadesXml([...cuerpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else {
        const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        valor = tipo === "s" ? (compartidas[Number(v)] ?? "") : entidadesXml(v);
      }
      while (celdas.length < indice) celdas.push("");
      celdas[indice] = valor.trim();
    }
    if (celdas.some((c) => c !== "")) filas.push(celdas);
  }
  return filas;
}

/** Lee el archivo que se subió (CSV, TXT o Excel .xlsx) como una tabla. */
export async function leerArchivoTabla(nombre: string, bytes: Uint8Array): Promise<string[][]> {
  const esZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (esZip) return leerXlsx(bytes);
  if (/\.xls$/i.test(nombre) || (bytes.length > 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new Error("Ese es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx o como CSV.");
  }
  if (/\.pdf$/i.test(nombre) || (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50)) {
    throw new Error("Un PDF no se puede leer. Descarga el reporte de Getnet en Excel o CSV.");
  }
  return parsearCSV(decodificarTexto(bytes));
}

/** Huella SHA-256 del archivo, para dejar constancia de cuál se comparó. */
export async function huellaArchivo(bytes: Uint8Array): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------
// Interpretación de la tabla
// ---------------------------------------------------------------------

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** "$1,234.50", "1.234,50", "(150.00)", "-150", "150.5" → número. */
export function parsearMonto(texto: string): number | null {
  let t = texto.trim();
  if (t === "") return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/mxn|mn|pesos/gi, "").replace(/[$\s]/g, "");
  if (t.startsWith("-")) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.endsWith("-")) {
    negativo = !negativo;
    t = t.slice(0, -1);
  }
  if (t === "" || !/^[\d.,]+$/.test(t)) return null;
  const ultimoPunto = t.lastIndexOf(".");
  const ultimaComa = t.lastIndexOf(",");
  let normal: string;
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // El separador que aparece al final es el decimal.
    normal = ultimaComa > ultimoPunto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    normal = /,\d{1,2}$/.test(t) && t.indexOf(",") === ultimaComa ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (ultimoPunto >= 0 && /\.\d{3}$/.test(t) && t.indexOf(".") === ultimoPunto && !/^0\./.test(t)) {
    normal = t.replace(".", ""); // 1.234 → mil doscientos treinta y cuatro
  } else {
    normal = t;
  }
  const numero = Number(normal);
  if (!Number.isFinite(numero)) return null;
  return negativo ? -numero : numero;
}

const pad = (n: number) => String(n).padStart(2, "0");

function horaDeFraccion(fraccion: number): string | undefined {
  if (!(fraccion >= 0 && fraccion < 1)) return undefined;
  const minutos = Math.round(fraccion * 1440) % 1440;
  return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;
}

function validaFecha(a: number, m: number, d: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${pad(m)}-${pad(d)}` : null;
}

/** Fecha y hora (opcional) de una celda: "30/09/2026 14:32", "2026-09-30",
 * "30-sep-2026", "20260930", o un número de serie de Excel. */
export function parsearFechaHora(texto: string): { fecha: string | null; hora?: string } {
  const t = texto.trim();
  if (t === "") return { fecha: null };
  const hora = t.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i);
  let horaTexto: string | undefined;
  if (hora) {
    let h = Number(hora[1]);
    const marca = hora[3]?.toLowerCase().replace(/[.\s]/g, "");
    if (marca === "pm" && h < 12) h += 12;
    if (marca === "am" && h === 12) h = 0;
    if (h <= 23 && Number(hora[2]) <= 59) horaTexto = `${pad(h)}:${hora[2]}`;
  }
  // Número de serie de Excel (días desde 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serie = Number(t);
    if (serie >= 36526 && serie <= 73415) {
      const dias = Math.floor(serie);
      const f = new Date(Date.UTC(1899, 11, 30 + dias));
      const fraccion = serie - dias;
      const minutos = Math.round(fraccion * 1440);
      return { fecha: `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`, hora: fraccion > 0 ? `${pad(Math.floor(minutos / 60) % 24)}:${pad(minutos % 60)}` : undefined };
    }
  }
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return { fecha: validaFecha(Number(m[1]), Number(m[2]), Number(m[3])), hora: horaTexto };
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return { fecha: validaFecha(Number(m[3]), Number(m[2]), Number(m[1])), hora: horaTexto }; // día/mes/año, como en México
  m = t.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) return { fecha: validaFecha(Number(m[1]), Number(m[2]), Number(m[3])), hora: horaTexto };
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  m = normalizar(t).match(/(\d{1,2})[\s-]*(?:de\s+)?([a-z]{3})[a-z]*[\s-]*(?:de\s+)?(\d{4})/);
  if (m && meses.includes(m[2])) return { fecha: validaFecha(Number(m[3]), meses.indexOf(m[2]) + 1, Number(m[1])), hora: horaTexto };
  return { fecha: null, hora: horaTexto };
}

export interface Columnas {
  monto?: number;
  fecha?: number;
  hora?: number;
  autorizacion?: number;
  tipo?: number;
  estatus?: number;
  referencia: number[];
}

const NO_ES_MONTO = /(comision|iva|neto|deposit|abono|retenc|propina|cashback|puntos|meses|plazo|saldo|bin)/;

export function detectarColumnas(encabezado: string[]): Columnas {
  const h = encabezado.map(normalizar);
  const mejor = (puntaje: (t: string) => number): number | undefined => {
    let indice: number | undefined;
    let maximo = 0;
    h.forEach((t, i) => {
      const p = t ? puntaje(t) : 0;
      if (p > maximo) {
        maximo = p;
        indice = i;
      }
    });
    return indice;
  };
  return {
    monto: mejor((t) => {
      if (NO_ES_MONTO.test(t) || /(fecha|hora|autoriz|afiliaci|referencia|terminal|tarjeta|comercio)/.test(t)) return 0;
      let p = 0;
      if (/\bmonto\b/.test(t)) p += 4;
      if (/\bimporte\b/.test(t)) p += 4;
      if (/\bventa\b|transaccion|operacion|bruto/.test(t)) p += 2;
      if (/\btotal\b/.test(t)) p += 1;
      return p;
    }),
    fecha: mejor((t) => {
      if (!/fecha/.test(t)) return 0;
      if (/(deposit|pago|abono|corte|proceso|liquidac|vencim)/.test(t)) return 1;
      return /(transaccion|venta|operacion|compra)/.test(t) ? 3 : 2;
    }),
    hora: mejor((t) => (/^hora|\bhora\b/.test(t) ? 1 : 0)),
    autorizacion: mejor((t) => (/(autoriz|aprobacion)/.test(t) ? 1 : 0)),
    tipo: mejor((t) => {
      if (/tarjeta|marca|producto/.test(t)) return 0;
      if (/(tipo.*(transaccion|operacion|movimiento))|(transaccion.*tipo)/.test(t)) return 3;
      return /^(tipo|movimiento|operacion|transaccion)$/.test(t) ? 2 : 0;
    }),
    estatus: mejor((t) => (/(estatus|estado|status|resultado)/.test(t) ? 1 : 0)),
    referencia: h
      .map((t, i) => (/(referencia|afiliaci|comercio|merchant|terminal|establecimiento|sucursal|negocio)/.test(t) ? i : -1))
      .filter((i) => i >= 0),
  };
}

/** La fila que parece el encabezado: la que más palabras conocidas trae. */
function buscarEncabezado(filas: string[][]): number {
  let mejor = -1;
  let maximo = 1; // al menos 2 coincidencias
  filas.slice(0, 40).forEach((fila, i) => {
    const puntos = fila.map(normalizar).filter((t) => /(fecha|monto|importe|autoriz|referencia|afiliaci|comercio|tarjeta|hora|tipo|estatus|terminal|transaccion|total)/.test(t)).length;
    if (puntos > maximo) {
      maximo = puntos;
      mejor = i;
    }
  });
  return mejor;
}

export interface ReporteInterpretado {
  movimientos: MovimientoGetnet[];
  encabezado: string[];
  filaEncabezado: number;
  columnas: Columnas;
  ignoradas: { otraFecha: number; otraReferencia: number; rechazadas: number; sinMonto: number };
  /** Si se encontró la referencia del servicio en el archivo (o no había que buscarla). */
  referenciaEncontrada: boolean;
  /** Días que trae el archivo, para avisar si es de otro día. */
  fechasEnArchivo: string[];
  avisos: string[];
}

const SIN_LETRAS_NI_CEROS = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+/, "");

export function interpretarReporte(
  filas: string[][],
  opciones: { fecha: string; referencia?: string; columnas?: Partial<Columnas> }
): ReporteInterpretado {
  const avisos: string[] = [];
  let filaEncabezado = buscarEncabezado(filas);
  if (filaEncabezado < 0) {
    filaEncabezado = 0;
    avisos.push("No se reconoció la fila de encabezados; se usó la primera.");
  }
  const encabezado = filas[filaEncabezado] ?? [];
  const detectadas = detectarColumnas(encabezado);
  const columnas: Columnas = { ...detectadas, ...opciones.columnas, referencia: opciones.columnas?.referencia ?? detectadas.referencia };
  const vacio = (): ReporteInterpretado => ({
    movimientos: [], encabezado, filaEncabezado, columnas,
    ignoradas: { otraFecha: 0, otraReferencia: 0, rechazadas: 0, sinMonto: 0 },
    referenciaEncontrada: true, fechasEnArchivo: [], avisos,
  });
  if (columnas.monto === undefined) {
    avisos.push("No se encontró la columna del monto. Elígela abajo.");
    return vacio();
  }

  const datos = filas.slice(filaEncabezado + 1);
  const ref = opciones.referencia ? SIN_LETRAS_NI_CEROS(opciones.referencia) : "";
  const celdaCoincide = (celda: string) => {
    const c = SIN_LETRAS_NI_CEROS(celda);
    return c !== "" && (c === ref || (ref.length >= 5 && c.includes(ref)));
  };

  // ¿Qué filas son de la referencia de este servicio?
  let cumpleReferencia: (fila: string[]) => boolean = () => true;
  let referenciaEncontrada = true;
  if (ref) {
    if (columnas.referencia.length > 0) {
      const enColumnas = (fila: string[]) => columnas.referencia.some((i) => celdaCoincide(fila[i] ?? ""));
      referenciaEncontrada = datos.some(enColumnas);
      cumpleReferencia = enColumnas;
      if (!referenciaEncontrada) avisos.push(`No se encontró la referencia ${opciones.referencia} en el archivo.`);
    } else {
      const enCualquierCelda = (fila: string[]) => fila.some(celdaCoincide);
      if (datos.some(enCualquierCelda)) cumpleReferencia = enCualquierCelda;
      else {
        referenciaEncontrada = false;
        avisos.push(`El archivo no trae la referencia ${opciones.referencia}; se tomaron todos sus movimientos (¿ya lo descargaste solo de ese servicio?).`);
      }
    }
  }

  const ignoradas = { otraFecha: 0, otraReferencia: 0, rechazadas: 0, sinMonto: 0 };
  const fechas = new Set<string>();
  const candidatos: { movimiento: MovimientoGetnet; fecha: string | null }[] = [];
  for (const fila of datos) {
    // Filas de totales del propio reporte ("Total", "Subtotal"…): no son movimientos.
    if (/^(total|subtotal|suma|gran total)\b/.test(normalizar(fila[0] ?? ""))) {
      ignoradas.sinMonto++;
      continue;
    }
    const textoMonto = fila[columnas.monto] ?? "";
    const monto = parsearMonto(textoMonto);
    if (monto === null || monto === 0) {
      // Filas de totales, encabezados repetidos o vacías.
      if (fila.some((c) => c.trim() !== "")) ignoradas.sinMonto++;
      continue;
    }
    if (!cumpleReferencia(fila)) {
      ignoradas.otraReferencia++;
      continue;
    }
    if (columnas.estatus !== undefined && /(rechaz|declin|denegad|no aprobad|fallid|error)/.test(normalizar(fila[columnas.estatus] ?? ""))) {
      ignoradas.rechazadas++;
      continue;
    }
    const { fecha, hora: horaDeFecha } = columnas.fecha !== undefined ? parsearFechaHora(fila[columnas.fecha] ?? "") : { fecha: null, hora: undefined };
    if (fecha) fechas.add(fecha);
    let hora = horaDeFecha;
    if (columnas.hora !== undefined && fila[columnas.hora]) {
      const celdaHora = fila[columnas.hora];
      // Excel guarda una hora como fracción del día (0.6 = 14:24).
      hora = /^0?\.\d+$/.test(celdaHora) ? horaDeFraccion(Number(celdaHora)) : (parsearFechaHora(celdaHora).hora ?? hora);
    }
    const tipoTexto = columnas.tipo !== undefined ? normalizar(fila[columnas.tipo] ?? "") : "";
    const cancelacion = monto < 0 || /(cancel|devol|reembols|reverso|refund|void|anulaci)/.test(tipoTexto);
    const autorizacion = columnas.autorizacion !== undefined ? (fila[columnas.autorizacion] ?? "").trim().slice(0, 30) || undefined : undefined;
    candidatos.push({ movimiento: { monto: Math.round(Math.abs(monto) * 100) / 100, tipo: cancelacion ? "cancelacion" : "venta", autorizacion, hora }, fecha });
  }

  const fechasEnArchivo = [...fechas].sort();
  let movimientos: MovimientoGetnet[];
  if (columnas.fecha !== undefined && fechas.size > 0) {
    movimientos = [];
    for (const c of candidatos) {
      if (c.fecha === null || c.fecha === opciones.fecha) movimientos.push(c.movimiento);
      else ignoradas.otraFecha++;
    }
    if (!fechas.has(opciones.fecha)) {
      avisos.push(
        fechasEnArchivo.length === 1
          ? `El reporte es del ${fechasEnArchivo[0]}, no del ${opciones.fecha}.`
          : `El reporte no trae movimientos del ${opciones.fecha} (trae del ${fechasEnArchivo[0]} al ${fechasEnArchivo[fechasEnArchivo.length - 1]}).`
      );
    } else if (ignoradas.otraFecha > 0) {
      avisos.push(`Se ignoraron ${ignoradas.otraFecha} movimiento(s) de otros días.`);
    }
  } else {
    movimientos = candidatos.map((c) => c.movimiento);
    if (columnas.fecha === undefined) avisos.push("No se encontró una columna de fecha; se tomaron todos los movimientos del archivo.");
  }
  if (ignoradas.rechazadas > 0) avisos.push(`Se omitieron ${ignoradas.rechazadas} operación(es) rechazada(s).`);
  if (movimientos.length > 5000) avisos.push("El reporte trae más de 5,000 movimientos: no se puede comparar completo.");

  return { movimientos, encabezado, filaEncabezado, columnas, ignoradas, referenciaEncontrada, fechasEnArchivo, avisos };
}
