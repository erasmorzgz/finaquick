// Pruebas del lector del reporte de Getnet. Correr con: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  parsearCSV, parsearMonto, parsearFechaHora, detectarColumnas, interpretarReporte,
  leerArchivoTabla, leerXlsx, decodificarTexto, huellaArchivo,
} from "./getnet.ts";

const CSV_GETNET = [
  "Reporte de operaciones,,,,,,",
  "Fecha de generación,30/09/2026,,,,,",
  ",,,,,,",
  "Afiliación,Fecha de la transacción,Hora,Número de autorización,Tipo de transacción,Monto de la venta,Comisión",
  "566029,30/09/2026,09:15:22,A10001,Venta,\"$1,150.00\",$41.40",
  "566029,30/09/2026,10:02:10,A10002,Venta,$320.50,$11.54",
  "566029,30/09/2026,11:45:00,A10003,Cancelación,$75.00,$0.00",
  "566029,30/09/2026,11:30:00,A10004,Venta,$75.00,$2.70",
  "566029,29/09/2026,17:00:00,A09999,Venta,$500.00,$18.00",
  "777888,30/09/2026,12:00:00,B20001,Venta,$999.00,$36.00",
  "Total,,,,,\"$3,119.50\",",
].join("\r\n");

describe("Montos y fechas", () => {
  test("montos en distintos formatos", () => {
    const casos: [string, number | null][] = [
      ["$1,234.50", 1234.5], ["1234.5", 1234.5], ["1.234,50", 1234.5], ["1,5", 1.5], ["150", 150],
      ["(150.00)", -150], ["-75.10", -75.1], ["75.10-", -75.1], ["$ 2 500.00", 2500], ["1.234", 1234], ["0.5", 0.5],
      ["", null], ["abc", null], ["1,2,3x", null], ["$", null],
    ];
    for (const [texto, esperado] of casos) assert.equal(parsearMonto(texto), esperado, texto);
  });

  test("fechas y horas en formatos de México y de Excel", () => {
    assert.deepEqual(parsearFechaHora("30/09/2026 14:32:10"), { fecha: "2026-09-30", hora: "14:32" });
    assert.deepEqual(parsearFechaHora("2026-09-30T08:05:00"), { fecha: "2026-09-30", hora: "08:05" });
    assert.deepEqual(parsearFechaHora("1/10/2026"), { fecha: "2026-10-01", hora: undefined });
    assert.deepEqual(parsearFechaHora("30-sep-2026"), { fecha: "2026-09-30", hora: undefined });
    assert.deepEqual(parsearFechaHora("30 de septiembre de 2026"), { fecha: "2026-09-30", hora: undefined });
    assert.deepEqual(parsearFechaHora("20260930"), { fecha: "2026-09-30", hora: undefined });
    assert.deepEqual(parsearFechaHora("30/09/2026 02:15 p. m."), { fecha: "2026-09-30", hora: "14:15" });
    assert.equal(parsearFechaHora("46295").fecha, "2026-09-30"); // serie de Excel
    assert.equal(parsearFechaHora("31/02/2026").fecha, null);
    assert.equal(parsearFechaHora("no es fecha").fecha, null);
  });
});

