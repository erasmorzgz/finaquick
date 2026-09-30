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

// ---------------------------------------------------------------------
// Excel antiguo (.xls, BIFF8): un archivo "compuesto" (tipo mini sistema
// de archivos) con el libro dentro. Se lee sin dependencias: primero el
// contenedor, luego los registros del libro. Solo lo necesario para
// leer texto y números de las hojas.
// ---------------------------------------------------------------------

const FIRMA_CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIN_DE_CADENA = 0xfffffffe;

function leerContenedorCfb(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 512 || FIRMA_CFB.some((b, i) => bytes[i] !== b)) throw new Error("El archivo no es un Excel válido.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tamSector = 1 << v.getUint16(0x1e, true);
  const tamMini = 1 << v.getUint16(0x20, true);
  if (tamSector !== 512 && tamSector !== 4096) throw new Error("El archivo Excel está dañado.");
  const inicioDirectorio = v.getUint32(0x30, true);
  const corteMini = v.getUint32(0x38, true);
  const inicioMiniFat = v.getUint32(0x3c, true);
  const inicioDifat = v.getUint32(0x44, true);
  const numDifat = v.getUint32(0x48, true);
  const desplazamiento = (id: number) => (id + 1) * tamSector;
  const sector = (id: number) => {
    const ini = desplazamiento(id);
    if (ini < 0 || ini + tamSector > bytes.length) throw new Error("El archivo Excel está dañado.");
    return bytes.subarray(ini, ini + tamSector);
  };

  // Sectores de la tabla de asignación (FAT): 109 en el encabezado, más la cadena DIFAT.
  const sectoresFat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = v.getUint32(0x4c + i * 4, true);
    if (id < 0xfffffffc) sectoresFat.push(id);
  }
  let difat = inicioDifat;
  for (let n = 0; n < numDifat && difat < 0xfffffffc; n++) {
    const d = new DataView(sector(difat).buffer, sector(difat).byteOffset, tamSector);
    for (let i = 0; i < tamSector / 4 - 1; i++) {
      const id = d.getUint32(i * 4, true);
      if (id < 0xfffffffc) sectoresFat.push(id);
    }
    difat = d.getUint32(tamSector - 4, true);
  }
  const fat: number[] = [];
  for (const id of sectoresFat) {
    const d = new DataView(sector(id).buffer, sector(id).byteOffset, tamSector);
    for (let i = 0; i < tamSector / 4; i++) fat.push(d.getUint32(i * 4, true));
  }
  const cadena = (inicio: number, tabla: number[], limite = 100_000): number[] => {
    const ids: number[] = [];
    for (let id = inicio; id < 0xfffffffa && ids.length < limite; id = tabla[id] ?? FIN_DE_CADENA) ids.push(id);
    return ids;
  };
  const leerCadena = (inicio: number): Uint8Array => {
    const ids = cadena(inicio, fat);
    const salida = new Uint8Array(ids.length * tamSector);
    ids.forEach((id, i) => salida.set(sector(id), i * tamSector));
    return salida;
  };

  // Directorio: buscar el flujo "Workbook" (o "Book", de versiones viejas).
  const directorio = leerCadena(inicioDirectorio);
  const dv = new DataView(directorio.buffer, directorio.byteOffset, directorio.byteLength);
  let raiz: { inicio: number } | null = null;
  let libro: { inicio: number; tamano: number } | null = null;
  for (let ini = 0; ini + 128 <= directorio.length; ini += 128) {
    const largoNombre = dv.getUint16(ini + 0x40, true);
    if (largoNombre < 2 || largoNombre > 64) continue;
    let nombre = "";
    for (let i = 0; i < largoNombre / 2 - 1; i++) nombre += String.fromCharCode(dv.getUint16(ini + i * 2, true));
    const tipo = directorio[ini + 0x42];
    const inicio = dv.getUint32(ini + 0x74, true);
    const tamano = dv.getUint32(ini + 0x78, true);
    if (tipo === 5) raiz = { inicio };
    if (tipo === 2 && (nombre === "Workbook" || (nombre === "Book" && !libro))) libro = { inicio, tamano };
  }
  if (!libro) throw new Error("No se encontró la hoja de datos del Excel. Guárdalo como .xlsx o CSV.");

  if (libro.tamano >= corteMini) return leerCadena(libro.inicio).subarray(0, libro.tamano);
  // Flujos chicos viven en el "mini flujo" de la raíz.
  if (!raiz) throw new Error("El archivo Excel está dañado.");
  const miniFlujo = leerCadena(raiz.inicio);
  const miniFat: number[] = [];
  for (const id of cadena(inicioMiniFat, fat)) {
    const d = new DataView(sector(id).buffer, sector(id).byteOffset, tamSector);
    for (let i = 0; i < tamSector / 4; i++) miniFat.push(d.getUint32(i * 4, true));
  }
  const ids = cadena(libro.inicio, miniFat);
  const salida = new Uint8Array(ids.length * tamMini);
  ids.forEach((id, i) => salida.set(miniFlujo.subarray(id * tamMini, (id + 1) * tamMini), i * tamMini));
  return salida.subarray(0, libro.tamano);
}

