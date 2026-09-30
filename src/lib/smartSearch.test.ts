// Pruebas del clasificador de preguntas de Quick (el modo sin IA).
// Correr con: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interpretarConsulta, esSaludo, LARGO_MAX_CONSULTA } from "./smartSearch.ts";

// Martes 29 de septiembre de 2026, mediodía.
const AHORA = new Date(2026, 8, 29, 12);
const q = (texto: string) => interpretarConsulta(texto, AHORA);

describe("preguntas de dinero", () => {
  test("cuánto cobré/llevo + un día → corte de caja de ese día", () => {
    assert.deepEqual(q("cuánto cobré ayer"), { tipo: "corte", fecha: "2026-09-28" });
    assert.deepEqual(q("cuánto llevo hoy"), { tipo: "corte", fecha: "2026-09-29" });
    assert.deepEqual(q("ingresos de antier"), { tipo: "corte", fecha: "2026-09-27" });
  });

  test("con 'esta semana' o un mes o un año", () => {
    assert.deepEqual(q("cuánto llevo esta semana"), { tipo: "libre", desde: "2026-09-28", hasta: "2026-09-29", metrica: "total", agruparPor: "dia" });
    assert.deepEqual(q("cuánto llevo este mes"), { tipo: "resumen", mes: "2026-09" });
    assert.deepEqual(q("cuánto gané en 2025"), { tipo: "estadistica", metrica: "total", desde: "2025-01-01", hasta: "2025-12-31" });
  });

  test("un saludo al inicio no estorba", () => {
    assert.deepEqual(q("hola cuánto cobré ayer?"), { tipo: "corte", fecha: "2026-09-28" });
    assert.deepEqual(q("Quick, ¿cuánto llevo este mes?"), { tipo: "resumen", mes: "2026-09" });
  });
});

describe("cortes de caja", () => {
  test("'corte de caja' y 'cierre de caja'", () => {
    assert.deepEqual(q("corte de caja de hoy"), { tipo: "corte", fecha: "2026-09-29" });
    assert.deepEqual(q("cierre de caja 3/09"), { tipo: "corte", fecha: "2026-09-03" });
  });

  test("'corte' o 'cierre' solos, con una fecha, también", () => {
    assert.deepEqual(q("corte del 15 de septiembre"), { tipo: "corte", fecha: "2026-09-15" });
    assert.deepEqual(q("cierre de ayer"), { tipo: "corte", fecha: "2026-09-28" });
  });

  test("'corte' sin fecha sigue siendo una búsqueda por nombre (un apellido)", () => {
    assert.deepEqual(q("folios de José Corte"), { tipo: "busqueda", texto: "José Corte" });
  });
});

describe("otras preguntas", () => {
  test("ranking de procedimientos, mejor/peor, comparación, créditos, persona", () => {
    assert.equal(q("qué procedimiento se vendió más este mes").tipo, "estadistica");
    assert.deepEqual(q("cuál fue mi mejor mes"), { tipo: "grafica", meses: 12, proyectar: false });
    assert.equal(q("cómo voy comparado con el mes pasado").tipo, "comparacion");
    assert.equal(q("cuánto me deben").tipo, "creditos");
    assert.deepEqual(q("cuánto ha pagado Ana García"), { tipo: "persona", nombre: "Ana García" });
  });

  test("un nombre, un folio o una matrícula son búsquedas", () => {
    for (const texto of ["Ana García", "F260929-0001", "S0100051", "2021012345", "ID 15/09"]) {
      assert.equal(q(texto).tipo, "busqueda", texto);
    }
  });
});

describe("saludos", () => {
  test("solo saludo, con o sin el nombre de Quick", () => {
    for (const texto of ["hola", "Hola Quick", "¡Buenas tardes, Quick!", "Quick"]) assert.equal(esSaludo(texto), true, texto);
    assert.equal(esSaludo("hola cuánto cobré"), false);
  });
});

describe("entradas hostiles", () => {
  test("un texto enorme con una palabra repetida no congela (antes: 860 ms con 65 KB, tiempo cuadrático)", () => {
    const inicio = performance.now();
    q("procedimiento ".repeat(50_000) + "zzz");
    q("mas ".repeat(200_000) + " procedimientos");
    assert.ok(performance.now() - inicio < 100, `tardó ${(performance.now() - inicio).toFixed(0)} ms`);
  });

  test("nunca lanza, ni con caracteres raros", () => {
    for (const texto of ["", " ", "\u0000", "\uD800", "🙂".repeat(1000), "%_", "((", "[", "a".repeat(100_000), "hoy".repeat(1000)]) {
      const c = q(texto);
      assert.equal(typeof c.tipo, "string");
      esSaludo(texto);
    }
  });

  test("el tope de largo es el mismo que el del campo de texto", () => {
    assert.equal(LARGO_MAX_CONSULTA, 300);
    const largo = "x".repeat(1000);
    const c = q(largo);
    assert.equal(c.tipo, "busqueda");
    if (c.tipo === "busqueda") assert.ok(c.texto.length <= LARGO_MAX_CONSULTA);
  });
});
