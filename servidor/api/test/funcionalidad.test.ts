// Cobertura de las rutas de catálogo, finanzas, organizaciones,
// archivos y bitácora que las suites de auth/autorización/2FA no
// ejercitan — cada una se prueba por su flujo normal (crear, leer,
// actualizar, eliminar según aplique) contra un servidor y una base de
// datos reales.
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
} from "./helpers.js";

let admin: ReturnType<typeof crearCliente>;
let adminId: string;
let orgId: string;
let servicioId: string;

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();

  orgId = await crearOrgConInvitacion("Org Funcionalidad", "admin.func@lxl.test", "admin");
  admin = crearCliente();
  const { cuerpo } = await admin.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre: "Admin Func", correo: "admin.func@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
  });
  adminId = cuerpo.perfil.id;

  const { cuerpo: servicio } = await admin.pedirJson<{ id: string }>("/servicios", {
    method: "POST",
    body: JSON.stringify({ nombre: "Servicio Func", icono: "building", orgId }),
  });
  servicioId = servicio.id;
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

describe("Servicios", () => {
  test("listar servicios de la organización incluye el creado en el setup", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ id: string }[]>(`/servicios?orgId=${orgId}`);
    assert.equal(status, 200);
    assert.ok(cuerpo.some((s) => s.id === servicioId));
  });

  test("actualizar un servicio cambia el nombre y el ícono", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ nombre: string; icono: string }>(`/servicios/${servicioId}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Servicio Renombrado", icono: "heart" }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.nombre, "Servicio Renombrado");
    assert.equal(cuerpo.icono, "heart");
  });

  test("actualizar las funciones activas (features) del servicio", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ features: { creditos: boolean } }>(`/servicios/${servicioId}`, {
      method: "PATCH",
      body: JSON.stringify({ features: { creditos: false, cierreCaja: true, requiereId: true, esDerechoClinica: false } }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.features.creditos, false);
  });

  test("no se puede eliminar un servicio que ya tiene folios", async () => {
    await admin.pedirJson("/categorias", { method: "POST", body: JSON.stringify({ nombre: "General", servicioId }) });
    const { status: statusCreado } = await admin.pedirJson("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente", tipoUsuario: "Externo", categoria: "General",
        procedimientoIds: [], estado: "pagado", formaPago: "Efectivo",
      }),
    });
    assert.equal(statusCreado, 200, "el folio de prueba debe crearse para que la siguiente aserción tenga sentido");
    const { status, cuerpo } = await admin.pedirJson<{ error: string }>(`/servicios/${servicioId}`, { method: "DELETE" });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /folios/);
  });

  test("sí se puede eliminar un servicio recién creado, sin folios", async () => {
    const { cuerpo: nuevo } = await admin.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Desechable", icono: "building", orgId }),
    });
    const { status } = await admin.pedirJson(`/servicios/${nuevo.id}`, { method: "DELETE" });
    assert.equal(status, 200);
  });
});

describe("Categorías y procedimientos", () => {
  let categoriaId: string;
  let procedimientoId: string;

  test("crear y listar una categoría", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ id: string; nombre: string }>("/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: "Consulta especial", servicioId }),
    });
    assert.equal(status, 200);
    categoriaId = cuerpo.id;
    const lista = await admin.pedirJson<{ id: string }[]>(`/categorias?servicioId=${servicioId}`);
    assert.ok(lista.cuerpo.some((c) => c.id === categoriaId));
  });

  test("eliminar esa categoría", async () => {
    const { status } = await admin.pedirJson(`/categorias/${categoriaId}`, { method: "DELETE" });
    assert.equal(status, 200);
  });

  test("crear, editar y eliminar un procedimiento", async () => {
    // "p_..." como id le indica al servidor "esto es nuevo, genera un
    // id real" (mismo convenio que usa el frontend al crear) — por
    // eso la edición posterior no puede reusar ese mismo valor: hay
    // que leer primero el id real que quedó guardado.
    const creado = await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ id: "p_prueba_funcionalidad_1", servicioId, nombre: "Limpieza", precio: 200 }),
    });
    assert.equal(creado.status, 200);

    const trasCrear = await admin.pedirJson<{ id: string; nombre: string; precio: number }[]>(`/procedimientos?servicioId=${servicioId}`);
    const filaCreada = trasCrear.cuerpo.find((p) => p.nombre === "Limpieza");
    assert.ok(filaCreada, "el procedimiento recién creado debe aparecer en la lista");
    procedimientoId = filaCreada!.id;

    const editado = await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ id: procedimientoId, servicioId, nombre: "Limpieza dental", precio: 250 }),
    });
    assert.equal(editado.status, 200);

    const trasEditar = await admin.pedirJson<{ id: string; nombre: string; precio: number }[]>(`/procedimientos?servicioId=${servicioId}`);
    const filaEditada = trasEditar.cuerpo.find((p) => p.id === procedimientoId);
    assert.ok(filaEditada);
    assert.equal(filaEditada!.nombre, "Limpieza dental");
    assert.equal(filaEditada!.precio, 250);

    const eliminado = await admin.pedirJson(`/procedimientos/${procedimientoId}`, { method: "DELETE" });
    assert.equal(eliminado.status, 200);
  });
});

describe("Folios y finanzas", () => {
  // El folio y el total ya no se pueden fijar a mano (los asigna el
  // servidor, ver POST /tickets) — se guardan aquí los folios/ids
  // reales que devolvió cada creación, en vez de asumir un valor fijo
  // como "F-FIN-0".
  let ticketsFinanzas: { id: string; folio: string }[] = [];

  before(async () => {
    await admin.pedirJson("/categorias", { method: "POST", body: JSON.stringify({ nombre: "Finanzas", servicioId }) }).catch(() => {});
    // PUT /procedimientos solo regresa {ok:true} — el id real hay que
    // leerlo de vuelta del catálogo, mismo patrón que en "crear, editar
    // y eliminar un procedimiento" arriba.
    await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ id: "p_finanzas_prueba", servicioId, nombre: "Proc Finanzas Prueba", precio: 100 }),
    });
    const { cuerpo: catalogo } = await admin.pedirJson<{ id: string; nombre: string }[]>(`/procedimientos?servicioId=${servicioId}`);
    const procId = catalogo.find((p) => p.nombre === "Proc Finanzas Prueba")!.id;
    for (let i = 0; i < 3; i++) {
      const { status, cuerpo } = await admin.pedirJson<{ id: string; folio: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: `Cliente ${i}`, tipoUsuario: "Externo", categoria: "Finanzas",
          procedimientoIds: [procId], estado: i === 0 ? "credito" : "pagado", formaPago: "Efectivo",
        }),
      });
      assert.equal(status, 200, "los folios de prueba deben crearse para que el resto de este describe tenga sentido");
      ticketsFinanzas.push(cuerpo);
    }
  });

  test("listar folios del servicio incluye los recién creados", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ folio: string }[]>(`/tickets?servicioId=${servicioId}`);
    assert.equal(status, 200);
    assert.ok(cuerpo.some((t) => t.folio === ticketsFinanzas[1].folio));
  });

  test("el siguiente número de proyecto para 'Externo' es un consecutivo", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ numero: string }>(`/tickets/siguiente-numero?servicioId=${servicioId}`);
    assert.equal(status, 200);
    assert.match(cuerpo.numero, /^PRY-\d{4}$/);
  });

  test("registrar el pago de un folio en crédito lo marca como pagado y guarda cuándo se cobró", async () => {
    // Por id, no por folio — ver POST /tickets/:id/pago.
    const { status } = await admin.pedirJson(`/tickets/${ticketsFinanzas[0].id}/pago`, {
      method: "POST",
      body: JSON.stringify({ formaPago: "Tarjeta de débito" }),
    });
    assert.equal(status, 200);
    const lista = await admin.pedirJson<{ folio: string; estado: string; fecha: string; fechaPago?: string }[]>(
      `/tickets?servicioId=${servicioId}`
    );
    const fila = lista.cuerpo.find((t) => t.folio === ticketsFinanzas[0].folio);
    assert.equal(fila?.estado, "pagado");
    // fechaPago es cuándo se cobró de verdad, distinto de cuándo se
    // generó el folio (fecha) — ambas existen aquí porque el before()
    // de este describe crea los folios y el pago llega en una prueba
    // aparte, después.
    assert.ok(fila?.fechaPago, "debe quedar registrado el momento real del cobro");
  });

  test("un folio ya pagado no admite un segundo pago que le cambie la forma de pago", async () => {
    // ticketsFinanzas[0] ya quedó "pagado" en la prueba anterior.
    const { status } = await admin.pedirJson(`/tickets/${ticketsFinanzas[0].id}/pago`, {
      method: "POST",
      body: JSON.stringify({ formaPago: "Efectivo" }),
    });
    assert.equal(status, 404);
    const lista = await admin.pedirJson<{ folio: string; formaPago?: string }[]>(`/tickets?servicioId=${servicioId}`);
    const fila = lista.cuerpo.find((t) => t.folio === ticketsFinanzas[0].folio);
    assert.equal(fila?.formaPago, "Tarjeta de débito", "la forma de pago original no debió cambiar");
  });

  // H10: Credits.tsx ("saldar" una cuenta con varios folios en
  // crédito) ya no manda un POST por folio — manda uno solo, para todo
  // el grupo, que el servidor aplica en una sola transacción real.
  test("saldar un lote de folios en crédito los paga todos de una vez", async () => {
    const crear = () =>
      admin.pedirJson<{ id: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: "Cliente Lote", tipoUsuario: "Externo", categoria: "Finanzas",
          procedimientoIds: [], estado: "credito",
        }),
      });
    const [a, b, c] = await Promise.all([crear(), crear(), crear()]);
    const { status, cuerpo } = await admin.pedirJson<{ id: string; estado: string; formaPago?: string }[]>("/tickets/pago-lote", {
      method: "POST",
      body: JSON.stringify({ ticketIds: [a.cuerpo.id, b.cuerpo.id, c.cuerpo.id], formaPago: "Tarjeta de crédito" }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.length, 3);
    assert.ok(cuerpo.every((t) => t.estado === "pagado" && t.formaPago === "Tarjeta de crédito"));
  });

  test("si un folio del lote ya no está disponible, no se aplica ninguno del lote (todo o nada)", async () => {
    const crear = () =>
      admin.pedirJson<{ id: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: "Cliente Lote Parcial", tipoUsuario: "Externo", categoria: "Finanzas",
          procedimientoIds: [], estado: "credito",
        }),
      });
    const [ya_pagado, todavia_credito] = await Promise.all([crear(), crear()]);
    // ya_pagado se paga por separado ANTES del lote — simula que
    // alguien más ya lo había pagado, o una petición repetida, para
    // que el lote de abajo choque con un folio que en verdad ya no
    // está disponible.
    await admin.pedirJson(`/tickets/${ya_pagado.cuerpo.id}/pago`, {
      method: "POST",
      body: JSON.stringify({ formaPago: "Efectivo" }),
    });
    const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/tickets/pago-lote", {
      method: "POST",
      body: JSON.stringify({ ticketIds: [ya_pagado.cuerpo.id, todavia_credito.cuerpo.id], formaPago: "Tarjeta de crédito" }),
    });
    assert.equal(status, 409);
    assert.match(cuerpo.error, /disponibles/);
    // El que SÍ estaba en crédito no debió tocarse — el lote entero se
    // rechazó, no solo el folio problemático.
    const lista = await admin.pedirJson<{ id: string; estado: string; formaPago?: string }[]>(`/tickets?servicioId=${servicioId}`);
    const filaIntacta = lista.cuerpo.find((t) => t.id === todavia_credito.cuerpo.id);
    assert.equal(filaIntacta?.estado, "credito", "un folio que SÍ estaba disponible no debió quedar pagado si el lote se rechazó");
    const filaOriginal = lista.cuerpo.find((t) => t.id === ya_pagado.cuerpo.id);
    assert.equal(filaOriginal?.formaPago, "Efectivo", "la forma de pago original tampoco debió cambiar");
  });

  test("un pago con una forma que no está en el catálogo se rechaza", async () => {
    // ticketsFinanzas[1] nació "pagado" en el before() de este
    // describe, así que no sirve aquí — se necesita uno en crédito.
    const { cuerpo: nuevo } = await admin.pedirJson<{ id: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente forma inválida", tipoUsuario: "Externo", categoria: "Finanzas",
        procedimientoIds: [], estado: "credito",
      }),
    });
    // Ni en minúsculas ni un método que la interfaz no ofrece (ver
    // FORMAS_PAGO_VALIDAS en rutas.ts) — antes cualquier texto no
    // vacío se guardaba tal cual, y el cierre de caja lo perdía del
    // desglose por forma de pago aunque siguiera sumando al total
    // (hallazgo H05).
    for (const formaInvalida of ["efectivo", "transferencia", "Bitcoin"]) {
      const { status, cuerpo } = await admin.pedirJson<{ error: string }>(`/tickets/${nuevo.id}/pago`, {
        method: "POST",
        body: JSON.stringify({ formaPago: formaInvalida }),
      });
      assert.equal(status, 400, `"${formaInvalida}" no debió aceptarse`);
      assert.match(cuerpo.error, /forma de pago/);
    }
    // Y sigue en crédito — el rechazo no lo dejó a medias.
    const lista = await admin.pedirJson<{ id: string; estado: string }[]>(`/tickets?servicioId=${servicioId}`);
    assert.equal(lista.cuerpo.find((t) => t.id === nuevo.id)?.estado, "credito");
  });

  test("crear un folio ya 'pagado' con una forma fuera del catálogo se rechaza", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente forma inválida al crear", tipoUsuario: "Externo", categoria: "Finanzas",
        procedimientoIds: [], estado: "pagado", formaPago: "efectivo",
      }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /forma de pago/);
  });

  // H09: antes, cada petición válida a POST /tickets creaba un folio
  // nuevo, sin importar que fuera en realidad el mismo intento
  // reenviado — la unicidad del folio nunca evitó duplicar el cobro
  // real. Estas pruebas simulan exactamente ese reintento (la misma
  // clave, la misma petición) tal como lo haría el navegador si perdió
  // la respuesta original.
  test("reenviar la misma clave de idempotencia con el mismo contenido regresa el mismo folio, no uno nuevo", async () => {
    const clave = `idem-${Math.random()}`;
    const cuerpoPeticion = {
      servicioId, nombre: "Cliente Idempotente", tipoUsuario: "Externo", categoria: "Finanzas",
      procedimientoIds: [], estado: "pagado", formaPago: "Efectivo", idempotencyKey: clave,
    };
    const primera = await admin.pedirJson<{ id: string; folio: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify(cuerpoPeticion),
    });
    assert.equal(primera.status, 200);
    const segunda = await admin.pedirJson<{ id: string; folio: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify(cuerpoPeticion),
    });
    assert.equal(segunda.status, 200);
    assert.equal(segunda.cuerpo.id, primera.cuerpo.id, "debe ser el MISMO folio, no uno nuevo");
    assert.equal(segunda.cuerpo.folio, primera.cuerpo.folio);
    const contados = await consultar(`select count(*) from tickets where clave_idempotencia = '${clave}';`);
    assert.equal(contados.trim(), "1", "solo debe existir una fila con esta clave, sin importar cuántas veces se reenvíe");
  });

  test("reutilizar la misma clave de idempotencia con datos distintos se rechaza", async () => {
    const clave = `idem-${Math.random()}`;
    const primera = await admin.pedirJson<{ id: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente A", tipoUsuario: "Externo", categoria: "Finanzas",
        procedimientoIds: [], estado: "pagado", formaPago: "Efectivo", idempotencyKey: clave,
      }),
    });
    assert.equal(primera.status, 200);
    // Mismo servicio, misma clave, pero un nombre distinto — no es un
    // reintento del mismo folio, es la clave reusada para otra cosa.
    const segunda = await admin.pedirJson<{ error: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente B (no debería crearse)", tipoUsuario: "Externo", categoria: "Finanzas",
        procedimientoIds: [], estado: "pagado", formaPago: "Efectivo", idempotencyKey: clave,
      }),
    });
    assert.equal(segunda.status, 409);
    const contados = await consultar(`select count(*) from tickets where clave_idempotencia = '${clave}';`);
    assert.equal(contados.trim(), "1", "el segundo intento no debió crear ningún folio");
  });

  // Auditoría "Finaquick 3": la comparación de un reintento no debe
  // depender de "estado"/"forma_pago" EN VIVO del folio — esas columnas
  // cambian por un pago normal, sin relación con si la petición de
  // CREACIÓN se reintentó. Antes de esta corrección, pagar el folio
  // entre la creación original y el reintento hacía que el reintento
  // (con el mismo contenido original) se rechazara como "clave reusada
  // con datos distintos", solo porque el folio ya no seguía en crédito.
  test("pagar un folio no rompe que su petición de creación original se pueda reintentar después", async () => {
    const clave = `idem-pago-${Math.random()}`;
    const cuerpoOriginal = {
      servicioId, nombre: "Cliente Reintento Tras Pago", tipoUsuario: "Externo", categoria: "Finanzas",
      procedimientoIds: [], estado: "credito", idempotencyKey: clave,
    };
    const primera = await admin.pedirJson<{ id: string }>("/tickets", { method: "POST", body: JSON.stringify(cuerpoOriginal) });
    assert.equal(primera.status, 200);

    const pago = await admin.pedirJson(`/tickets/${primera.cuerpo.id}/pago`, {
      method: "POST",
      body: JSON.stringify({ formaPago: "Efectivo" }),
    });
    assert.equal(pago.status, 200, "el folio debe poder pagarse normalmente entre medio");

    // Mismo cuerpo EXACTO que la petición original (sigue diciendo
    // "credito", porque eso es lo que de verdad se pidió crear la
    // primera vez) — debe reconocerse como el mismo reintento, no como
    // la clave reusada para otra cosa.
    const reintento = await admin.pedirJson<{ id: string }>("/tickets", { method: "POST", body: JSON.stringify(cuerpoOriginal) });
    assert.equal(reintento.status, 200, "el reintento del mismo contenido original no debe rechazarse solo porque el folio ya se pagó");
    assert.equal(reintento.cuerpo.id, primera.cuerpo.id);

    const contados = await consultar(`select count(*) from tickets where clave_idempotencia = '${clave}';`);
    assert.equal(contados.trim(), "1", "el reintento no debió crear un folio aparte");
  });

  // P8 de la auditoría "Finaquick 3": cuando dos peticiones con la
  // MISMA clave pero contenido DISTINTO chocan de verdad contra el
  // índice único (no solo en secuencia), la que pierde la inserción no
  // debe recibir como "éxito" el folio de la que ganó — eso reportaría
  // 200 sobre una operación que en realidad nunca se aplicó tal como
  // se pidió.
  test("dos peticiones concurrentes con la misma clave pero contenido distinto: la que pierde la carrera no recibe el folio de la otra", async () => {
    const clave = `idem-carrera-${Math.random()}`;
    const [a, b] = await Promise.all([
      admin.pedirJson<{ id: string; nombre: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: "Carrera A", tipoUsuario: "Externo", categoria: "Finanzas",
          procedimientoIds: [], estado: "pagado", formaPago: "Efectivo", idempotencyKey: clave,
        }),
      }),
      admin.pedirJson<{ id: string; nombre: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: "Carrera B", tipoUsuario: "Externo", categoria: "Finanzas",
          procedimientoIds: [], estado: "pagado", formaPago: "Tarjeta de débito", idempotencyKey: clave,
        }),
      }),
    ]);
    // Sin importar cuál "ganó": una de las dos debe haber tenido éxito
    // con SU propio nombre, y la otra debe haber sido rechazada — nunca
    // las dos con 200, y nunca una con 200 pero el nombre de la otra.
    const resultados = [a, b];
    const exitosas = resultados.filter((r) => r.status === 200);
    const rechazadas = resultados.filter((r) => r.status === 409);
    assert.equal(exitosas.length, 1, "exactamente una de las dos debió tener éxito");
    assert.equal(rechazadas.length, 1, "la otra debió rechazarse con 409, no recibir el folio de la que ganó");
    const ganadora = exitosas[0].cuerpo.nombre;
    assert.ok(ganadora === "Carrera A" || ganadora === "Carrera B");
    const contados = await consultar(`select count(*) from tickets where clave_idempotencia = '${clave}';`);
    assert.equal(contados.trim(), "1", "solo debe existir un folio con esta clave, sin importar cuál petición ganó");
  });

  test("ingresos mensuales refleja el total pagado", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ total: number }[]>(`/finanzas/ingresos-mensuales?orgId=${orgId}&servicioId=${servicioId}`);
    assert.equal(status, 200);
    const total = cuerpo.reduce((s, p) => s + p.total, 0);
    assert.ok(total >= 300, `se esperaban al menos 300 en ingresos pagados, hubo ${total}`);
  });

  // H04 (según la auditoría comparativa "Finaquick 3"): guardar
  // fecha_pago no sirve de nada si los reportes lo siguen ignorando —
  // un crédito de un mes cobrado el mes siguiente no debe sumarle al
  // mes en que solo se EMITIÓ, sino a aquel en que de verdad se cobró.
  test("un crédito emitido un mes y cobrado el mes siguiente suma al mes del cobro, no al de la emisión", async () => {
    const { cuerpo: catalogo } = await admin.pedirJson<{ id: string; nombre: string }[]>(`/procedimientos?servicioId=${servicioId}`);
    const procId = catalogo.find((p) => p.nombre === "Proc Finanzas Prueba")!.id;

    const antes = await admin.pedirJson<{ mes: string; total: number }[]>(`/finanzas/ingresos-mensuales?orgId=${orgId}&servicioId=${servicioId}`);
    const totalAntesPorMes = new Map(antes.cuerpo.map((p) => [p.mes, p.total]));

    const { cuerpo: credito } = await admin.pedirJson<{ id: string; folio: string; total: number }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "Cliente Mes Cruzado", tipoUsuario: "Externo", categoria: "Finanzas",
        procedimientoIds: [procId], estado: "credito",
      }),
    });
    assert.ok(credito.total > 0, "el folio de prueba debe tener un monto real, o esta prueba no prueba nada");
    // Se emitió "hace dos meses" (se manipula directo en la base, como
    // haría un folio real con antigüedad — la API nunca deja mandar
    // una fecha propia al crear un folio).
    await consultar(`update tickets set fecha = now() - interval '2 months' where id = '${credito.id}';`);
    // El cobro llega HOY — POST /tickets/:id/pago siempre usa now()
    // para fecha_pago, así que esto sí pasa por la ruta real.
    const pago = await admin.pedirJson(`/tickets/${credito.id}/pago`, {
      method: "POST",
      body: JSON.stringify({ formaPago: "Efectivo" }),
    });
    assert.equal(pago.status, 200);

    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const emision = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
    const mesEmision = `${emision.getFullYear()}-${String(emision.getMonth() + 1).padStart(2, "0")}`;

    const despues = await admin.pedirJson<{ mes: string; total: number }[]>(
      `/finanzas/ingresos-mensuales?orgId=${orgId}&servicioId=${servicioId}`
    );
    const totalDespuesPorMes = new Map(despues.cuerpo.map((p) => [p.mes, p.total]));

    const incrementoMesActual = (totalDespuesPorMes.get(mesActual) ?? 0) - (totalAntesPorMes.get(mesActual) ?? 0);
    const incrementoMesEmision = (totalDespuesPorMes.get(mesEmision) ?? 0) - (totalAntesPorMes.get(mesEmision) ?? 0);
    assert.equal(incrementoMesActual, credito.total, "el mes del COBRO debe subir exactamente por el monto de este folio");
    assert.equal(incrementoMesEmision, 0, "el mes en que solo se EMITIÓ el folio no debió cambiar nada");
  });

  test("ingresos por servicio incluye este servicio", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ servicioId: string }[]>(`/finanzas/ingresos-por-servicio?orgId=${orgId}`);
    assert.equal(status, 200);
    assert.ok(cuerpo.some((s) => s.servicioId === servicioId));
  });

  test("comparativo mensual por servicio responde sin error", async () => {
    const { status } = await admin.pedirJson(`/finanzas/comparativo?orgId=${orgId}`);
    assert.equal(status, 200);
  });

  test("pendiente en créditos ya no cuenta el folio que se acaba de pagar", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ total: number }>(`/finanzas/pendiente-creditos?orgId=${orgId}&servicioId=${servicioId}`);
    assert.equal(status, 200);
    assert.equal(cuerpo.total, 0);
  });

  test("buscar folio global encuentra por coincidencia parcial", async () => {
    // El folio ya no se puede fijar a mano, así que se busca por el
    // prefijo real que el servidor le puso (F<yymmdd>-), compartido
    // por los tres folios de este describe (y por cualquier otro
    // creado el mismo día en la misma organización).
    const prefijo = ticketsFinanzas[0].folio.split("-")[0];
    const { status, cuerpo } = await admin.pedirJson<{ folio: string }[]>(`/buscar-folio?orgId=${orgId}&q=${prefijo}`);
    assert.equal(status, 200);
    assert.ok(cuerpo.length >= 3);
  });
});

describe("Organizaciones", () => {
  test("listar organizaciones incluye la propia", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ id: string }[]>("/organizaciones");
    assert.equal(status, 200);
    assert.ok(cuerpo.some((o) => o.id === orgId));
  });

  test("actualizar nombre y color de la organización", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ nombre: string; colorPrimario: string }>(`/organizaciones/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Org Funcionalidad Renombrada", colorPrimario: "#2a5fd6" }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.nombre, "Org Funcionalidad Renombrada");
    assert.equal(cuerpo.colorPrimario, "#2a5fd6");
  });

  test("rechaza un color que no sea hexadecimal válido", async () => {
    const { status } = await admin.pedirJson(`/organizaciones/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ colorPrimario: "no-es-un-color" }),
    });
    assert.equal(status, 400);
  });

  test("crear una organización nueva y luego eliminarla", async () => {
    const creada = await admin.pedirJson<{ id: string }>("/organizaciones", {
      method: "POST",
      body: JSON.stringify({ nombre: "Org Desechable" }),
    });
    assert.equal(creada.status, 200);
    const eliminada = await admin.pedirJson(`/organizaciones/${creada.cuerpo.id}`, { method: "DELETE" });
    assert.equal(eliminada.status, 200);
  });

  // El límite de tamaño del cuerpo de esta ruta (2.5mb, ver index.ts)
  // tiene que caber la imagen más grande que rutas.ts todavía acepta
  // (~1.9MB de datos, LARGO_MAX_IMAGEN_DATAURL) más el resto del JSON
  // — sin esta prueba, un límite mal ajustado rompería el logotipo
  // silenciosamente hasta que alguien lo notara en producción.
  test("actualizar el logotipo con una imagen cerca del tamaño máximo permitido", async () => {
    const logoUrl = "data:image/png;base64," + "A".repeat(1_900_000);
    const { status, cuerpo } = await admin.pedirJson<{ logoUrl?: string }>(`/organizaciones/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ logoUrl }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.logoUrl, logoUrl);
  });
});

