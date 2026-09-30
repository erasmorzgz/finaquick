// Requisición de compra con formato completo (artículos, firma, sello,
// envío a otra persona) y cierre de caja conciliado con Getnet: permisos
// por rol, validación de entradas hostiles y el flujo completo.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  prepararBaseDeDatos,
  borrarBaseDeDatos,
  iniciarServidor,
  detenerServidor,
  crearCliente,
  crearOrgConInvitacion,
  consultar,
  TOKEN_INVITACION_PRUEBA,
  URL_BASE,
} from "./helpers.js";

type Cliente = ReturnType<typeof crearCliente>;
interface Usuario { cliente: Cliente; id: string }

// PNG de 1×1 píxel: una imagen válida y diminuta.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const FIRMA_A = "data:image/png;base64,AAAAFIRMA1";
const SELLO_A = "data:image/png;base64,AAAASELLO01";
const SELLO_B = "data:image/png;base64,AAAASELLO02";
const CLAVE = "ClaveSegura123!";

let orgId: string;
let servicioId: string;
let servicioAjenoId: string;
let admin: Usuario;
let solicitante: Usuario; // personal, acceso completo
let soloLectura: Usuario; // personal, solo consulta
let finanzas: Usuario; // con acceso al servicio
let finanzasSinAcceso: Usuario;
let sinFirma: Usuario; // personal, sin firma ni sello guardados
let contador = 0;

async function registrar(nombre: string, rol: "admin" | "finanzas" | "personal", orgDestino = orgId): Promise<Usuario> {
  const correo = `u${++contador}.reqcierres@lxl.test`;
  await consultar(`insert into invitaciones (correo, org_id, rol, token) values ('${correo}', '${orgDestino}', '${rol}', '${TOKEN_INVITACION_PRUEBA}')`);
  const cliente = crearCliente();
  const { cuerpo } = await cliente.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre, correo, password: CLAVE, token: TOKEN_INVITACION_PRUEBA }),
  });
  return { cliente, id: cuerpo.perfil.id };
}

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();
  orgId = await crearOrgConInvitacion("Org Requisiciones y Cierres", "admin.reqcierres@lxl.test", "admin");
  const adminCliente = crearCliente();
  const { cuerpo } = await adminCliente.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre: "Admin Req", correo: "admin.reqcierres@lxl.test", password: CLAVE, token: TOKEN_INVITACION_PRUEBA }),
  });
  admin = { cliente: adminCliente, id: cuerpo.perfil.id };

  const crearServicio = async (nombre: string) =>
    (await admin.cliente.pedirJson<{ id: string }>("/servicios", { method: "POST", body: JSON.stringify({ nombre, icono: "building", orgId }) })).cuerpo.id;
  servicioId = await crearServicio("Clínica Dental Req");
  servicioAjenoId = await crearServicio("Otro servicio Req");

  solicitante = await registrar("Solicitante Req", "personal");
  soloLectura = await registrar("Lectura Req", "personal");
  finanzas = await registrar("Finanzas Req", "finanzas");
  finanzasSinAcceso = await registrar("Finanzas Sin Acceso Req", "finanzas");
  sinFirma = await registrar("Sin Firma Req", "personal");

  for (const u of [solicitante, finanzas, sinFirma]) {
    await admin.cliente.pedirJson(`/usuarios/${u.id}`, { method: "PATCH", body: JSON.stringify({ servicioIds: [servicioId] }) });
  }
  await admin.cliente.pedirJson(`/usuarios/${soloLectura.id}`, {
    method: "PATCH",
    body: JSON.stringify({ servicioIds: [servicioId], serviciosSoloConsulta: [servicioId] }),
  });
  await admin.cliente.pedirJson(`/usuarios/${finanzasSinAcceso.id}`, { method: "PATCH", body: JSON.stringify({ servicioIds: [servicioAjenoId] }) });

  // Firma y sello guardados en el perfil de quien solicita y de quien revisa.
  for (const u of [solicitante, finanzas, admin]) {
    const { status } = await u.cliente.pedirJson(`/usuarios/${u.id}`, { method: "PATCH", body: JSON.stringify({ firmaUrl: FIRMA_A, selloUrl: SELLO_A }) });
    assert.equal(status, 200);
  }
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

const enviar = (u: Usuario, metodo: string, ruta: string, cuerpo?: unknown) =>
  u.cliente.pedirJson<any>(ruta, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });

const ARTICULOS = [
  { cantidad: 2, articulo: "Juego de herramientas manuales 104 piezas", marca: "Pretul", url: "https://tienda.example/set-104", imagen: PNG },
  { cantidad: 1, articulo: "Guantes de nitrilo caja 100" },
];