interface Registro {
  id: number;
  datos: Uint8Array;
  /** Registros CONTINUE que le siguen (las cadenas largas se parten en ellos). */
  continuaciones: Uint8Array[];
}

function leerRegistros(libro: Uint8Array, desde: number, hastaEof: boolean): { registros: Registro[]; fin: number } {
  const v = new DataView(libro.buffer, libro.byteOffset, libro.byteLength);
  const registros: Registro[] = [];
  let pos = desde;
  let nivel = 0;
  while (pos + 4 <= libro.length) {
    const id = v.getUint16(pos, true);
    const largo = v.getUint16(pos + 2, true);
    const datos = libro.subarray(pos + 4, pos + 4 + largo);
    pos += 4 + largo;
    if (id === 0x003c && registros.length > 0) {
      registros[registros.length - 1].continuaciones.push(datos);
      continue;
    }
    registros.push({ id, datos, continuaciones: [] });
    if (id === 0x0809) nivel++; // BOF
    if (id === 0x000a) {
      nivel--; // EOF
      if (hastaEof && nivel <= 0) break;
    }
  }
  return { registros, fin: pos };
}

/** Lector de cadenas que pueden continuar en los registros CONTINUE. */
class LectorCadenas {
  private trozo = 0;
  private pos = 0;
  private readonly trozos: Uint8Array[];
  constructor(trozos: Uint8Array[]) {
    this.trozos = trozos;
  }
  private actual() {
    return this.trozos[this.trozo];
  }
  private alFinal() {
    return this.trozo >= this.trozos.length;
  }
  byte(): number {
    while (!this.alFinal() && this.pos >= this.actual().length) {
      this.trozo++;
      this.pos = 0;
    }
    if (this.alFinal()) throw new Error("El archivo Excel está dañado.");
    return this.actual()[this.pos++];
  }
  u16(): number {
    return this.byte() | (this.byte() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  saltar(n: number) {
    while (n > 0) {
      if (this.alFinal()) return;
      const disponible = this.actual().length - this.pos;
      if (disponible <= 0) {
        this.trozo++;
        this.pos = 0;
        continue;
      }
      const toma = Math.min(disponible, n);
      this.pos += toma;
      n -= toma;
    }
  }
  hayMas(): boolean {
    while (!this.alFinal() && this.pos >= this.actual().length) {
      this.trozo++;
      this.pos = 0;
    }
    return !this.alFinal();
  }
  /** Cadena de Excel: largo (u16), opciones, [runs], [extensión], caracteres. */
  cadena(largoEnBytes: 1 | 2 = 2): string {
    const cch = largoEnBytes === 2 ? this.u16() : this.byte();
    const opciones = this.byte();
    const runs = opciones & 0x08 ? this.u16() : 0;
    const extension = opciones & 0x04 ? this.u32() : 0;
    const texto = this.caracteres(cch, opciones & 0x01 ? true : false);
    this.saltar(runs * 4 + extension);
    return texto;
  }
  caracteres(cch: number, ancho: boolean): string {
    let salida = "";
    let restantes = cch;
    let esAncho = ancho;
    while (restantes > 0) {
      if (!this.hayMas()) throw new Error("El archivo Excel está dañado.");
      // Al empezar un CONTINUE con una cadena a medias, su primer byte repite la opción de ancho.
      if (this.pos === 0 && this.trozo > 0) esAncho = (this.byte() & 0x01) === 1;
      const tam = esAncho ? 2 : 1;
      const disponibles = Math.floor((this.actual().length - this.pos) / tam);
      const toma = Math.min(restantes, disponibles);
      if (toma <= 0) {
        this.trozo++;
        this.pos = 0;
        continue;
      }
      const t = this.actual();
      for (let i = 0; i < toma; i++) {
        salida += esAncho ? String.fromCharCode(t[this.pos] | (t[this.pos + 1] << 8)) : String.fromCharCode(t[this.pos]);
        this.pos += tam;
      }
      restantes -= toma;
    }
    return salida;
  }
}

function decodificarRk(rk: number): number {
  let valor: number;
  if (rk & 0x02) valor = rk >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    valor = b.getFloat64(0, true);
  }
  return rk & 0x01 ? valor / 100 : valor;
}

const textoNumero = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : "");