describe("Perfil", () => {
  // Mismo caso que el logotipo de organización, para la otra ruta que
  // acepta una imagen grande dentro de un cuerpo JSON normal.
  test("actualizar la foto de perfil con una imagen cerca del tamaño máximo permitido", async () => {
    const fotoUrl = "data:image/jpeg;base64," + "B".repeat(1_900_000);
    const { status, cuerpo } = await admin.pedirJson<{ fotoUrl?: string }>(`/usuarios/${adminId}`, {
      method: "PATCH",
      body: JSON.stringify({ fotoUrl }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.fotoUrl, fotoUrl);
  });
});

describe("Archivos entre compañeros", () => {
  let compañeroId: string;

  before(async () => {
    // Invitación directa a la MISMA organización que "orgId" (no una
    // nueva, como haría crearOrgConInvitacion) — el compañero necesita
    // compartir organización con el admin para esta prueba.
    await consultar(
      `insert into invitaciones (correo, org_id, rol, token) values ('companero.func@lxl.test', '${orgId}', 'personal', '${TOKEN_INVITACION_PRUEBA}')`
    );
    const compañero = crearCliente();
    const { cuerpo } = await compañero.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Compañero Func", correo: "companero.func@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    compañeroId = cuerpo.perfil.id;
  });

  test("rechaza un orgId o paraId que no tengan forma de UUID", async () => {
    const { status } = await admin.pedirJson("/archivos", {
      method: "POST",
      body: JSON.stringify({
        orgId: "no-es-un-uuid", paraId: compañeroId, tipo: "Cierre de caja", nombreArchivo: "cierre.csv", contenido: "x",
      }),
    });
    assert.equal(status, 400);
  });

  test("rechaza un servicioId que pertenece a otra organización", async () => {
    const otraOrgId = await crearOrgConInvitacion("Org Ajena Servicio Archivo", "ajeno.servicio.archivo@lxl.test", "admin");
    // Se crea un servicio real en la otra organización directamente en
    // la base, para tener un id válido que de verdad pertenezca a otra
    // organización (no basta con un UUID inventado — eso ya lo cubre la
    // prueba de arriba).
    const filaServicio = await consultar(
      `insert into services (org_id, nombre) values ('${otraOrgId}', 'Servicio Ajeno') returning id`
    );
    const servicioAjenoId = filaServicio.trim();

    const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/archivos", {
      method: "POST",
      body: JSON.stringify({
        orgId, paraId: compañeroId, servicioId: servicioAjenoId, tipo: "Cierre de caja",
        nombreArchivo: "cierre.csv", contenido: "x",
      }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /servicio/);
  });

  test("enviar un archivo a un compañero de la misma organización", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ id: string }>("/archivos", {
      method: "POST",
      body: JSON.stringify({
        orgId, paraId: compañeroId, tipo: "Cierre de caja", nombreArchivo: "cierre.csv", contenido: "folio,total\nF-1,100",
      }),
    });
    assert.equal(status, 200);
    assert.ok(cuerpo.id);
  });

  test("el compañero lo ve en sus archivos recibidos, y puede marcarlo como leído", async () => {
    const compañero = crearCliente();
    await compañero.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "companero.func@lxl.test", password: "ClaveSegura123!" }),
    });
    const { status, cuerpo } = await compañero.pedirJson<{ id: string; leido: boolean; contenido?: string }[]>("/archivos/recibidos");
    assert.equal(status, 200);
    assert.ok(cuerpo.length > 0);
    // El listado NO trae el contenido del archivo — se pide aparte, solo
    // al momento de descargar (ver GET /archivos/:id/contenido). El
    // navegador vuelve a pedir este listado cada pocos segundos para
    // revisar notificaciones nuevas, así que traer el archivo completo
    // cada vez sería mucho tráfico sin necesidad.
    assert.equal(cuerpo[0].contenido, undefined, "el listado de recibidos no debe incluir el contenido completo");

    const marcado = await compañero.pedirJson(`/archivos/${cuerpo[0].id}/leido`, { method: "POST" });
    assert.equal(marcado.status, 200);
  });

  test("el contenido de un archivo se pide aparte, y solo quien lo envió o lo recibió puede leerlo", async () => {
    const compañero = crearCliente();
    await compañero.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "companero.func@lxl.test", password: "ClaveSegura123!" }),
    });
    const { cuerpo: lista } = await compañero.pedirJson<{ id: string }[]>("/archivos/recibidos");
    const archivoId = lista[0].id;

    const { status, cuerpo } = await compañero.pedirJson<{ contenido: string }>(`/archivos/${archivoId}/contenido`);
    assert.equal(status, 200);
    assert.equal(cuerpo.contenido, "folio,total\nF-1,100");

    // Alguien de otra organización, sin relación con este archivo.
    const ajeno = crearCliente();
    await crearOrgConInvitacion("Org Ajena Contenido Archivo", "ajeno.contenido@lxl.test", "admin");
    await ajeno.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Ajeno Contenido", correo: "ajeno.contenido@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const intento = await ajeno.pedirJson(`/archivos/${archivoId}/contenido`);
    assert.equal(intento.status, 404);
  });
});