describe("Requisición de compra: formato completo", () => {
  test("se crea con artículos, motivo, firma y sello, y se envía a alguien de finanzas", async () => {
    const { status, cuerpo } = await enviar(solicitante, "POST", "/requisiciones", {
      servicioId, departamento: "Odontología", motivo: "Mantenimiento preventivo de la clínica", articulos: ARTICULOS,
      destinatarioId: finanzas.id, conFirma: true, conSello: true,
    });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.match(cuerpo.folio, /^R\d{6}-\d{4}$/);
    assert.equal(cuerpo.concepto, "Juego de herramientas manuales 104 piezas y 1 más");
    assert.equal(cuerpo.cantidad, 3);
    assert.equal(cuerpo.destinatarioId, finanzas.id);
    assert.equal(cuerpo.estado, "pendiente");
    assert.ok(cuerpo.enviadaEn);
    assert.equal(cuerpo.tieneFirmaSolicitante, true);
    assert.equal(cuerpo.tieneSelloSolicitante, true);
    // La respuesta y el listado no arrastran imágenes, firmas ni sellos.
    assert.equal(cuerpo.firmaSolicitante, undefined);
    assert.equal(cuerpo.articulos[0].imagen, undefined);
    assert.equal(cuerpo.articulos[0].tieneImagen, true);
    assert.equal(cuerpo.articulos[1].tieneImagen, false);
  });

  test("el detalle trae todo lo necesario para imprimirla; el listado no", async () => {
    const lista = await enviar(solicitante, "GET", `/requisiciones?servicioId=${servicioId}`);
    const resumen = lista.cuerpo.find((r: any) => r.destinatarioId === finanzas.id);
    assert.ok(resumen);
    assert.ok(!JSON.stringify(lista.cuerpo).includes("AAAAFIRMA1"), "el listado no debe traer la firma");
    assert.equal(resumen.destinatarioNombre, "Finanzas Req");
    assert.equal(resumen.solicitanteNombre, "Solicitante Req");

    const { status, cuerpo } = await enviar(finanzas, "GET", `/requisiciones/${resumen.id}`);
    assert.equal(status, 200);
    assert.equal(cuerpo.firmaSolicitante, FIRMA_A);
    assert.equal(cuerpo.selloSolicitante, SELLO_A);
    assert.equal(cuerpo.articulos[0].imagen, PNG);
    assert.equal(cuerpo.articulos[0].marca, "Pretul");
    assert.equal(cuerpo.departamento, "Odontología");
  });

  test("el formato simple de antes (un concepto y una cantidad) se sigue aceptando", async () => {
    const { status, cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, concepto: "Papel para impresora térmica", cantidad: 5 });
    assert.equal(status, 200);
    assert.equal(cuerpo.concepto, "Papel para impresora térmica");
    assert.equal(cuerpo.cantidad, 5);
    assert.equal(cuerpo.articulos.length, 1);
    assert.equal(cuerpo.destinatarioId, undefined);
  });

  test("la firma y el sello son copias: cambiarlos después no altera una requisición ya hecha", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: [ARTICULOS[1]], conSello: true });
    await enviar(solicitante, "PATCH", `/usuarios/${solicitante.id}`, { selloUrl: SELLO_B });
    const detalle = await enviar(solicitante, "GET", `/requisiciones/${cuerpo.id}`);
    assert.equal(detalle.cuerpo.selloSolicitante, SELLO_A);
    await enviar(solicitante, "PATCH", `/usuarios/${solicitante.id}`, { selloUrl: SELLO_A });
  });

  test("no se puede firmar ni sellar sin tener firma o sello guardados", async () => {
    const base = { servicioId, articulos: [ARTICULOS[1]] };
    const conFirma = await enviar(sinFirma, "POST", "/requisiciones", { ...base, conFirma: true });
    assert.equal(conFirma.status, 400);
    assert.match(conFirma.cuerpo.error, /firma guardada/);
    const conSello = await enviar(sinFirma, "POST", "/requisiciones", { ...base, conSello: true });
    assert.equal(conSello.status, 400);
    assert.match(conSello.cuerpo.error, /sello guardado/);
    assert.equal((await enviar(sinFirma, "POST", "/requisiciones", base)).status, 200);
  });

  test("una cuenta de solo consulta no puede crear requisiciones", async () => {
    const { status } = await enviar(soloLectura, "POST", "/requisiciones", { servicioId, articulos: [ARTICULOS[1]] });
    assert.equal(status, 403);
  });
});

describe("Requisición: quién puede recibirla", () => {
  const base = () => ({ servicioId, articulos: [ARTICULOS[1]] });

  test("administrador y finanzas con acceso al servicio, sí", async () => {
    assert.equal((await enviar(solicitante, "POST", "/requisiciones", { ...base(), destinatarioId: admin.id })).status, 200);
    assert.equal((await enviar(solicitante, "POST", "/requisiciones", { ...base(), destinatarioId: finanzas.id })).status, 200);
  });

  test("finanzas sin acceso a ese servicio, personal o una persona que no existe, no", async () => {
    for (const destinatarioId of [finanzasSinAcceso.id, sinFirma.id, "00000000-0000-4000-8000-000000000000"]) {
      const { status, cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { ...base(), destinatarioId });
      assert.equal(status, 400, destinatarioId);
      assert.match(cuerpo.error, /no puede recibir/);
    }
  });

  test("no puede enviársela a sí mismo, y un destinatario mal formado da 400", async () => {
    assert.equal((await enviar(admin, "POST", "/requisiciones", { ...base(), destinatarioId: admin.id })).status, 400);
    assert.equal((await enviar(solicitante, "POST", "/requisiciones", { ...base(), destinatarioId: "no-es-uuid" })).status, 400);
    assert.equal((await enviar(solicitante, "POST", "/requisiciones", { ...base(), destinatarioId: 12 })).status, 400);
  });
});