describe("CSV", () => {
  test("detecta coma, punto y coma y tabulador, y respeta las comillas", () => {
    assert.deepEqual(parsearCSV('a,b\n"x,y",2'), [["a", "b"], ["x,y", "2"]]);
    assert.deepEqual(parsearCSV("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(parsearCSV("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parsearCSV('a,b\n"di ""hola""",2'), [["a", "b"], ['di "hola"', "2"]]);
  });

  test("las líneas de título sin separadores arriba de la tabla no confunden al detectar", () => {
    assert.deepEqual(parsearCSV("Reporte de operaciones Getnet\nAfiliación,Monto\n566029,10"), [["Reporte de operaciones Getnet"], ["Afiliación", "Monto"], ["566029", "10"]]);
    assert.deepEqual(parsearCSV("Reporte\nGenerado hoy\na;b;c\n1;2;3"), [["Reporte"], ["Generado hoy"], ["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(parsearCSV("a\tb\n1\t2\n3,4\t5"), [["a", "b"], ["1", "2"], ["3,4", "5"]]);
    assert.deepEqual(parsearCSV("solo una columna\notra"), [["solo una columna"], ["otra"]]);
  });

  test("Windows-1252 (Excel en español) y BOM de UTF-8", () => {
    const latin1 = Uint8Array.from([0x41, 0x75, 0x74, 0x6f, 0x72, 0x69, 0x7a, 0x61, 0x63, 0x69, 0xf3, 0x6e]); // "Autorización" sin la "ó" en UTF-8
    assert.equal(decodificarTexto(latin1), "Autorización");
    const conBom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);
    assert.equal(decodificarTexto(conBom), "a");
  });

  test("sin líneas vacías ni retornos de carro sueltos", () => {
    assert.deepEqual(parsearCSV("a,b\r\n\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  });
});

describe("Interpretación del reporte", () => {
  const filas = parsearCSV(CSV_GETNET);

  test("encuentra el encabezado entre las líneas de título y detecta las columnas", () => {
    const r = interpretarReporte(filas, { fecha: "2026-09-30", referencia: "566029" });
    assert.equal(r.filaEncabezado, 2); // las líneas vacías del archivo no cuentan
    assert.equal(r.encabezado[r.columnas.monto!], "Monto de la venta");
    assert.equal(r.encabezado[r.columnas.fecha!], "Fecha de la transacción");
    assert.equal(r.encabezado[r.columnas.autorizacion!], "Número de autorización");
    assert.equal(r.encabezado[r.columnas.tipo!], "Tipo de transacción");
  });

  test("toma solo la referencia y el día pedidos, con ventas y cancelaciones", () => {
    const r = interpretarReporte(filas, { fecha: "2026-09-30", referencia: "566029" });
    assert.deepEqual(
      r.movimientos.map((m) => [m.monto, m.tipo, m.autorizacion, m.hora]),
      [
        [1150, "venta", "A10001", "09:15"],
        [320.5, "venta", "A10002", "10:02"],
        [75, "cancelacion", "A10003", "11:45"],
        [75, "venta", "A10004", "11:30"],
      ]
    );
    assert.equal(r.ignoradas.otraFecha, 1);
    assert.equal(r.ignoradas.otraReferencia, 1);
    assert.equal(r.ignoradas.sinMonto, 1); // la fila de "Total" del propio reporte
    assert.equal(r.referenciaEncontrada, true);
  });

  test("avisa si el reporte es de otro día, o si no trae la referencia", () => {
    const otroDia = interpretarReporte(filas, { fecha: "2026-10-05", referencia: "566029" });
    assert.equal(otroDia.movimientos.length, 0);
    assert.ok(otroDia.avisos.some((a) => a.includes("2026-09-29") || a.includes("no trae movimientos")), otroDia.avisos.join("|"));
    const otraReferencia = interpretarReporte(filas, { fecha: "2026-09-30", referencia: "123456" });
    assert.equal(otraReferencia.referenciaEncontrada, false);
    assert.equal(otraReferencia.movimientos.length, 0);
    assert.ok(otraReferencia.avisos.some((a) => a.includes("123456")));
  });

  test("sin referencia en el servicio toma todos los movimientos del día", () => {
    const r = interpretarReporte(filas, { fecha: "2026-09-30" });
    assert.equal(r.movimientos.length, 5);
  });

  test("un archivo ya filtrado, sin columna de referencia, se toma completo con un aviso", () => {
    const sinRef = parsearCSV("Fecha,Autorización,Importe\n30/09/2026,A1,100.00\n30/09/2026,A2,50.50");
    const r = interpretarReporte(sinRef, { fecha: "2026-09-30", referencia: "566029" });
    assert.equal(r.movimientos.length, 2);
    assert.equal(r.referenciaEncontrada, false);
    assert.ok(r.avisos.some((a) => a.includes("566029")));
  });

  test("las operaciones rechazadas no cuentan; los montos negativos son cancelaciones", () => {
    const filas2 = parsearCSV("Fecha,Monto,Estatus\n30/09/2026,100,Aprobada\n30/09/2026,200,Rechazada\n30/09/2026,-40,Aprobada");
    const r = interpretarReporte(filas2, { fecha: "2026-09-30" });
    assert.deepEqual(r.movimientos.map((m) => [m.monto, m.tipo]), [[100, "venta"], [40, "cancelacion"]]);
    assert.equal(r.ignoradas.rechazadas, 1);
  });

  test("elige la columna de monto de la venta, no la de comisión ni la del depósito", () => {
    const c = detectarColumnas(["Fecha", "Comisión", "IVA", "Monto neto a depositar", "Importe de la venta"]);
    assert.equal(c.monto, 4);
    const d = detectarColumnas(["Fecha de depósito", "Fecha de la venta", "Total"]);
    assert.equal(d.fecha, 1);
    assert.equal(d.monto, 2);
  });

  test("sin columna de monto reconocible avisa y permite indicarla a mano", () => {
    const rara = parsearCSV("Fecha,Autorización,Cargo\n30/09/2026,A1,100.00");
    const sin = interpretarReporte(rara, { fecha: "2026-09-30" });
    assert.equal(sin.movimientos.length, 0);
    assert.ok(sin.avisos.some((a) => a.includes("monto")));
    const conMano = interpretarReporte(rara, { fecha: "2026-09-30", columnas: { monto: 2 } });
    assert.deepEqual(conMano.movimientos.map((m) => m.monto), [100]);
  });

  test("el mismo archivo con punto y coma y montos con coma decimal", () => {
    const pc = parsearCSV("Fecha;Autorización;Monto\n30/09/2026;A1;1.234,50\n30/09/2026;A2;99,90");
    const r = interpretarReporte(pc, { fecha: "2026-09-30" });
    assert.deepEqual(r.movimientos.map((m) => m.monto), [1234.5, 99.9]);
  });

  test("una tabla vacía o sin nada útil no lanza", () => {
    assert.doesNotThrow(() => interpretarReporte([], { fecha: "2026-09-30" }));
    assert.doesNotThrow(() => interpretarReporte([["x"]], { fecha: "2026-09-30", referencia: "1" }));
    assert.equal(interpretarReporte([], { fecha: "2026-09-30" }).movimientos.length, 0);
  });
});

// ---------------------------------------------------------------------
// Excel: se arma un .xlsx de verdad (ZIP con XML) para probar el lector.
// ---------------------------------------------------------------------
const TABLA_CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function crearZip(archivos: Record<string, string>, comprimir = true): Uint8Array {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const datos = Buffer.from(texto, "utf8");
    const dentro = comprimir ? deflateRawSync(datos) : datos;
    const nombreBuf = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(comprimir ? 8 : 0, 8);
    local.writeUInt32LE(crc32(datos), 14); local.writeUInt32LE(dentro.length, 18); local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    partes.push(local, nombreBuf, dentro);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(comprimir ? 8 : 0, 10);
    c.writeUInt32LE(crc32(datos), 16); c.writeUInt32LE(dentro.length, 20); c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(nombreBuf.length, 28); c.writeUInt32LE(desplazamiento, 42);
    central.push(c, nombreBuf);
    desplazamiento += 30 + nombreBuf.length + dentro.length;
  }
  const centralBuf = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(centralBuf.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return new Uint8Array(Buffer.concat([...partes, centralBuf, fin]));
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function crearXlsx(filas: (string | number)[][], comprimir = true): Uint8Array {
  const compartidas: string[] = [];
  const filasXml = filas.map((fila, i) => {
    const celdas = fila.map((valor, j) => {
      const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
      if (typeof valor === "number") return `<c r="${ref}"><v>${valor}</v></c>`;
      let indice = compartidas.indexOf(valor);
      if (indice < 0) indice = compartidas.push(valor) - 1;
      return `<c r="${ref}" t="s"><v>${indice}</v></c>`;
    });
    return `<row r="${i + 1}">${celdas.join("")}</row>`;
  });
  return crearZip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": '<workbook><sheets><sheet name="Reporte" sheetId="1" r:id="rId7"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/hoja1.xml"/></Relationships>',
    "xl/sharedStrings.xml": `<sst>${compartidas.map((t) => `<si><t>${escapar(t)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/hoja1.xml": `<worksheet><sheetData>${filasXml.join("")}</sheetData></worksheet>`,
  }, comprimir);
}

describe("Excel (.xlsx)", () => {
  const filas = [
    ["Reporte de operaciones"],
    ["Afiliación", "Fecha de la transacción", "Número de autorización", "Tipo de transacción", "Monto de la venta"],
    ["566029", 46295.5, "A1", "Venta", 1150.5],
    ["566029", 46295.75, "A2", "Cancelación", 75],
    ["Fila con & y <ángulos>", "", "", "", ""],
  ];

  test("lee celdas de texto y números, con la hoja que indica el libro", async () => {
    const tabla = await leerXlsx(crearXlsx(filas));
    assert.equal(tabla[1][1], "Fecha de la transacción");
    assert.equal(tabla[2][4], "1150.5");
    assert.equal(tabla[4][0], "Fila con & y <ángulos>");
  });

  test("también sin comprimir", async () => {
    const tabla = await leerXlsx(crearXlsx(filas, false));
    assert.equal(tabla[2][2], "A1");
  });

  test("de punta a punta: fechas de Excel, montos y cancelación", async () => {
    const tabla = await leerArchivoTabla("getnet.xlsx", crearXlsx(filas));
    const r = interpretarReporte(tabla, { fecha: "2026-09-30", referencia: "566029" });
    assert.deepEqual(r.movimientos.map((m) => [m.monto, m.tipo, m.autorizacion, m.hora]), [[1150.5, "venta", "A1", "12:00"], [75, "cancelacion", "A2", "18:00"]]);
  });

  test("un archivo dañado, un PDF y un .xls antiguo dan un error claro, no una excepción rara", async () => {
    await assert.rejects(leerXlsx(Uint8Array.from([0x50, 0x4b, 1, 2, 3, 4, 5, 6])), /Excel/);
    await assert.rejects(leerArchivoTabla("r.pdf", Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])), /PDF/);
    await assert.rejects(leerArchivoTabla("r.xls", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1])), /\.xlsx|CSV/);
    const truncado = crearXlsx(filas).slice(0, 60);
    await assert.rejects(leerXlsx(truncado));
  });

  test("un CSV normal también entra por leerArchivoTabla", async () => {
    const tabla = await leerArchivoTabla("getnet.csv", new TextEncoder().encode(CSV_GETNET));
    assert.equal(interpretarReporte(tabla, { fecha: "2026-09-30", referencia: "566029" }).movimientos.length, 4);
  });

  test("la huella del archivo es un SHA-256 estable", async () => {
    const h = await huellaArchivo(new TextEncoder().encode("abc"));
    assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