describe("Bitácora de auditoría", () => {
  test("registrar y luego listar un evento", async () => {
    const registrado = await admin.pedirJson("/eventos", {
      method: "POST",
      body: JSON.stringify({ orgId, accion: "Prueba de funcionalidad", detalle: "detalle de la prueba" }),
    });
    assert.equal(registrado.status, 200);
    const { status, cuerpo } = await admin.pedirJson<{ accion: string }[]>(`/eventos?orgId=${orgId}`);
    assert.equal(status, 200);
    assert.ok(cuerpo.some((e) => e.accion === "Prueba de funcionalidad"));
  });

  // H11: antes /eventos traía la bitácora completa de una sola vez —
  // ahora acepta "limit" y un cursor "antesDe" para pedir tandas más
  // viejas sin traer todo junto, y sin duplicar ni saltarse ninguno al
  // pasar de una tanda a la siguiente.
  test("limit y antesDe paginan la bitácora sin duplicar ni saltarse eventos", async () => {
    const orgPaginacion = await crearOrgConInvitacion("Org Paginación Eventos", "paginacion.eventos@lxl.test", "admin");
    const dueño = crearCliente();
    await dueño.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Dueño Paginación", correo: "paginacion.eventos@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    // 5 eventos, uno por uno (no en paralelo, para que su orden de
    // "fecha" sea predecible) — el nombre de la acción lleva un
    // consecutivo para poder verificar el orden exacto después.
    for (let i = 0; i < 5; i++) {
      await dueño.pedirJson("/eventos", {
        method: "POST",
        body: JSON.stringify({ orgId: orgPaginacion, accion: `Evento de prueba ${i}`, detalle: `#${i}` }),
      });
    }
    const primeraTanda = await dueño.pedirJson<{ detalle: string; fecha: string }[]>(`/eventos?orgId=${orgPaginacion}&limit=2`);
    assert.equal(primeraTanda.cuerpo.length, 2);
    assert.deepEqual(primeraTanda.cuerpo.map((e) => e.detalle), ["#4", "#3"], "debe venir del más nuevo al más viejo");

    const cursor1 = primeraTanda.cuerpo[primeraTanda.cuerpo.length - 1].fecha;
    const segundaTanda = await dueño.pedirJson<{ detalle: string; fecha: string }[]>(`/eventos?orgId=${orgPaginacion}&limit=2&antesDe=${encodeURIComponent(cursor1)}`);
    assert.deepEqual(segundaTanda.cuerpo.map((e) => e.detalle), ["#2", "#1"], "la segunda tanda debe continuar justo donde terminó la primera, sin repetir '#3'");

    const cursor2 = segundaTanda.cuerpo[segundaTanda.cuerpo.length - 1].fecha;
    const terceraTanda = await dueño.pedirJson<{ detalle: string }[]>(`/eventos?orgId=${orgPaginacion}&limit=2&antesDe=${encodeURIComponent(cursor2)}`);
    assert.deepEqual(terceraTanda.cuerpo.map((e) => e.detalle), ["#0"], "la última tanda solo debe traer lo que sobra, sin duplicar nada de las anteriores");
  });

  // Auditoría "Finaquick 4" (P5): la reserva de las dos acciones que ya
  // genera el servidor comparaba el texto crudo — un espacio de más (u
  // otra mayúscula) alcanzaba para esquivarla sin que se notara a
  // simple vista en la bitácora.
  test("el texto reservado de un evento autoritativo se rechaza incluso con variaciones triviales", async () => {
    for (const variante of [
      "Cambió el rol de un usuario",
      "Cambió el rol de un usuario ", // espacio al final
      " Cambió el rol de un usuario", // espacio al inicio
      "Cambió el rol  de un usuario", // dos espacios internos en vez de uno
      "CAMBIÓ EL ROL DE UN USUARIO", // mayúsculas
      "cambió el rol de un usuario", // minúsculas
    ]) {
      const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/eventos", {
        method: "POST",
        body: JSON.stringify({ orgId, accion: variante, detalle: "fabricado" }),
      });
      assert.equal(status, 400, `"${variante}" no debió aceptarse`);
      assert.match(cuerpo.error, /reservad/);
    }
  });

  // H07: antes, cambiar un rol o restablecer una contraseña no dejaba
  // NINGÚN rastro por sí solo — el evento en la bitácora dependía por
  // completo de que el navegador mandara, aparte, un segundo POST a
  // /eventos después. Estas dos pruebas llaman SOLO a la ruta de la
  // acción (nunca a /eventos) y comprueban que el evento de todas
  // formas queda — porque ahora lo inserta la misma función SQL, en la
  // misma transacción que el cambio real.
  test("cambiar el rol de alguien deja un evento aunque no se llame a /eventos por separado", async () => {
    const org3 = await crearOrgConInvitacion("Org Bitácora Rol", "bitacora.rol@lxl.test", "personal");
    const cuenta = crearCliente();
    const { cuerpo } = await cuenta.pedirJson<{ perfil: { id: string; nombre: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Bitácora Rol", correo: "bitacora.rol@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const idAfectado = cuerpo.perfil.id;

    // admin (de "Org Funcionalidad") no es miembro de org3, pero SÍ es
    // administrador institucional — cambiar_rol() lo permite igual
    // (el rol es de toda la institución, no por organización).
    const { status } = await admin.pedirJson(`/usuarios/${idAfectado}/rol`, {
      method: "POST",
      body: JSON.stringify({ rol: "finanzas" }),
    });
    assert.equal(status, 200);

    const fila = await consultar(
      `select accion, detalle from eventos_auditoria where org_id = '${org3}' and accion = 'Cambió el rol de un usuario';`
    );
    assert.match(fila, /personal → finanzas/, "debe quedar registrado el rol anterior y el nuevo, sin haber llamado a /eventos");
  });

  test("restablecer una contraseña deja un evento aunque no se llame a /eventos por separado", async () => {
    const org4 = await crearOrgConInvitacion("Org Bitácora Reset", "bitacora.reset@lxl.test", "personal");
    const cuenta = crearCliente();
    await cuenta.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Bitácora Reset", correo: "bitacora.reset@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const fila0 = await consultar(`select id from profiles where correo = 'bitacora.reset@lxl.test';`);
    const idAfectado = fila0.trim();

    const { status } = await admin.pedirJson(`/usuarios/${idAfectado}/restablecer-password`, { method: "POST" });
    assert.equal(status, 200);

    const fila = await consultar(
      `select detalle from eventos_auditoria where org_id = '${org4}' and accion = 'Restableció la contraseña de alguien';`
    );
    assert.match(fila, /Bitácora Reset/);
  });
});