describe("Requisición: quién puede aprobarla o rechazarla", () => {
  let id: string;

  before(async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS, destinatarioId: finanzas.id });
    id = cuerpo.id;
  });

  test("quien la solicitó no puede resolverla, ni alguien de finanzas al que no se le envió", async () => {
    assert.equal((await enviar(solicitante, "PATCH", `/requisiciones/${id}`, { estado: "aprobada" })).status, 409);
    const otra = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS, destinatarioId: admin.id });
    assert.equal((await enviar(finanzas, "PATCH", `/requisiciones/${otra.cuerpo.id}`, { estado: "aprobada" })).status, 409);
  });

  test("la persona a quien se le envió la aprueba con su firma y su sello", async () => {
    const { status, cuerpo } = await enviar(finanzas, "PATCH", `/requisiciones/${id}`, { estado: "aprobada", conFirma: true, conSello: true });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.equal(cuerpo.estado, "aprobada");
    assert.equal(cuerpo.aprobadorNombre, "Finanzas Req");
    const detalle = await enviar(solicitante, "GET", `/requisiciones/${id}`);
    assert.equal(detalle.cuerpo.firmaResolucion, FIRMA_A);
    assert.equal(detalle.cuerpo.selloResolucion, SELLO_A);
  });

  test("ya resuelta, no se puede resolver otra vez ni reenviar", async () => {
    assert.equal((await enviar(admin, "PATCH", `/requisiciones/${id}`, { estado: "rechazada", motivoRechazo: "x" })).status, 409);
    assert.equal((await enviar(solicitante, "PATCH", `/requisiciones/${id}/enviar`, { destinatarioId: admin.id })).status, 409);
  });

  test("un administrador puede resolver cualquiera; rechazar guarda el motivo", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS, destinatarioId: finanzas.id });
    const r = await enviar(admin, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "rechazada", motivoRechazo: "Ya hay existencias" });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.estado, "rechazada");
    assert.equal(r.cuerpo.motivoRechazo, "Ya hay existencias");
  });

  test("a quien se le redujo el acceso a solo consulta (o se le cambió el rol) después del envío ya no puede resolverla", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS, destinatarioId: finanzas.id });
    const cambiarAcceso = (soloConsulta: boolean) =>
      enviar(admin, "PATCH", `/usuarios/${finanzas.id}`, { serviciosSoloConsulta: soloConsulta ? [servicioId] : [] });
    assert.equal((await cambiarAcceso(true)).status, 200);
    const sinAcceso = await enviar(finanzas, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "aprobada" });
    assert.equal(sinAcceso.status, 409, "solo consulta: ya no puede aprobar");
    assert.equal((await cambiarAcceso(false)).status, 200);
    assert.equal((await enviar(admin, "POST", `/usuarios/${finanzas.id}/rol`, { rol: "personal" })).status, 200);
    const sinRol = await enviar(finanzas, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "aprobada" });
    assert.equal(sinRol.status, 409, "sin el rol de finanzas: ya no puede aprobar");
    assert.equal((await enviar(admin, "POST", `/usuarios/${finanzas.id}/rol`, { rol: "finanzas" })).status, 200);
    // Recuperado el acceso, vuelve a poder.
    assert.equal((await enviar(finanzas, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "aprobada" })).status, 200);
  });

  test("quien la pidió y quedó de solo consulta ya no puede reenviarla", async () => {
    const { cuerpo } = await enviar(sinFirma, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS });
    await enviar(admin, "PATCH", `/usuarios/${sinFirma.id}`, { serviciosSoloConsulta: [servicioId] });
    const envio = await enviar(sinFirma, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: admin.id });
    assert.equal(envio.status, 409);
    await enviar(admin, "PATCH", `/usuarios/${sinFirma.id}`, { serviciosSoloConsulta: [] });
    assert.equal((await enviar(sinFirma, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: admin.id })).status, 200);
  });

  test("firmar o sellar exige tenerlos guardados", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS, destinatarioId: admin.id });
    await enviar(admin, "PATCH", `/usuarios/${admin.id}`, { selloUrl: null });
    const sinSello = await enviar(admin, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "aprobada", conSello: true });
    assert.equal(sinSello.status, 400);
    assert.match(sinSello.cuerpo.error, /sello guardado/);
    await enviar(admin, "PATCH", `/usuarios/${admin.id}`, { selloUrl: SELLO_A });
  });

  test("banderas que no son verdadero/falso dan 400", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS });
    assert.equal((await enviar(admin, "PATCH", `/requisiciones/${cuerpo.id}`, { estado: "aprobada", conSello: "si" })).status, 400);
  });
});

describe("Requisición: enviar y reenviar", () => {
  test("quien la solicitó puede enviarla después y cambiarla de destinatario mientras está pendiente", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS });
    assert.equal(cuerpo.destinatarioId, undefined);
    const uno = await enviar(solicitante, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: finanzas.id });
    assert.equal(uno.status, 200);
    assert.equal(uno.cuerpo.destinatarioId, finanzas.id);
    const dos = await enviar(solicitante, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: admin.id });
    assert.equal(dos.cuerpo.destinatarioId, admin.id);
  });

  test("otra persona del servicio no puede reenviar una requisición ajena; un destinatario inválido da 400", async () => {
    const { cuerpo } = await enviar(solicitante, "POST", "/requisiciones", { servicioId, articulos: ARTICULOS });
    assert.equal((await enviar(sinFirma, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: admin.id })).status, 409);
    assert.equal((await enviar(solicitante, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, { destinatarioId: finanzasSinAcceso.id })).status, 400);
    assert.equal((await enviar(solicitante, "PATCH", `/requisiciones/${cuerpo.id}/enviar`, {})).status, 400);
    assert.equal((await enviar(solicitante, "PATCH", `/requisiciones/00000000-0000-4000-8000-000000000000/enviar`, { destinatarioId: admin.id })).status, 404);
  });
});

