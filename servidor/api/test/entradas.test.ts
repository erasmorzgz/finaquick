// Entradas mal formadas u hostiles: una petición que la API no puede
// atender por culpa de lo que MANDÓ quien llama debe recibir un 4xx
// claro — nunca un 500 (que le hace creer a quien administra que algo
// se rompió y ensucia el registro de errores reales) ni una página con
// el stack trace del servidor. Cada prueba de aquí corresponde a un
// defecto encontrado mandando datos hostiles a todas las rutas.
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
  URL_BASE,
} from "./helpers.js";

let admin: ReturnType<typeof crearCliente>;
let adminId: string;
let orgId: string;
let servicioId: string;
const UUID_QUE_NO_EXISTE = "00000000-0000-4000-8000-000000000000";

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();
  orgId = await crearOrgConInvitacion("Org Entradas", "admin.entradas@lxl.test", "admin");
  admin = crearCliente();
  const { cuerpo } = await admin.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre: "Admin Entradas", correo: "admin.entradas@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
  });
  adminId = cuerpo.perfil.id;
  const { cuerpo: servicio } = await admin.pedirJson<{ id: string }>("/servicios", {
    method: "POST",
    body: JSON.stringify({ nombre: "Servicio Entradas", icono: "building", orgId }),
  });
  servicioId = servicio.id;
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