// H07 (completo): las siete acciones administrativas que todavía
// dependían de que el navegador mandara, aparte, un segundo POST a
// /eventos ahora dejan su propio evento dentro de la MISMA transacción
// que la acción real — cada prueba de aquí llama solo a la ruta de la
// acción (nunca a /eventos) y comprueba que el evento de todas formas
// queda.
describe("Bitácora de auditoría — el resto de acciones administrativas (H07 completo)", () => {
  let orgBitacora: string;
  let adminBitacora: ReturnType<typeof crearCliente>;
  let miembroId: string;
  let servicioBitacoraId: string;

  before(async () => {
    orgBitacora = await crearOrgConInvitacion("Org Bitácora Completa", "bitacora.admin@lxl.test", "admin");
    adminBitacora = crearCliente();
    await adminBitacora.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Admin Bitácora", correo: "bitacora.admin@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    await consultar(`insert into invitaciones (correo, org_id, rol, token) values ('bitacora.miembro@lxl.test', '${orgBitacora}', 'personal', '${TOKEN_INVITACION_PRUEBA}')`);
    const miembro = crearCliente();
    const { cuerpo } = await miembro.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Miembro Bitácora", correo: "bitacora.miembro@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    miembroId = cuerpo.perfil.id;
    const { cuerpo: servicio } = await adminBitacora.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Servicio Bitácora", icono: "building", orgId: orgBitacora }),
    });
    servicioBitacoraId = servicio.id;
  });

  test("cambiar la marca deja un evento, solo si nombre o color de verdad cambian", async () => {
    const sinCambio = await adminBitacora.pedirJson(`/organizaciones/${orgBitacora}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Org Bitácora Completa" }), // mismo nombre que ya tiene
    });
    assert.equal(sinCambio.status, 200);
    const antesDelCambio = await consultar(`select count(*) from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Cambió la marca';`);
    assert.equal(antesDelCambio.trim(), "0", "sin un cambio real, no debe quedar ningún evento");

    const conCambio = await adminBitacora.pedirJson(`/organizaciones/${orgBitacora}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Org Bitácora Completa Renombrada" }),
    });
    assert.equal(conCambio.status, 200);
    const fila = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Cambió la marca';`);
    assert.match(fila, /Org Bitácora Completa Renombrada/);
  });

  test("crear y eliminar un servicio dejan su propio evento", async () => {
    const { cuerpo: nuevo } = await adminBitacora.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Servicio Desechable Bitácora", icono: "building", orgId: orgBitacora }),
    });
    const filaCreado = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Creó el servicio' and detalle = 'Servicio Desechable Bitácora';`);
    assert.match(filaCreado, /Servicio Desechable Bitácora/);

    const { status } = await adminBitacora.pedirJson(`/servicios/${nuevo.id}`, { method: "DELETE" });
    assert.equal(status, 200);
    const filaEliminado = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Eliminó el servicio' and detalle = 'Servicio Desechable Bitácora';`);
    assert.match(filaEliminado, /Servicio Desechable Bitácora/);
  });

  test("invitar a alguien nuevo deja su propio evento", async () => {
    const { status } = await adminBitacora.pedirJson("/invitaciones", {
      method: "POST",
      body: JSON.stringify({ correo: "invitado.bitacora@lxl.test", orgId: orgBitacora, rol: "personal", servicioIds: [] }),
    });
    assert.equal(status, 200);
    const fila = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Invitó a alguien nuevo';`);
    assert.match(fila, /invitado\.bitacora@lxl\.test/);
  });

  test("asignar y quitar un servicio a alguien dejan su propio evento, con el nombre del servicio", async () => {
    const asignar = await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ servicioIds: [servicioBitacoraId] }),
    });
    assert.equal(asignar.status, 200);
    const filaAsignado = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Le asignó un servicio a alguien';`);
    assert.match(filaAsignado, /Miembro Bitácora/);
    assert.match(filaAsignado, /Servicio Bitácora/);

    const quitar = await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ servicioIds: [] }),
    });
    assert.equal(quitar.status, 200);
    const filaQuitado = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Le quitó un servicio a alguien';`);
    assert.match(filaQuitado, /Miembro Bitácora/);
    assert.match(filaQuitado, /Servicio Bitácora/);
  });

  test("cambiar el nivel de acceso (solo consulta) deja su propio evento, solo si de verdad cambia", async () => {
    await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ servicioIds: [servicioBitacoraId] }),
    });
    const activar = await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ serviciosSoloConsulta: [servicioBitacoraId] }),
    });
    assert.equal(activar.status, 200);
    const filaActivado = await consultar(
      `select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Cambió el nivel de acceso de alguien' and detalle like '%solo consulta%';`
    );
    assert.match(filaActivado, /Miembro Bitácora/);

    // Repetir el MISMO valor no debe generar un segundo evento — nada
    // cambió de verdad.
    const antes = await consultar(`select count(*) from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Cambió el nivel de acceso de alguien';`);
    await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ serviciosSoloConsulta: [servicioBitacoraId] }),
    });
    const despues = await consultar(`select count(*) from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Cambió el nivel de acceso de alguien';`);
    assert.equal(despues.trim(), antes.trim(), "repetir el mismo valor no debe generar un evento nuevo");
  });

  test("agregar y quitar a alguien de la organización dejan su propio evento (y en cascada, el de sus servicios)", async () => {
    // El miembro ya está en orgBitacora desde el registro — se le quita
    // primero para poder probar "agregar" de forma real.
    await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgIds: [], servicioIds: [] }),
    });

    const agregar = await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgIds: [orgBitacora] }),
    });
    assert.equal(agregar.status, 200);
    const filaAgregado = await consultar(`select detalle from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Agregó a alguien a la organización';`);
    assert.match(filaAgregado, /Miembro Bitácora/);

    // Se le asigna un servicio de esa organización, y LUEGO se le quita
    // la organización completa — debe quedar el evento de la
    // organización, Y el de "le quitó un servicio" en cascada, sin que
    // el navegador haya llamado nunca a /eventos.
    await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ servicioIds: [servicioBitacoraId] }),
    });
    const quitar = await adminBitacora.pedirJson(`/usuarios/${miembroId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgIds: [], servicioIds: [] }),
    });
    assert.equal(quitar.status, 200);
    const filaQuitadoOrg = await consultar(`select count(*) from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Quitó a alguien de la organización';`);
    assert.ok(Number(filaQuitadoOrg.trim()) >= 1, "debe quedar al menos un evento de haberlo quitado de la organización");
    const filaCascada = await consultar(
      `select count(*) from eventos_auditoria where org_id = '${orgBitacora}' and accion = 'Le quitó un servicio a alguien' and detalle like '%Servicio Bitácora%';`
    );
    assert.ok(Number(filaCascada.trim()) >= 1, "quitar la organización debe dejar también el rastro de que se le quitó el servicio en cascada");
  });
});
