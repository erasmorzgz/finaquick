// Cobertura de las rutas /asistente/* (Quick) — sin GEMINI_API_KEY en
// el entorno de estas pruebas, así que iaConfigurada es siempre false
// (ver asistente.ts) y las tres rutas deben caer de vuelta a 204 de
// forma silenciosa para CUALQUIER entrada, nunca tronar. Eso es
// justamente lo que se prueba aquí: que un servidor sin la IA
// configurada (la instalación por default de cualquier institución que
// no haya puesto su propia clave de Gemini) nunca se comporta como si
// algo estuviera roto — y que, antes siquiera de llegar a esa
// verificación "sin configurar", la validación de entrada de cada ruta
// sigue rechazando con 400 lo que ya rechazaba antes.
//
// Lo que este archivo NO prueba (no se puede, sin una clave real de
// Gemini en este entorno): la clasificación real de una pregunta, la
// redacción real de una respuesta, ni el chat libre contestando de
// verdad — eso depende de un proveedor externo que esta suite no
// puede alcanzar. Solo se puede confirmar probándolo a mano, con una
// GEMINI_API_KEY real, después de instalar.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  prepararBaseDeDatos,
  borrarBaseDeDatos,
  iniciarServidor,
  detenerServidor,
  crearCliente,
  crearOrgConInvitacion,
  TOKEN_INVITACION_PRUEBA,
} from "./helpers.js";
import { validarDigesto } from "../src/asistente.js";

let admin: ReturnType<typeof crearCliente>;

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();
  await crearOrgConInvitacion("Org Asistente", "admin.asistente@lxl.test", "admin");
  admin = crearCliente();
  await admin.pedirJson("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({
      nombre: "Admin Asistente",
      correo: "admin.asistente@lxl.test",
      password: "ClaveSegura123!",
      token: TOKEN_INVITACION_PRUEBA,
    }),
  });
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

describe("POST /asistente/interpretar", () => {
  test("sin GEMINI_API_KEY configurada, una pregunta válida cae a 204 (no un error)", async () => {
    const { status, cuerpo } = await admin.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "cuánto cobré ayer" }),
    });
    assert.equal(status, 204);
    assert.deepEqual(cuerpo, {});
  });

  test("rechaza sin texto", async () => {
    const { status } = await admin.pedirJson("/asistente/interpretar", { method: "POST", body: JSON.stringify({}) });
    assert.equal(status, 400);
  });

  test("rechaza un texto de más de 200 caracteres", async () => {
    const { status } = await admin.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "a".repeat(201) }),
    });
    assert.equal(status, 400);
  });

  test("rechaza un historial que no es un arreglo", async () => {
    const { status } = await admin.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "algo", historial: "no es arreglo" }),
    });
    assert.equal(status, 400);
  });

  test("rechaza un historial con más de 5 preguntas anteriores", async () => {
    const { status } = await admin.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "algo", historial: Array(6).fill("pregunta anterior") }),
    });
    assert.equal(status, 400);
  });

  test("rechaza una entrada del historial que no sea texto corto", async () => {
    const { status } = await admin.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "algo", historial: ["a".repeat(201)] }),
    });
    assert.equal(status, 400);
  });

  test("exige sesión iniciada", async () => {
    const sinSesion = crearCliente();
    const { status } = await sinSesion.pedirJson("/asistente/interpretar", {
      method: "POST",
      body: JSON.stringify({ texto: "algo" }),
    });
    assert.equal(status, 401);
  });
});

describe("POST /asistente/narrar", () => {
  test("sin GEMINI_API_KEY configurada, cae a 204 aunque el resumen sea válido", async () => {
    const { status } = await admin.pedirJson("/asistente/narrar", {
      method: "POST",
      body: JSON.stringify({ tipo: "resumen", resumen: { total: 1000, folios: 5 } }),
    });
    assert.equal(status, 204);
  });

  test("también cae a 204 (no 400/500) con un resumen con forma inválida — narrarResultado nunca lanza", async () => {
    const { status } = await admin.pedirJson("/asistente/narrar", {
      method: "POST",
      body: JSON.stringify({ tipo: "resumen", resumen: { anidado: { esto: "no debería pasar" } } }),
    });
    assert.equal(status, 204);
  });

  test("exige sesión iniciada", async () => {
    const sinSesion = crearCliente();
    const { status } = await sinSesion.pedirJson("/asistente/narrar", {
      method: "POST",
      body: JSON.stringify({ tipo: "resumen", resumen: { total: 1 } }),
    });
    assert.equal(status, 401);
  });
});