export interface HojaLeida {
  nombre: string;
  filas: string[][];
}

/** Lee todas las hojas de un .xls (Excel 97-2003). */
export function leerXls(bytes: Uint8Array): HojaLeida[] {
  const libro = leerContenedorCfb(bytes);
  const vl = new DataView(libro.buffer, libro.byteOffset, libro.byteLength);
  if (libro.length < 8 || vl.getUint16(0, true) !== 0x0809) throw new Error("El archivo Excel está dañado.");
  if (vl.getUint16(4, true) < 0x0600) throw new Error("Ese Excel es de una versión muy antigua. Ábrelo y guárdalo como .xlsx o CSV.");

  const globales = leerRegistros(libro, 0, true).registros;
  const hojasDef: { nombre: string; offset: number }[] = [];
  const compartidas: string[] = [];
  for (const r of globales) {
    const d = new DataView(r.datos.buffer, r.datos.byteOffset, r.datos.byteLength);
    if (r.id === 0x002f) throw new Error("Ese Excel está protegido con contraseña. Guárdalo sin protección, o como CSV.");
    if (r.id === 0x0085 && r.datos.length >= 8) {
      const lector = new LectorCadenas([r.datos.subarray(6)]);
      hojasDef.push({ nombre: lector.cadena(1), offset: d.getUint32(0, true) });
    }
    if (r.id === 0x00fc) {
      const lector = new LectorCadenas([r.datos.subarray(8), ...r.continuaciones]);
      const unicos = d.getUint32(4, true);
      for (let i = 0; i < unicos && lector.hayMas(); i++) compartidas.push(lector.cadena(2));
    }
  }

  const hojas: HojaLeida[] = [];
  for (const def of hojasDef) {
    if (def.offset <= 0 || def.offset >= libro.length) continue;
    const { registros } = leerRegistros(libro, def.offset, true);
    const celdas = new Map<number, Map<number, string>>();
    const poner = (fila: number, col: number, valor: string) => {
      if (fila > 65_535 || col > 500 || valor === "") return;
      let f = celdas.get(fila);
      if (!f) celdas.set(fila, (f = new Map()));
      f.set(col, valor);
    };
    let formulaPendiente: { fila: number; col: number } | null = null;
    for (const r of registros) {
      const d = new DataView(r.datos.buffer, r.datos.byteOffset, r.datos.byteLength);
      const n = r.datos.length;
      switch (r.id) {
        case 0x00fd: // LABELSST
          if (n >= 10) poner(d.getUint16(0, true), d.getUint16(2, true), (compartidas[d.getUint32(6, true)] ?? "").trim());
          break;
        case 0x0204: // LABEL
          if (n >= 8) poner(d.getUint16(0, true), d.getUint16(2, true), new LectorCadenas([r.datos.subarray(6), ...r.continuaciones]).cadena(2).trim());
          break;
        case 0x0203: // NUMBER
          if (n >= 14) poner(d.getUint16(0, true), d.getUint16(2, true), textoNumero(d.getFloat64(6, true)));
          break;
        case 0x027e: // RK
          if (n >= 10) poner(d.getUint16(0, true), d.getUint16(2, true), textoNumero(decodificarRk(d.getUint32(6, true))));
          break;
        case 0x00bd: { // MULRK
          if (n < 6) break;
          const fila = d.getUint16(0, true);
          const primera = d.getUint16(2, true);
          const cantidad = Math.floor((n - 6) / 6);
          for (let i = 0; i < cantidad; i++) poner(fila, primera + i, textoNumero(decodificarRk(d.getUint32(4 + i * 6 + 2, true))));
          break;
        }
        case 0x0006: { // FORMULA: el resultado es un número, o una cadena en el registro que sigue
          if (n < 14) break;
          const fila = d.getUint16(0, true);
          const col = d.getUint16(2, true);
          if (d.getUint16(12, true) === 0xffff) {
            if (r.datos[6] === 0) formulaPendiente = { fila, col };
            else if (r.datos[6] === 1) poner(fila, col, r.datos[8] ? "VERDADERO" : "FALSO");
          } else poner(fila, col, textoNumero(d.getFloat64(6, true)));
          break;
        }
        case 0x0207: // STRING (resultado de una fórmula)
          if (formulaPendiente) {
            poner(formulaPendiente.fila, formulaPendiente.col, new LectorCadenas([r.datos, ...r.continuaciones]).cadena(2).trim());
            formulaPendiente = null;
          }
          break;
        default:
          break;
      }
    }
    const filas: string[][] = [];
    const indices = [...celdas.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const f = celdas.get(i)!;
      const ancho = Math.max(...f.keys()) + 1;
      const fila = Array.from({ length: ancho }, (_, c) => f.get(c) ?? "");
      if (fila.some((c) => c !== "")) filas.push(fila);
    }
    hojas.push({ nombre: def.nombre, filas });
  }
  return hojas;
}