describe("Requisición: entradas hostiles", () => {
  const conArticulos = (articulos: unknown, extra: object = {}) => ({ servicioId, articulos, ...extra });
  const casos: [string, unknown][] = [
    ["sin artículos", []],
    ["más de 30 artículos", Array.from({ length: 31 }, () => ({ cantidad: 1, articulo: "x" }))],
    ["artículos que no es una lista", { cantidad: 1, articulo: "x" }],
    ["un artículo que es un texto", ["x"]],
    ["un artículo nulo", [null]],
    ["cantidad cero", [{ cantidad: 0, articulo: "x" }]],
    ["cantidad decimal", [{ cantidad: 1.5, articulo: "x" }]],
    ["cantidad en texto", [{ cantidad: "2", articulo: "x" }]],
    ["cantidad enorme", [{ cantidad: 100_001, articulo: "x" }]],
    ["artículo vacío", [{ cantidad: 1, articulo: "   " }]],
    ["artículo que no es texto", [{ cantidad: 1, articulo: 7 }]],
    ["artículo con carácter nulo", [{ cantidad: 1, articulo: "a\u0000b" }]],
    ["artículo larguísimo", [{ cantidad: 1, articulo: "a".repeat(201) }]],
    ["marca larguísima", [{ cantidad: 1, articulo: "x", marca: "m".repeat(101) }]],
    ["enlace javascript:", [{ cantidad: 1, articulo: "x", url: "javascript:alert(1)" }]],
    ["enlace sin protocolo", [{ cantidad: 1, articulo: "x", url: "tienda.example/x" }]],
    ["enlace con comillas", [{ cantidad: 1, articulo: "x", url: 'https://a.example/"onload=1' }]],
    ["imagen que no es imagen", [{ cantidad: 1, articulo: "x", imagen: "data:text/html;base64,PHNjcmlwdD4=" }]],
    ["imagen SVG", [{ cantidad: 1, articulo: "x", imagen: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }]],
    ["imagen demasiado grande", [{ cantidad: 1, articulo: "x", imagen: `data:image/png;base64,${"A".repeat(100_001)}` }]],
  ];
  for (const [nombre, articulos] of casos) {
    test(`rechaza: ${nombre}`, async () => {
      const { status, cuerpo } = await enviar(solicitante, "POST", "/requisiciones", conArticulos(articulos));
      assert.equal(status, 400, JSON.stringify(cuerpo));
      assert.equal(typeof cuerpo.error, "string");
    });
  }

  test("las imágenes en conjunto tienen un tope", async () => {
    const grande = `data:image/png;base64,${"A".repeat(90_000)}`;
    const articulos = Array.from({ length: 14 }, () => ({ cantidad: 1, articulo: "x", imagen: grande }));
    const { status, cuerpo } = await enviar(solicitante, "POST", "/requisiciones", conArticulos(articulos));
    assert.equal(status, 400);
    assert.match(cuerpo.error, /en conjunto/);
  });

  test("departamento y motivo con basura, o banderas mal formadas, dan 400 (nunca 500)", async () => {
    for (const extra of [{ departamento: 5 }, { motivo: {} }, { departamento: "a\u0000" }, { conFirma: "true" }, { conSello: 1 }, { motivo: "m".repeat(2001) }]) {
      const { status } = await enviar(solicitante, "POST", "/requisiciones", conArticulos([ARTICULOS[1]], extra));
      assert.equal(status, 400, JSON.stringify(extra));
    }
  });

  test("un servicio ajeno o inexistente no es un 500", async () => {
    const { status } = await enviar(solicitante, "POST", "/requisiciones", { servicioId: "00000000-0000-4000-8000-000000000000", articulos: [ARTICULOS[1]] });
    assert.ok(status >= 400 && status < 500, `dio ${status}`);
  });

  test("el detalle de una que no existe da 404", async () => {
    assert.equal((await enviar(solicitante, "GET", "/requisiciones/00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await enviar(solicitante, "GET", "/requisiciones/no-es-uuid")).status, 400);
  });
});

describe("Perfil, servicio y organización: sello, referencia de Getnet y encabezado", () => {
  test("el sello solo acepta imágenes; null o vacío lo quitan", async () => {
    assert.equal((await enviar(sinFirma, "PATCH", `/usuarios/${sinFirma.id}`, { selloUrl: "no-es-imagen" })).status, 400);
    assert.equal((await enviar(sinFirma, "PATCH", `/usuarios/${sinFirma.id}`, { selloUrl: 7 })).status, 400);
    assert.equal((await enviar(sinFirma, "PATCH", `/usuarios/${sinFirma.id}`, { selloUrl: SELLO_A })).status, 200);
    assert.equal((await enviar(sinFirma, "PATCH", `/usuarios/${sinFirma.id}`, { selloUrl: "" })).status, 200);
    const yo = await enviar(sinFirma, "GET", "/auth/sesion");
    assert.equal(yo.cuerpo.perfil.selloUrl, undefined);
  });

  test("la referencia de Getnet del servicio: solo caracteres seguros, y vacía la quita", async () => {
    const ok = await enviar(admin, "PATCH", `/servicios/${servicioId}`, { referenciaGetnet: "566029" });
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.referenciaGetnet, "566029");
    for (const mala of ["56 6029", "5660'29", "<b>", "x".repeat(31), 566029]) {
      assert.equal((await enviar(admin, "PATCH", `/servicios/${servicioId}`, { referenciaGetnet: mala })).status, 400, String(mala));
    }
    const quitada = await enviar(admin, "PATCH", `/servicios/${servicioId}`, { referenciaGetnet: "" });
    assert.equal(quitada.cuerpo.referenciaGetnet, undefined);
    await enviar(admin, "PATCH", `/servicios/${servicioId}`, { referenciaGetnet: "566029" });
  });

  test("solo un administrador cambia la referencia de Getnet", async () => {
    assert.equal((await enviar(solicitante, "PATCH", `/servicios/${servicioId}`, { referenciaGetnet: "111" })).status, 404);
  });

  test("el encabezado de documentos de la organización", async () => {
    const ok = await enviar(admin, "PATCH", `/organizaciones/${orgId}`, { encabezadoDocumentos: "Razón social\nAv. Universidad #46" });
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.encabezadoDocumentos, "Razón social\nAv. Universidad #46");
    assert.equal((await enviar(admin, "PATCH", `/organizaciones/${orgId}`, { encabezadoDocumentos: "x".repeat(601) })).status, 400);
    assert.equal((await enviar(admin, "PATCH", `/organizaciones/${orgId}`, { encabezadoDocumentos: 4 })).status, 400);
    assert.equal((await enviar(admin, "PATCH", `/organizaciones/${orgId}`, { encabezadoDocumentos: "" })).cuerpo.encabezadoDocumentos, undefined);
  });
});

// ---------------------------------------------------------------------
// Cierre de caja conciliado con Getnet
// ---------------------------------------------------------------------

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const HOY = hoyLocal();
let folioTicket = 0;
async function cobro(servicio: string, total: number, formaPago: string, estado = "pagado") {
  const folio = `T${String(++folioTicket).padStart(4, "0")}`;
  await consultar(
    `insert into tickets (service_id, folio, nombre, identificador, tipo_usuario, categoria, procedimientos, total, estado, forma_pago, creado_por)
     values ('${servicio}', '${folio}', 'Cliente ${folio}', '1', 'Externo', 'General', '[]', ${total}, '${estado}', '${formaPago}', '${admin.id}')`
  );
  return folio;
}
async function cobroHaceDias(servicio: string, total: number, formaPago: string, dias: number) {
  const folio = `T${String(++folioTicket).padStart(4, "0")}`;
  await consultar(
    `insert into tickets (service_id, folio, nombre, identificador, tipo_usuario, categoria, procedimientos, total, estado, forma_pago, creado_por, fecha)
     values ('${servicio}', '${folio}', 'Cliente ${folio}', '1', 'Externo', 'General', '[]', ${total}, 'pagado', '${formaPago}', '${admin.id}', now() - interval '${dias} days')`
  );
  return folio;
}
const diaHaceDias = (dias: number) => { const d = new Date(Date.now() - dias * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const enviarCorte = (u: Usuario, extra: object = {}) =>
  enviar(u, "POST", "/cierres-caja/enviar", { servicioId: servicioCierres, fecha: HOY, paraId: finanzas.id, ...extra });
const venta = (monto: number, autorizacion?: string) => ({ monto, tipo: "venta", autorizacion });
const conciliar = (u: Usuario, movimientos: unknown, extra: object = {}) =>
  enviar(u, "POST", "/cierres-caja/conciliar", { servicioId: servicioCierres, fecha: HOY, referencia: "566029", archivoNombre: "getnet.csv", archivoHash: "abc123", movimientos, ...extra });

let servicioCierres: string;

describe("Cierre de caja: conciliación con Getnet", () => {
  before(async () => {
    servicioCierres = (await admin.cliente.pedirJson<{ id: string }>("/servicios", { method: "POST", body: JSON.stringify({ nombre: "Cierres Getnet", icono: "building", orgId }) })).cuerpo.id;
    for (const u of [solicitante, soloLectura]) {
      const { status, cuerpo } = await admin.cliente.pedirJson(`/usuarios/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ servicioIds: [servicioId, servicioCierres], serviciosSoloConsulta: u === soloLectura ? [servicioId, servicioCierres] : [] }),
      });
      assert.equal(status, 200, JSON.stringify(cuerpo));
    }
    const acceso = await consultar(`select solo_consulta from service_access where user_id = '${soloLectura.id}' and service_id = '${servicioCierres}'`);
    assert.equal(acceso.trim(), "t", "la cuenta de solo consulta debe quedar de solo consulta");
    // Con referencia de Getnet, el corte solo se envía comparado y aprobado.
    assert.equal((await enviar(admin, "PATCH", `/servicios/${servicioCierres}`, { referenciaGetnet: "566029" })).status, 200);
    // El sistema tiene dos cobros con tarjeta hoy; el de efectivo y el
    // crédito pendiente NO cuentan.
    await cobro(servicioCierres, 150, "Tarjeta de débito");
    await cobro(servicioCierres, 320.5, "Tarjeta de crédito");
    await cobro(servicioCierres, 999, "Efectivo");
    await cobro(servicioCierres, 555, "Tarjeta de débito", "credito");
  });

  test("todo coincide: queda aprobado", async () => {
    const { status, cuerpo } = await conciliar(solicitante, [venta(320.5, "A2"), venta(150, "A1")]);
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.equal(cuerpo.cierre.estado, "aprobado");
    assert.equal(cuerpo.cierre.totalSistema, 470.5);
    assert.equal(cuerpo.cierre.totalGetnet, 470.5);
    assert.equal(cuerpo.cierre.diferencia, 0);
    assert.equal(cuerpo.cierre.detalle.coinciden.length, 2);
    assert.equal(cuerpo.cierre.referencia, "566029");
    assert.equal(cuerpo.vigente, true);
  });

  test("Getnet trae una venta de más: no se aprueba y se señala", async () => {
    const { cuerpo } = await conciliar(solicitante, [venta(320.5), venta(150), venta(90, "X9")]);
    assert.equal(cuerpo.cierre.estado, "no_aprobado");
    assert.equal(cuerpo.cierre.diferencia, 90);
    assert.deepEqual(cuerpo.cierre.detalle.soloGetnet.map((m: any) => m.monto), [90]);
  });

  test("falta un cobro en Getnet: se señala el folio del sistema", async () => {
    const { cuerpo } = await conciliar(solicitante, [venta(150)]);
    assert.equal(cuerpo.cierre.estado, "no_aprobado");
    assert.equal(cuerpo.cierre.diferencia, -320.5);
    assert.equal(cuerpo.cierre.detalle.soloSistema.length, 1);
    assert.match(cuerpo.cierre.detalle.soloSistema[0].folio, /^T\d{4}$/);
  });

  test("una venta y su cancelación se anulan entre sí", async () => {
    const { cuerpo } = await conciliar(solicitante, [venta(320.5), venta(150), venta(75), { monto: 75, tipo: "cancelacion" }]);
    assert.equal(cuerpo.cierre.estado, "aprobado");
    assert.equal(cuerpo.cierre.detalle.cancelaciones.length, 1);
  });

  test("volver a subir el reporte reemplaza la comparación (una fila por servicio y día)", async () => {
    await conciliar(solicitante, [venta(150)]);
    await conciliar(solicitante, [venta(320.5), venta(150)]);
    assert.equal((await consultar(`select count(*) from cierres_caja where service_id = '${servicioCierres}' and fecha = '${HOY}'`)).trim(), "1");
  });

  test("consultarlo devuelve la comparación y si sigue vigente", async () => {
    const { status, cuerpo } = await enviar(soloLectura, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${HOY}`);
    assert.equal(status, 200);
    assert.equal(cuerpo.cierre.estado, "aprobado");
    assert.equal(cuerpo.vigente, true);
    const sin = await enviar(soloLectura, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=2020-01-01`);
    assert.deepEqual(sin.cuerpo, { cierre: null, vigente: false });
  });

  test("enviar un corte aprobado: el servidor arma el documento, lo guarda para quien lo recibe y lo marca como enviado", async () => {
    const { status, cuerpo } = await enviarCorte(solicitante, { mensaje: "Corte del día" });
    assert.equal(status, 200, JSON.stringify(cuerpo));
    const { cuerpo: c } = await enviar(solicitante, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${HOY}`);
    assert.ok(c.cierre.enviadoEn);
    const contenido = await consultar(`select contenido from archivos_enviados where service_id = '${servicioCierres}' and para_id = '${finanzas.id}' order by fecha desc limit 1`);
    assert.match(contenido, /Total del día,1469\.5/); // 150 + 320.50 + 999 en efectivo
    assert.match(contenido, /Subtotal Tarjeta de débito,150/);
    assert.match(contenido, /Conciliación con Getnet,Cuadra con Getnet/);
    assert.ok(!contenido.includes("555"), "el crédito pendiente no es un cobro");
  });

  test("el documento sale de los datos del servidor: lo que mande el cliente no entra", async () => {
    const { cuerpo } = await enviarCorte(solicitante, { contenido: "Folio,Total\nFALSO,1", nombreArchivo: "otro.csv", tipo: "Otra cosa" });
    assert.equal(typeof cuerpo.id, "string");
    const falso = await consultar(`select count(*) from archivos_enviados where contenido like '%FALSO%'`);
    assert.equal(falso.trim(), "0");
  });

  test("si cambian los cobros con tarjeta después, la comparación deja de valer y no se puede enviar", async () => {
    await cobro(servicioCierres, 45, "Tarjeta de débito");
    const { cuerpo: c } = await enviar(solicitante, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${HOY}`);
    assert.equal(c.vigente, false);
    const { status, cuerpo } = await enviarCorte(solicitante);
    assert.equal(status, 409);
    assert.match(cuerpo.error, /cambiaron/);
    // Al subirlo de nuevo con el cobro nuevo, vuelve a valer (y el envío anterior se anula).
    const nuevo = await conciliar(solicitante, [venta(320.5), venta(150), venta(45)]);
    assert.equal(nuevo.cuerpo.cierre.estado, "aprobado");
    assert.equal(nuevo.cuerpo.cierre.enviadoEn, undefined);
  });

  test("un cambio que deja igual la suma y la cantidad (100+200 → 150+150) también invalida la comparación", async () => {
    // Un día aparte, con dos cobros de 100 y 200.
    const fecha = diaHaceDias(5);
    const a = await cobroHaceDias(servicioCierres, 100, "Tarjeta de débito", 5);
    await cobroHaceDias(servicioCierres, 200, "Tarjeta de débito", 5);
    const comparado = await conciliar(solicitante, [venta(100), venta(200)], { fecha });
    assert.equal(comparado.cuerpo.cierre.estado, "aprobado");
    // Corrección directa de datos: misma suma (300) y misma cantidad (2).
    await consultar(`update tickets set total = 150 where folio = '${a}'; update tickets set total = 150 where service_id = '${servicioCierres}' and total = 200 and fecha < now() - interval '4 days'`);
    const { cuerpo: c } = await enviar(solicitante, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${fecha}`);
    assert.equal(c.vigente, false, "la suma y la cantidad no cambiaron, pero los importes sí");
    const envio = await enviarCorte(solicitante, { fecha });
    assert.equal(envio.status, 409);
    const aprobar = await enviar(admin, "POST", `/cierres-caja/${c.cierre.id}/aprobar`, { observacion: "no debería poder aprobarse" });
    assert.equal(aprobar.status, 409); // ya está aprobado (o desactualizado): nunca 200
  });

  test("un corte con diferencia no se puede enviar", async () => {
    const { cuerpo } = await conciliar(solicitante, [venta(320.5), venta(150), venta(45), venta(10)]);
    assert.equal(cuerpo.cierre.estado, "no_aprobado");
    const { status, cuerpo: r } = await enviarCorte(solicitante);
    assert.equal(status, 409);
    assert.match(r.error, /no está aprobado/);
  });

  test("un corte sin comparar (con cobros con tarjeta) no se puede enviar", async () => {
    await cobroHaceDias(servicioCierres, 80, "Tarjeta de crédito", 2);
    const { status, cuerpo } = await enviarCorte(solicitante, { fecha: diaHaceDias(2) });
    assert.equal(status, 409);
    assert.match(cuerpo.error, /todavía no se compara/);
  });

  test("un día solo con efectivo se envía sin comparar; uno sin pagos da 400", async () => {
    await cobroHaceDias(servicioCierres, 120, "Efectivo", 3);
    assert.equal((await enviarCorte(solicitante, { fecha: diaHaceDias(3) })).status, 200);
    const sinPagos = await enviarCorte(solicitante, { fecha: "2020-01-01" });
    assert.equal(sinPagos.status, 400);
  });

  test("solo un administrador lo aprueba con diferencia, y con una razón", async () => {
    const { cuerpo: c } = await enviar(solicitante, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${HOY}`);
    const id = c.cierre.id;
    assert.equal((await enviar(solicitante, "POST", `/cierres-caja/${id}/aprobar`, { observacion: "Es un cobro en otro terminal" })).status, 403);
    assert.equal((await enviar(admin, "POST", `/cierres-caja/${id}/aprobar`, { observacion: "corto" })).status, 400);
    assert.equal((await enviar(admin, "POST", `/cierres-caja/${id}/aprobar`, {})).status, 400);
    const ok = await enviar(admin, "POST", `/cierres-caja/${id}/aprobar`, { observacion: "El cobro de 10 fue en otra terminal" });
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.cierre.estado, "aprobado_con_diferencia");
    assert.equal(ok.cuerpo.cierre.aprobadorNombre, "Admin Req");
    assert.equal((await enviar(admin, "POST", `/cierres-caja/${id}/aprobar`, { observacion: "otra vez aprobado" })).status, 409);
    const envio = await enviarCorte(solicitante);
    assert.equal(envio.status, 200);
    const contenido = await consultar(`select contenido from archivos_enviados where service_id = '${servicioCierres}' order by fecha desc limit 1`);
    assert.match(contenido, /Aprobado con diferencia \(diferencia 10\.00\)/);
  });

  test("una cuenta de solo consulta lo ve pero no puede conciliarlo ni enviarlo", async () => {
    const intento = await conciliar(soloLectura, [venta(1)]);
    assert.equal(intento.status, 403, JSON.stringify(intento.cuerpo).slice(0, 300));
    const envio = await enviarCorte(soloLectura);
    assert.equal(envio.status, 403);
  });

  test("no se puede eludir la puerta enviando el corte por POST /archivos", async () => {
    const base = { orgId, paraId: finanzas.id, servicioId: servicioCierres, nombreArchivo: "corte.csv", contenido: "Folio,Total\nX,1" };
    // Con el nombre del corte, en cualquier capitalización o con acentos: rechazado.
    for (const tipo of ["Cierre de caja", "cierre DE caja", "  Cierre de caja  ", "CIERRE-DE-CAJA"]) {
      const { status, cuerpo } = await enviar(solicitante, "POST", "/archivos", { ...base, tipo });
      assert.equal(status, 409, tipo);
      assert.match(cuerpo.error, /se envía desde su pantalla/);
    }
    // Un archivo cualquiera sigue pudiendo enviarse, y un servicio SIN referencia de Getnet conserva el envío de siempre.
    assert.equal((await enviar(solicitante, "POST", "/archivos", { ...base, tipo: "Otro reporte" })).status, 200);
    const sinGetnet = (await admin.cliente.pedirJson<{ id: string }>("/servicios", { method: "POST", body: JSON.stringify({ nombre: "Sin terminal", icono: "building", orgId }) })).cuerpo.id;
    await enviar(admin, "PATCH", `/usuarios/${solicitante.id}`, { servicioIds: [servicioId, servicioCierres, sinGetnet], serviciosSoloConsulta: [] });
    assert.equal((await enviar(solicitante, "POST", "/archivos", { ...base, servicioId: sinGetnet, tipo: "Cierre de caja" })).status, 200);
  });

  test("otra organización no ve ese servicio ni sus cierres", async () => {
    // personal, no admin: el rol de administrador es de toda la instalación.
    const orgAjena = await crearOrgConInvitacion("Org Ajena Cierres", "ajeno.cierres@lxl.test", "personal");
    const ajeno = crearCliente();
    await ajeno.pedirJson("/auth/registrar", { method: "POST", body: JSON.stringify({ nombre: "Ajeno", correo: "ajeno.cierres@lxl.test", password: CLAVE, token: TOKEN_INVITACION_PRUEBA }) });
    assert.ok(orgAjena);
    const u: Usuario = { cliente: ajeno, id: "x" };
    assert.equal((await conciliar(u, [venta(1)])).status, 404);
    const { cuerpo } = await enviar(u, "GET", `/cierres-caja?servicioId=${servicioCierres}&fecha=${HOY}`);
    assert.deepEqual(cuerpo, { cierre: null, vigente: false });
  });

  const malos: [string, object][] = [
    ["fecha imposible", { fecha: "2026-02-30" }],
    ["fecha en otro formato", { fecha: "30/09/2026" }],
    ["fecha que no es texto", { fecha: 20260930 }],
    ["servicio mal formado", { servicioId: "abc" }],
    ["movimientos que no son una lista", { movimientos: "muchos" }],
    ["movimiento nulo", { movimientos: [null] }],
    ["monto negativo", { movimientos: [{ monto: -5, tipo: "venta" }] }],
    ["monto cero", { movimientos: [{ monto: 0, tipo: "venta" }] }],
    ["monto en texto", { movimientos: [{ monto: "5", tipo: "venta" }] }],
    ["monto infinito", { movimientos: [{ monto: Infinity, tipo: "venta" }] }],
    ["monto enorme", { movimientos: [{ monto: 1e9, tipo: "venta" }] }],
    ["tipo desconocido", { movimientos: [{ monto: 5, tipo: "regalo" }] }],
    ["autorización con carácter nulo", { movimientos: [{ monto: 5, tipo: "venta", autorizacion: "a\u0000" }] }],
    ["autorización larguísima", { movimientos: [{ monto: 5, tipo: "venta", autorizacion: "a".repeat(31) }] }],
    ["más de 5,000 movimientos", { movimientos: Array.from({ length: 5001 }, () => ({ monto: 1, tipo: "venta" })) }],
    ["referencia con carácter nulo", { referencia: "a\u0000" }],
  ];
  for (const [nombre, extra] of malos) {
    test(`rechaza: ${nombre}`, async () => {
      const { status, cuerpo } = await conciliar(solicitante, [venta(1)], extra);
      assert.equal(status, 400, JSON.stringify(cuerpo));
    });
  }

  test("un reporte de 5,000 movimientos cabe (y no es un 500)", async () => {
    const { status } = await conciliar(solicitante, Array.from({ length: 5000 }, () => ({ monto: 1, tipo: "venta" })));
    assert.equal(status, 200);
  });

  test("un cuerpo enorme da 413, no un 500", async () => {
    const res = await fetch(`${URL_BASE}/cierres-caja/conciliar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(1_200_000) }) });
    assert.equal(res.status, 413);
  });

  test("un cierre que no existe da 404 y un id mal formado 400", async () => {
    assert.equal((await enviar(admin, "POST", "/cierres-caja/enviar", { servicioId: "00000000-0000-4000-8000-000000000000", fecha: HOY, paraId: finanzas.id })).status, 404);
    assert.equal((await enviar(admin, "POST", "/cierres-caja/00000000-0000-4000-8000-000000000000/aprobar", { observacion: "una razón suficientemente larga" })).status, 404);
    for (const cuerpo of [{}, { servicioId: servicioCierres, fecha: "2026-02-30", paraId: finanzas.id }, { servicioId: servicioCierres, fecha: HOY, paraId: "abc" }, { servicioId: servicioCierres, fecha: HOY, paraId: finanzas.id, mensaje: 7 }]) {
      assert.equal((await enviar(admin, "POST", "/cierres-caja/enviar", cuerpo)).status, 400, JSON.stringify(cuerpo));
    }
  });

  test("consultar con parámetros malos da 400", async () => {
    assert.equal((await enviar(admin, "GET", `/cierres-caja?servicioId=${servicioCierres}`)).status, 400);
    assert.equal((await enviar(admin, "GET", `/cierres-caja?fecha=${HOY}`)).status, 400);
  });
});