describe("POST /asistente/chat", () => {
  test("sin GEMINI_API_KEY configurada, una pregunta válida cae a 204", async () => {
    const { status } = await admin.pedirJson("/asistente/chat", {
      method: "POST",
      body: JSON.stringify({ texto: "cómo voy este mes", digesto: { hoy: "2026-01-01" } }),
    });
    assert.equal(status, 204);
  });

  test("rechaza sin texto", async () => {
    const { status } = await admin.pedirJson("/asistente/chat", { method: "POST", body: JSON.stringify({ digesto: {} }) });
    assert.equal(status, 400);
  });

  test("rechaza un texto de más de 500 caracteres", async () => {
    const { status } = await admin.pedirJson("/asistente/chat", {
      method: "POST",
      body: JSON.stringify({ texto: "a".repeat(501), digesto: {} }),
    });
    assert.equal(status, 400);
  });

  test("rechaza un historial que no es un arreglo de texto corto", async () => {
    const { status } = await admin.pedirJson("/asistente/chat", {
      method: "POST",
      body: JSON.stringify({ texto: "algo", historial: [123], digesto: {} }),
    });
    assert.equal(status, 400);
  });

  test("exige sesión iniciada", async () => {
    const sinSesion = crearCliente();
    const { status } = await sinSesion.pedirJson("/asistente/chat", {
      method: "POST",
      body: JSON.stringify({ texto: "algo" }),
    });
    assert.equal(status, 401);
  });
});

describe("Límite de tasa del asistente", () => {
  test("corta con 429 después de 40 peticiones en la ventana, compartido entre las tres rutas", async () => {
    // El límite (ver limitadorAsistente en index.ts) es de 40 en 15
    // minutos, compartido por las tres rutas /api/asistente/* — se
    // agota con la más barata (interpretar, sin digesto que armar) y
    // se confirma que la petición 41 sí se bloquea.
    let ultimoStatus = 200;
    for (let i = 0; i < 41; i++) {
      const { status } = await admin.pedirJson("/asistente/interpretar", {
        method: "POST",
        body: JSON.stringify({ texto: `pregunta ${i}` }),
      });
      ultimoStatus = status;
    }
    assert.equal(ultimoStatus, 429);
  });
});

describe("validarDigesto — validación del resumen del chat libre (incluye foliosDetalle, con nombres reales)", () => {
  // Forma mínima válida, sin foliosDetalle — todos los campos que el
  // validador exige sin "=== undefined ||" (es decir, no opcionales).
  const base = {
    hoy: "2026-01-01",
    esteMes: { mes: "2026-01", total: 100, folios: 1 },
    mesPasado: { mes: "2025-12", total: 100, folios: 1 },
    esteAnio: { total: 100, folios: 1 },
    ultimos12Meses: [],
    porFormaPago: [],
    topProcedimientos: [],
    topCategorias: [],
    creditosPendientes: { total: 0, folios: 0 },
  };

  test("acepta el resumen mínimo sin foliosDetalle (sigue siendo opcional)", () => {
    assert.notEqual(validarDigesto(base), null);
  });

  test("acepta foliosDetalle con una fila real y bien formada", () => {
    const conFolios = {
      ...base,
      foliosDetalle: [
        { folio: "F260101-0001", nombre: "Ana Martínez", fecha: "2026-01-01", categoria: "Consulta general", total: 350, estado: "pagado", formaPago: "Efectivo" },
      ],
    };
    assert.notEqual(validarDigesto(conFolios), null);
  });

  test("acepta formaPago null (folios en crédito, sin forma de pago todavía)", () => {
    const conCredito = {
      ...base,
      foliosDetalle: [
        { folio: "F260101-0002", nombre: "Luis Torres", fecha: "2026-01-01", categoria: "Consulta general", total: 500, estado: "credito", formaPago: null },
      ],
    };
    assert.notEqual(validarDigesto(conCredito), null);
  });

  test("rechaza más de 300 filas en foliosDetalle", () => {
    const fila = { folio: "F1", nombre: "X", fecha: "2026-01-01", categoria: "C", total: 1, estado: "pagado", formaPago: "Efectivo" };
    const conDemasiadas = { ...base, foliosDetalle: Array(301).fill(fila) };
    assert.equal(validarDigesto(conDemasiadas), null);
  });

  test("rechaza un estado que no sea 'pagado' ni 'credito'", () => {
    const conEstadoInvalido = {
      ...base,
      foliosDetalle: [{ folio: "F1", nombre: "X", fecha: "2026-01-01", categoria: "C", total: 1, estado: "cancelado", formaPago: null }],
    };
    assert.equal(validarDigesto(conEstadoInvalido), null);
  });

  test("rechaza una forma de pago que no esté en la lista cerrada", () => {
    const conFormaInvalida = {
      ...base,
      foliosDetalle: [{ folio: "F1", nombre: "X", fecha: "2026-01-01", categoria: "C", total: 1, estado: "pagado", formaPago: "Bitcoin" }],
    };
    assert.equal(validarDigesto(conFormaInvalida), null);
  });

  test("rechaza una fila sin nombre", () => {
    const sinNombre = {
      ...base,
      foliosDetalle: [{ folio: "F1", fecha: "2026-01-01", categoria: "C", total: 1, estado: "pagado", formaPago: null }],
    };
    assert.equal(validarDigesto(sinNombre), null);
  });

  test("rechaza un total que no sea número", () => {
    const totalInvalido = {
      ...base,
      foliosDetalle: [{ folio: "F1", nombre: "X", fecha: "2026-01-01", categoria: "C", total: "350", estado: "pagado", formaPago: null }],
    };
    assert.equal(validarDigesto(totalInvalido), null);
  });

  test("rechaza el resumen completo si falta un campo requerido (esteAnio)", () => {
    const { esteAnio: _esteAnio, ...sinEsteAnio } = base;
    assert.equal(validarDigesto(sinEsteAnio), null);
  });
});