/** La hoja que más parece un reporte de movimientos (los reportes de Getnet
 * traen varias: transacciones, productos, tiempo aire…). */
export function elegirHoja(hojas: HojaLeida[]): string[][] {
  let mejor: HojaLeida | null = null;
  let mejorPuntaje = -1;
  for (const h of hojas) {
    const i = buscarEncabezado(h.filas);
    if (i < 0) continue;
    const c = detectarColumnas(h.filas[i]);
    const datos = h.filas.slice(i + 1).filter((f) => c.monto !== undefined && parsearMonto(f[c.monto] ?? "") !== null).length;
    const puntaje = (c.monto !== undefined ? 1000 : 0) + datos;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = h;
    }
  }
  return (mejor ?? hojas.find((h) => h.filas.length > 0) ?? { filas: [] as string[][] }).filas;
}

function textoDeXml(fragmento: string): string {
  return entidadesXml(fragmento.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Muchos portales entregan con extensión .xls una tabla HTML (o un XML de
 * Excel 2003): se lee la tabla sin más. */
export function leerTablaMarcada(texto: string): string[][] {
  const esHtml = /<tr[\s>]/i.test(texto);
  const patronFila = esHtml ? /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi : /<Row\b[^>]*>([\s\S]*?)<\/Row>/g;
  const patronCelda = esHtml ? /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi : /<Cell\b[^>]*>([\s\S]*?)<\/Cell>/g;
  const filas: string[][] = [];
  for (const fila of texto.matchAll(patronFila)) {
    const celdas = [...fila[1].matchAll(patronCelda)].map((c) => textoDeXml(c[1]));
    if (celdas.some((c) => c !== "")) filas.push(celdas);
  }
  return filas;
}

/** Lee el archivo que se subió (CSV, TXT, Excel .xlsx o tabla HTML/XML) como una tabla. */
export async function leerArchivoTabla(nombre: string, bytes: Uint8Array): Promise<string[][]> {
  const esZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (esZip) return leerXlsx(bytes);
  const inicio = new TextDecoder().decode(bytes.subarray(0, 600));
  if (/^\s*(<\?xml|<!doctype|<html|<table)/i.test(inicio)) {
    const tabla = leerTablaMarcada(decodificarTexto(bytes));
    if (tabla.length > 0) return tabla;
  }
  if (bytes.length > 8 && FIRMA_CFB.every((b, i) => bytes[i] === b)) return elegirHoja(leerXls(bytes));
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

/** ¿Difieren como mucho en un carácter (cambiado, sobrante o faltante)? */
function casiIguales(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [larga, corta] = a.length > b.length ? [a, b] : [b, a];
  return larga.slice(i + 1) === corta.slice(i);
}

export interface ReferenciaParecida {
  referencia: string;
  movimientos: number;
  total: number;
}

export interface ReporteInterpretado {
  /** Movimientos con una referencia que difiere en un solo dígito de la del servicio
   * (un error de captura en la terminal, quizá): no se incluyen, solo se avisa. */
  referenciasParecidas: ReferenciaParecida[];
  movimientos: MovimientoGetnet[];
  encabezado: string[];
  filaEncabezado: number;
  columnas: Columnas;
  ignoradas: { otraFecha: number; otraReferencia: number; rechazadas: number; sinMonto: number; fechaIlegible: number };
  /** Cosas que no se pudieron verificar y que quien sube el reporte debe
   * reconocer antes de comparar (fechas ilegibles, referencia o fecha sin verificar). */
  confirmaciones: string[];
  /** Si se encontró la referencia del servicio en el archivo (o no había que buscarla). */
  referenciaEncontrada: boolean;
  /** Días que trae el archivo, para avisar si es de otro día. */
  fechasEnArchivo: string[];
  avisos: string[];
}

const SIN_LETRAS_NI_CEROS = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+/, "");
// Una referencia coincide si es IGUAL a la celda, o a una de sus palabras
// ("Afiliación 566029", "566029 - Odontología"), sin importar ceros a la
// izquierda. Nunca por contener la secuencia dentro de otra ("15660299",
// "ABC566029XYZ" son otras referencias).
function coincideReferencia(celda: string, ref: string): boolean {
  if (ref === "") return false;
  if (SIN_LETRAS_NI_CEROS(celda) === ref) return true;
  return celda.split(/[^A-Za-z0-9]+/).filter(Boolean).some((t) => SIN_LETRAS_NI_CEROS(t) === ref);
}

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
    ignoradas: { otraFecha: 0, otraReferencia: 0, rechazadas: 0, sinMonto: 0, fechaIlegible: 0 },
    confirmaciones: [], referenciasParecidas: [], referenciaEncontrada: true, fechasEnArchivo: [], avisos,
  });
  if (columnas.monto === undefined) {
    avisos.push("No se encontró la columna del monto. Elígela abajo.");
    return vacio();
  }

  const datos = filas.slice(filaEncabezado + 1);
  const ref = opciones.referencia ? SIN_LETRAS_NI_CEROS(opciones.referencia) : "";
  const celdaCoincide = (celda: string) => coincideReferencia(celda, ref);

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

  const ignoradas = { otraFecha: 0, otraReferencia: 0, rechazadas: 0, sinMonto: 0, fechaIlegible: 0 };
  const parecidas = new Map<string, ReferenciaParecida>();
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
    if (columnas.estatus !== undefined && /(rechaz|declin|denegad|no aprobad|fallid|error)/.test(normalizar(fila[columnas.estatus] ?? ""))) {
      ignoradas.rechazadas++;
      continue;
    }
    if (!cumpleReferencia(fila)) {
      ignoradas.otraReferencia++;
      if (ref.length >= 5) {
        for (const i of columnas.referencia) {
          const celda = fila[i] ?? "";
          const parecido = [celda, ...celda.split(/[^A-Za-z0-9]+/)].map(SIN_LETRAS_NI_CEROS).find((t) => t.length >= 5 && casiIguales(t, ref));
          if (parecido) {
            const literal = (celda.split(/[^A-Za-z0-9]+/).find((t) => SIN_LETRAS_NI_CEROS(t) === parecido) ?? celda).trim();
            const previo = parecidas.get(literal) ?? { referencia: literal, movimientos: 0, total: 0 };
            previo.movimientos++;
            previo.total = Math.round((previo.total + Math.abs(monto)) * 100) / 100;
            parecidas.set(literal, previo);
            break;
          }
        }
      }
      continue;
    }
    const { fecha, hora: horaDeFecha } = columnas.fecha !== undefined ? parsearFechaHora(fila[columnas.fecha] ?? "") : { fecha: null, hora: undefined };
    // Con columna de fecha, una fila cuya fecha no se puede leer (vacía o
    // imposible, como 31/02/2026) no se da por buena: se omite y se avisa.
    if (columnas.fecha !== undefined && fecha === null) {
      ignoradas.fechaIlegible++;
      continue;
    }
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

  const confirmaciones: string[] = [];
  if (ignoradas.fechaIlegible > 0) {
    confirmaciones.push(`${ignoradas.fechaIlegible} fila(s) con fecha ilegible o vacía se omitieron: revísalas en el archivo antes de comparar.`);
  }
  if (!referenciaEncontrada && ref) confirmaciones.push(`No se pudo verificar la referencia ${opciones.referencia} en el archivo.`);
  if (columnas.fecha === undefined) confirmaciones.push("No se pudo verificar la fecha: el archivo no trae una columna de fecha.");
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

  if (ignoradas.fechaIlegible > 0) avisos.push(`${ignoradas.fechaIlegible} fila(s) con fecha ilegible o vacía se omitieron.`);
  const referenciasParecidas = [...parecidas.values()];
  for (const p of referenciasParecidas) {
    avisos.push(`${p.movimientos} movimiento(s) por $${p.total.toFixed(2)} traen la referencia ${p.referencia}, casi igual a ${opciones.referencia}: no se incluyeron. Si son de este servicio, hay un error de captura en la terminal.`);
  }
  return { movimientos, encabezado, filaEncabezado, columnas, ignoradas, confirmaciones, referenciasParecidas, referenciaEncontrada, fechasEnArchivo, avisos };
}