async function enviar(metodo: string, ruta: string, cuerpo?: unknown) {
  return admin.pedirJson<{ error?: string }>(ruta, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
}

describe("Errores de la propia petición: JSON, sin stack traces", () => {
  test("un cuerpo JSON mal formado da 400 en JSON — sin stack trace ni rutas del servidor", async () => {
    const res = await fetch(`${URL_BASE}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{esto no es json" });
    const texto = await res.text();
    assert.equal(res.status, 400);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.ok(!/node_modules|\.js:\d+|\.ts:\d+|\bat \w/.test(texto), `la respuesta filtra detalles internos: ${texto.slice(0, 200)}`);
    assert.equal(typeof JSON.parse(texto).error, "string");
  });

  test("lo mismo sin haber iniciado sesión (el cuerpo se procesa antes de la autenticación)", async () => {
    const res = await fetch(`${URL_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"correo":' });
    assert.equal(res.status, 400);
    assert.ok(!(await res.text()).includes("node_modules"));
  });

  test("un cuerpo demasiado grande da 413 en JSON", async () => {
    const res = await fetch(`${URL_BASE}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(200_000) }) });
    assert.equal(res.status, 413);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  });

  test("una ruta de la API que no existe da 404 en JSON", async () => {
    const res = await fetch(`${URL_BASE}/esto-no-existe`);
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: string }).error, "Esa ruta no existe.");
  });
});

describe("Identificadores mal formados: 400 en toda la API, nunca 500", () => {
  test("orgId / servicioId en la query", async () => {
    for (const ruta of [
      "/servicios?orgId=abc",
      "/invitaciones?orgId=%27",
      "/eventos?orgId=abc",
      "/finanzas/comparativo?orgId=abc",
      "/finanzas/ingresos-mensuales?orgId=abc",
      "/finanzas/pendiente-creditos?orgId=abc",
      "/categorias?servicioId=abc",
      "/procedimientos?servicioId=abc",
      "/tickets?servicioId=abc",
      "/tickets/siguiente-numero?servicioId=abc",
      "/requisiciones?servicioId=abc",
    ]) {
      const { status } = await enviar("GET", ruta);
      assert.equal(status, 400, `${ruta} debía dar 400`);
    }
  });

  test("un identificador repetido o anidado en la query tampoco se acepta", async () => {
    assert.equal((await enviar("GET", `/servicios?orgId=${orgId}&orgId=${orgId}`)).status, 400);
    assert.equal((await enviar("GET", `/servicios?orgId[x]=${orgId}`)).status, 400);
  });

  test(":id en la ruta", async () => {
    for (const [metodo, ruta, cuerpo] of [
      ["PATCH", "/servicios/abc", { nombre: "x" }],
      ["DELETE", "/servicios/abc", undefined],
      ["DELETE", "/invitaciones/abc", undefined],
      ["DELETE", "/categorias/abc", undefined],
      ["DELETE", "/procedimientos/abc", undefined],
      ["PATCH", "/usuarios/abc", { nombre: "x" }],
      ["PATCH", "/organizaciones/abc", { nombre: "x" }],
      ["GET", "/archivos/abc/contenido", undefined],
      ["POST", "/archivos/abc/leido", {}],
      ["PATCH", "/requisiciones/abc", { estado: "aprobada" }],
      ["POST", "/tickets/abc/pago", { formaPago: "Efectivo" }],
    ] as const) {
      const { status } = await enviar(metodo, ruta, cuerpo);
      assert.equal(status, 400, `${metodo} ${ruta} debía dar 400`);
    }
  });

  test("un UUID válido que no existe sigue siendo 404/403, no 400 ni 500", async () => {
    const { status } = await enviar("DELETE", `/categorias/${UUID_QUE_NO_EXISTE}`);
    assert.ok(status === 404 || status === 403, `dio ${status}`);
  });

  test("ids dentro del cuerpo de la petición", async () => {
    assert.equal((await enviar("POST", "/categorias", { nombre: "X", servicioId: "abc" })).status, 400);
    assert.equal((await enviar("POST", "/categorias", { nombre: "X" })).status, 400);
    assert.equal((await enviar("POST", "/servicios", { nombre: "X", icono: "building", orgId: "abc" })).status, 400);
    assert.equal((await enviar("PUT", "/procedimientos", { servicioId: "abc", nombre: "X", precio: 1 })).status, 400);
    assert.equal((await enviar("PUT", "/procedimientos", { id: 5, servicioId, nombre: "X", precio: 1 })).status, 400);
    assert.equal((await enviar("PUT", "/procedimientos", { id: "no-es-uuid", servicioId, nombre: "X", precio: 1 })).status, 400);
    assert.equal((await enviar("POST", "/eventos", { orgId: "abc", accion: "nota", detalle: "x" })).status, 400);
    assert.equal((await enviar("POST", "/invitaciones", { correo: "a@b.co", orgId: "abc", rol: "personal" })).status, 400);
    assert.equal((await enviar("POST", "/invitaciones", { correo: "a@b.co", orgId, rol: "personal", servicioIds: "abc" })).status, 400);
    assert.equal((await enviar("POST", "/invitaciones", { correo: "a@b.co", orgId, rol: "personal", servicioIds: ["no-uuid"] })).status, 400);
    assert.equal((await enviar("PATCH", `/usuarios/${adminId}`, { orgIds: "abc" })).status, 400);
    assert.equal((await enviar("PATCH", `/usuarios/${adminId}`, { servicioIds: [1, 2] })).status, 400);
  });

  test("una referencia con formato válido pero inexistente no es un 500", async () => {
    const { status } = await enviar("POST", "/categorias", { nombre: "X", servicioId: UUID_QUE_NO_EXISTE });
    assert.ok(status >= 400 && status < 500, `dio ${status}`);
  });
});

describe("Textos con caracteres que la base de datos no puede guardar", () => {
  test("el carácter NUL (\\u0000) da 400 en todos los campos de texto", async () => {
    const malo = "abc\u0000def";
    assert.equal((await enviar("POST", "/categorias", { nombre: malo, servicioId })).status, 400);
    assert.equal((await enviar("POST", "/servicios", { nombre: malo, icono: "building", orgId })).status, 400);
    assert.equal((await enviar("PATCH", `/usuarios/${adminId}`, { nombre: malo })).status, 400);
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { nombre: malo })).status, 400);
    assert.equal((await enviar("PATCH", `/organizaciones/${orgId}`, { nombre: malo })).status, 400);
    assert.equal((await enviar("POST", "/requisiciones", { servicioId, concepto: malo, cantidad: 1 })).status, 400);
    assert.equal((await enviar("POST", "/invitaciones", { correo: `a${malo}@b.co`, orgId, rol: "personal" })).status, 400);
  });
});

describe("Campos con el tipo o el valor equivocado", () => {
  test("actualizar un servicio o una organización sin ningún cambio da 400, no un error de SQL", async () => {
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, {})).status, 400);
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { campoInexistente: 1 })).status, 400);
    assert.equal((await enviar("PATCH", `/organizaciones/${orgId}`, {})).status, 400);
  });

  test("'activo' debe ser booleano y 'features' un objeto de booleanos", async () => {
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { activo: "si" })).status, 400);
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { features: "x" })).status, 400);
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { features: [true] })).status, 400);
    assert.equal((await enviar("PATCH", `/servicios/${servicioId}`, { features: { creditos: "x" } })).status, 400);
    const bien = await enviar("PATCH", `/servicios/${servicioId}`, { activo: true, features: { creditos: true, cierreCaja: true } });
    assert.equal(bien.status, 200);
  });

  test("la cantidad de una requisición tiene un tope", async () => {
    assert.equal((await enviar("POST", "/requisiciones", { servicioId, concepto: "Guantes", cantidad: 1e21 })).status, 400);
    assert.equal((await enviar("POST", "/requisiciones", { servicioId, concepto: "Guantes", cantidad: 100_001 })).status, 400);
    assert.equal((await enviar("POST", "/requisiciones", { servicioId, concepto: "Guantes", cantidad: 100_000 })).status, 200);
  });

  test("correo demasiado largo", async () => {
    const largo = `${"a".repeat(250)}@b.co`;
    assert.equal((await enviar("POST", "/invitaciones", { correo: largo, orgId, rol: "personal" })).status, 400);
  });
});

describe("Bitácora: parámetros de paginación", () => {
  test("'limit' negativo, decimal o basura no rompe la consulta", async () => {
    for (const limite of ["-5", "1.5", "abc", "0", "", "99999999999999999999"]) {
      const { status } = await enviar("GET", `/eventos?orgId=${orgId}&limit=${limite}`);
      assert.equal(status, 200, `limit=${limite} dio ${status}`);
    }
  });

  test("'antesDe' con una fecha inválida da 400; con una válida, 200", async () => {
    for (const mala of ["hoy", "2026-13-45", "9999-99-99", "%"]) {
      assert.equal((await enviar("GET", `/eventos?orgId=${orgId}&antesDe=${encodeURIComponent(mala)}`)).status, 400, mala);
    }
    assert.equal((await enviar("GET", `/eventos?orgId=${orgId}&antesDe=${encodeURIComponent(new Date().toISOString())}`)).status, 200);
  });
});

describe("Contraseñas con texto que no es Unicode válido, y el tiempo de respuesta del login", () => {
  const SUSTITUTO_SUELTO = String.fromCharCode(0xd800);

  test("una contraseña con un sustituto UTF-16 suelto da 401 con una cuenta que existe Y con una que no — nunca 500", async () => {
    const cliente = crearCliente();
    for (const correo of ["admin.entradas@lxl.test", "no.existe.nadie@lxl.test"]) {
      const { status } = await cliente.pedirJson("/auth/login", { method: "POST", body: JSON.stringify({ correo, password: SUSTITUTO_SUELTO }) });
      assert.equal(status, 401, `${correo} dio ${status}`);
    }
  });

  test("elegir una contraseña con ese texto, o de más de 72 bytes, da 400", async () => {
    const cliente = crearCliente();
    const registro = (password: string) =>
      cliente.pedirJson("/auth/registrar", { method: "POST", body: JSON.stringify({ nombre: "X", correo: "nuevo@lxl.test", password, token: "x" }) });
    assert.equal((await registro(`${SUSTITUTO_SUELTO}abcdefgh`)).status, 400);
    assert.equal((await registro("a".repeat(73))).status, 400);
    assert.equal((await registro("é".repeat(37))).status, 400); // 74 bytes en UTF-8
    // Cambiar la propia contraseña: los mismos límites.
    const cambio = (nueva: string) => enviar("POST", "/auth/cambiar-password", { actual: "ClaveSegura123!", nueva });
    assert.equal((await cambio(`${SUSTITUTO_SUELTO}abcdefgh1`)).status, 400);
    assert.equal((await cambio("a".repeat(73))).status, 400);
    // Una contraseña actual con basura tampoco es un 500.
    assert.equal((await enviar("POST", "/auth/cambiar-password", { actual: SUSTITUTO_SUELTO, nueva: "OtraClave123!!" })).status, 400);
    assert.equal((await enviar("POST", "/auth/2fa/desactivar", { password: SUSTITUTO_SUELTO })).status, 400);
  });

  test("iniciar sesión con un correo que no existe tarda como con uno que sí (no delata qué cuentas hay)", async () => {
    const cliente = crearCliente();
    const medir = async (correo: string) => {
      const a = performance.now();
      await cliente.pedirJson("/auth/login", { method: "POST", body: JSON.stringify({ correo, password: "ClaveIncorrecta-1" }) });
      return performance.now() - a;
    };
    await medir("calentamiento@lxl.test"); // la primera vez además espera el hash de relleno
    const inexistente = await medir("no.existe.otro@lxl.test");
    const existente = await medir("admin.entradas@lxl.test");
    // Antes: ~3 ms contra ~450 ms. Ahora los dos pasan por bcrypt; se
    // compara con holgura para que no dependa de la velocidad de la máquina.
    assert.ok(inexistente > existente * 0.4, `inexistente ${inexistente.toFixed(0)} ms vs existente ${existente.toFixed(0)} ms`);
    assert.ok(inexistente > 50, `con una cuenta inexistente respondió en ${inexistente.toFixed(0)} ms — no está gastando el tiempo de bcrypt`);
  });
});
