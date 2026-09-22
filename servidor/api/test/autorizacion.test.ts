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
  consultarEnParalelo,
  TOKEN_INVITACION_PRUEBA,
} from "./helpers.js";

let admin: ReturnType<typeof crearCliente>;
let adminId: string;
let orgId: string;
let servicioId: string;

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();

  orgId = await crearOrgConInvitacion("Org Autorizacion", "admin.autz@lxl.test", "admin");
  admin = crearCliente();
  const { cuerpo } = await admin.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre: "Admin Autz", correo: "admin.autz@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
  });
  adminId = cuerpo.perfil.id;

  const { cuerpo: servicio } = await admin.pedirJson<{ id: string }>("/servicios", {
    method: "POST",
    body: JSON.stringify({ nombre: "Servicio Autz", icono: "FileText", orgId }),
  });
  servicioId = servicio.id;
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

describe("Suplantación de identidad — el actor siempre sale de la sesión", () => {
  test("POST /eventos ignora un actorId/actorNombre falso enviado por el cliente", async () => {
    const { status } = await admin.pedirJson("/eventos", {
      method: "POST",
      body: JSON.stringify({
        orgId,
        actorId: "00000000-0000-0000-0000-000000000099",
        actorNombre: "Hacker Falso",
        accion: "prueba_suplantacion",
        detalle: "detalle",
      }),
    });
    assert.equal(status, 200);
    const fila = await consultar(`select actor_id, actor_nombre from eventos_auditoria where accion = 'prueba_suplantacion';`);
    assert.ok(fila.includes(adminId), "el actor_id debe ser el de la sesión real");
    assert.ok(fila.includes("Admin Autz"), "el actor_nombre debe ser el de la sesión real, no el inventado");
    assert.ok(!fila.includes("Hacker Falso"), "el nombre inventado nunca debe llegar a la base de datos");
  });

  test("POST /tickets ignora un creadoPor falso enviado por el cliente", async () => {
    // El folio ya no se puede fijar a mano (lo asigna el servidor) —
    // se usa el que devuelve la propia respuesta para aislar esta fila.
    const { status, cuerpo } = await admin.pedirJson<{ folio: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId,
        nombre: "Cliente",
        tipoUsuario: "Externo",
        categoria: "General",
        procedimientoIds: [],
        estado: "pagado",
        formaPago: "Efectivo",
        creadoPor: "00000000-0000-0000-0000-000000000099",
      }),
    });
    assert.equal(status, 200);
    const fila = await consultar(`select creado_por from tickets where folio = '${cuerpo.folio}';`);
    assert.ok(fila.includes(adminId));
    assert.ok(!fila.includes("00000000-0000-0000-0000-000000000099"));
  });
});

describe("Validación de entrada en rutas de folios y catálogo", () => {
  test("rechaza un procedimiento con precio negativo", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ servicioId, nombre: "Malicioso", precio: -50 }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /negativo/);
  });

  test("rechaza un procedimiento con nombre vacío", async () => {
    const { status } = await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ servicioId, nombre: "", precio: 100 }),
    });
    assert.equal(status, 400);
  });

  test("rechaza un folio con un estado que no sea 'pagado' o 'credito'", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId, nombre: "X", tipoUsuario: "Externo", categoria: "General",
        procedimientoIds: [], estado: "gratis", formaPago: "efectivo",
      }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /estado/);
  });

  test("rechaza una categoría con nombre vacío", async () => {
    const { status } = await admin.pedirJson("/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: "", servicioId }),
    });
    assert.equal(status, 400);
  });

  // Los siguientes tres casos verifican que POST /tickets no confía en
  // lo que mande el cliente para su total ni su folio: el precio y el
  // nombre de cada procedimiento se leen siempre del catálogo en el
  // servidor (el cliente solo manda los IDs), y el folio lo asigna el
  // propio servidor de forma atómica.
  test("el total de un folio nuevo lo calcula el servidor, no lo que mande el cliente", async () => {
    await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ id: "p_integridad_1", servicioId, nombre: "Consulta", precio: 350 }),
    });
    const { cuerpo: catalogo } = await admin.pedirJson<{ id: string; nombre: string }[]>(`/procedimientos?servicioId=${servicioId}`);
    const procId = catalogo.find((p) => p.nombre === "Consulta")!.id;

    const { status, cuerpo } = await admin.pedirJson<{ total: number; procedimientos: { costo: number }[] }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId,
        nombre: "Cliente Integridad",
        tipoUsuario: "Externo",
        categoria: "General",
        procedimientoIds: [procId],
        estado: "pagado",
        formaPago: "Efectivo",
        // Un total y un costo inventados, mucho más bajos que el precio
        // real del catálogo (350) — si el servidor los usara tal cual,
        // este folio quedaría registrado por 1 en vez de 350.
        total: 1,
        procedimientos: [{ nombre: "Consulta", costo: 1 }],
      }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.total, 350, "el total debe ser el del catálogo, no el que mandó el cliente");
    assert.equal(cuerpo.procedimientos[0].costo, 350, "el costo de cada procedimiento también debe salir del catálogo");
  });

  test("rechaza procedimientoIds que no existen o que pertenecen a otro servicio", async () => {
    const otroServicio = await admin.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Servicio Ajeno Integridad", icono: "FileText", orgId }),
    });
    await admin.pedirJson("/procedimientos", {
      method: "PUT",
      body: JSON.stringify({ id: "p_integridad_ajeno", servicioId: otroServicio.cuerpo.id, nombre: "Proc Ajeno", precio: 500 }),
    });
    const { cuerpo: catalogoAjeno } = await admin.pedirJson<{ id: string; nombre: string }[]>(`/procedimientos?servicioId=${otroServicio.cuerpo.id}`);
    const procAjenoId = catalogoAjeno.find((p) => p.nombre === "Proc Ajeno")!.id;

    // Un id de otro servicio, y uno que directamente no existe.
    for (const idsInvalidos of [[procAjenoId], ["00000000-0000-0000-0000-000000000000"]]) {
      const { status, cuerpo } = await admin.pedirJson<{ error: string }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          servicioId, nombre: "Cliente", tipoUsuario: "Externo", categoria: "General",
          procedimientoIds: idsInvalidos, estado: "pagado", formaPago: "Efectivo",
        }),
      });
      assert.equal(status, 400);
      assert.match(cuerpo.error, /procedimientos/);
    }
  });

  test("dos folios generados casi al mismo tiempo en el mismo servicio nunca se repiten", async () => {
    // Reproduce el escenario real (dos personas en recepción cobrando
    // al mismo tiempo), disparando varias creaciones en paralelo de
    // verdad, no en secuencia — antes, el folio se generaba en el
    // navegador con una parte aleatoria de 4 dígitos sin ninguna
    // garantía real de no repetirse.
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () =>
        admin.pedirJson<{ folio: string }>("/tickets", {
          method: "POST",
          body: JSON.stringify({
            servicioId, nombre: "Cliente Concurrente", tipoUsuario: "Externo", categoria: "General",
            procedimientoIds: [], estado: "pagado", formaPago: "Efectivo",
          }),
        })
      )
    );
    assert.ok(resultados.every((r) => r.status === 200), "las 8 creaciones concurrentes deben tener éxito");
    const folios = resultados.map((r) => r.cuerpo.folio);
    assert.equal(new Set(folios).size, folios.length, `se esperaban 8 folios distintos, se repitió alguno: ${folios.join(", ")}`);
  });
});

describe("Cuentas sin rol de administrador — límites reales", () => {
  let personal: ReturnType<typeof crearCliente>;
  let personalId: string;

  before(async () => {
    await crearOrgConInvitacion("Org Autorizacion", "personal.autz@lxl.test", "personal");
    personal = crearCliente();
    const { cuerpo } = await personal.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Personal Autz", correo: "personal.autz@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    personalId = cuerpo.perfil.id;
  });

  test("no puede crear una categoría (solo administradores)", async () => {
    const { status } = await personal.pedirJson("/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: "No debería poder", servicioId }),
    });
    assert.notEqual(status, 200);
  });

  test("no puede autoasignarse a una organización a la que no pertenece", async () => {
    const orgAjena = await crearOrgConInvitacion("Org Ajena", "solo.para.crear@lxl.test");
    await personal.pedirJson(`/usuarios/${personalId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgIds: [orgId, orgAjena] }),
    });
    const fila = await consultar(`select count(*) from org_members where user_id = '${personalId}' and org_id = '${orgAjena}';`);
    assert.equal(fila.trim(), "0", "no debe haber quedado agregado a la organización ajena");
  });

  test("no puede ponerse a sí mismo como administrador", async () => {
    await personal.pedirJson(`/usuarios/${personalId}/rol`, {
      method: "POST",
      body: JSON.stringify({ rol: "admin" }),
    });
    const fila = await consultar(`select rol from profiles where id = '${personalId}';`);
    assert.equal(fila.trim(), "personal");
  });
});

describe("Respuestas honestas sobre el resultado real de una operación", () => {
  test("eliminar una categoría sin permiso responde con error, no con 'ok: true' falso", async () => {
    const { cuerpo: cat } = await admin.pedirJson<{ id: string }>("/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre: "Para probar borrado", servicioId }),
    });

    const personal = crearCliente();
    await crearOrgConInvitacion("Org Autorizacion", "personal.borra@lxl.test", "personal").catch(() => {});
    await personal.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Personal Borra", correo: "personal.borra@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    const { status } = await personal.pedirJson(`/categorias/${cat.id}`, { method: "DELETE" });
    assert.equal(status, 404);

    const sigueAhi = await consultar(`select count(*) from categorias where id = '${cat.id}';`);
    assert.equal(sigueAhi.trim(), "1", "la categoría debe seguir existiendo — la eliminación no autorizada no debió tener efecto");
  });

  test("eliminar un folio inexistente responde con error, no con éxito falso", async () => {
    // Un UUID con formato válido pero que no existe — la ruta identifica
    // el folio por su id ahora, no por el texto del folio (ver POST
    // /tickets/:id/pago).
    const { status } = await admin.pedirJson("/tickets/00000000-0000-0000-0000-000000000000/pago", {
      method: "POST",
      body: JSON.stringify({ formaPago: "Efectivo" }),
    });
    assert.equal(status, 404);
  });

  test("editar el perfil de otra persona sin permiso responde con error, no con éxito falso", async () => {
    const personal = crearCliente();
    await crearOrgConInvitacion("Org Autorizacion", "personal.edita.otro@lxl.test", "personal");
    await personal.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Personal Edita Otro", correo: "personal.edita.otro@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    // Ni siquiera comparte organización con el admin — de todos modos,
    // la política de "editar perfil" no distingue eso, así que el
    // punto de esta prueba es otro: antes de esta corrección, esto
    // respondía 200 con el perfil del admin sin cambiar, en vez de un
    // error: la API decía "listo" sin haber hecho nada.
    const { status } = await personal.pedirJson(`/usuarios/${adminId}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Nombre cambiado por quien no debía" }),
    });
    assert.equal(status, 404);

    const fila = await consultar(`select nombre from profiles where id = '${adminId}';`);
    assert.ok(fila.includes("Admin Autz"), "el nombre del admin no debió cambiar");
  });
});

describe("No se puede dejar a la institución sin ningún administrador", () => {
  test("el único administrador no puede quitarse a sí mismo el rol", async () => {
    const orgId2 = await crearOrgConInvitacion("Org Un Solo Admin", "unico.admin@lxl.test", "admin");
    const unico = crearCliente();
    const { cuerpo } = await unico.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Único Admin", correo: "unico.admin@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const unicoId = cuerpo.perfil.id;

    // Puede haber otros admins de OTRAS pruebas en esta misma base de
    // datos compartida — el candado es "el único admin de TODO el
    // sistema", así que para probarlo de verdad hay que degradar a
    // todos los demás primero.
    await consultar(`update profiles set rol = 'personal' where rol = 'admin' and id <> '${unicoId}';`);

    const { status, cuerpo: error } = await unico.pedirJson<{ error: string }>(`/usuarios/${unicoId}/rol`, {
      method: "POST",
      body: JSON.stringify({ rol: "personal" }),
    });
    assert.notEqual(status, 200);
    assert.match(error.error, /única cuenta administradora/);

    const fila = await consultar(`select rol from profiles where id = '${unicoId}';`);
    assert.equal(fila.trim(), "admin", "debe seguir siendo admin — el cambio no debió aplicarse");
    void orgId2;
  });

  test("dos administradores degradándose mutuamente al mismo tiempo no dejan la institución en cero", async () => {
    // Sin el bloqueo ("for update") dentro de cambiar_rol(), dos
    // sesiones concurrentes podían ver las dos "2 administradores" al
    // mismo tiempo, y las dos proceder, dejando la institución con
    // CERO. Otra vez, degrada primero a cualquier admin de otras
    // pruebas para que el conteo sea exacto.
    await consultar(`update profiles set rol = 'personal' where rol = 'admin';`);
    const orgId = await crearOrgConInvitacion("Org Dos Admins", "x.carrera@lxl.test", "admin");
    await consultar(
      `insert into invitaciones (correo, org_id, rol, token) values ('y.carrera@lxl.test', '${orgId}', 'admin', '${TOKEN_INVITACION_PRUEBA}')`
    );
    const x = crearCliente();
    const y = crearCliente();
    const { cuerpo: cx } = await x.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "X", correo: "x.carrera@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const { cuerpo: cy } = await y.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Y", correo: "y.carrera@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const xId = cx.perfil.id;
    const yId = cy.perfil.id;
    assert.equal((await consultar(`select count(*) from profiles where rol = 'admin';`)).trim(), "2");

    // Se prueba directo en SQL (no por HTTP) para controlar el
    // entrelazado exacto: la sesión 1 hace la pausa DESPUÉS de tomar el
    // bloqueo pero ANTES de terminar su transacción, justo la ventana
    // que antes permitía la carrera.
    const resultados = await consultarEnParalelo([
      `begin; select set_config('app.usuario_actual', '${xId}', true); select cambiar_rol('${yId}', 'personal'); select pg_sleep(1); commit;`,
      `select pg_sleep(0.3); begin; select set_config('app.usuario_actual', '${yId}', true); select cambiar_rol('${xId}', 'personal'); commit;`,
    ]);

    // Una de las dos debe haber fallado (la que intentó degradar al
    // último admin que quedaba) — si las DOS tuvieran éxito, ahí está
    // el bug de vuelta.
    const exitosas = resultados.filter((r) => r.ok).length;
    assert.equal(exitosas, 1, `se esperaba que exactamente una de las dos operaciones tuviera éxito, no ${exitosas}`);

    const totalAdmins = await consultar(`select count(*) from profiles where rol = 'admin';`);
    assert.equal(totalAdmins.trim(), "1", "la institución nunca debe quedarse con cero administradores");
  });
});

describe("Aislamiento entre organizaciones", () => {
  test("no se puede enviar un archivo a alguien de otra organización", async () => {
    const orgAjena = await crearOrgConInvitacion("Org Ajena Archivos", "ajeno.archivos@lxl.test", "personal");
    const ajeno = crearCliente();
    const { cuerpo } = await ajeno.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Ajeno", correo: "ajeno.archivos@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const ajenoId = cuerpo.perfil.id;

    // El admin (de "Org Autorizacion") intenta mandarle un archivo a
    // alguien que nunca ha pertenecido a esa organización.
    const { status } = await admin.pedirJson("/archivos", {
      method: "POST",
      body: JSON.stringify({
        orgId,
        paraId: ajenoId,
        tipo: "Cierre de caja",
        nombreArchivo: "cierre.csv",
        contenido: "folio,total\n1,100",
      }),
    });
    assert.notEqual(status, 200);

    const fila = await consultar(`select count(*) from archivos_enviados where para_id = '${ajenoId}';`);
    assert.equal(fila.trim(), "0", "no debió crearse ningún archivo dirigido a alguien de otra organización");
    void orgAjena;
  });
});

describe("Quitar una organización corta el acceso a sus servicios (H08)", () => {
  test("service_access sobrante no basta para seguir viendo los tickets de un servicio", async () => {
    const orgId2 = await crearOrgConInvitacion("Org H08", "personal.h08@lxl.test", "personal");
    const personal = crearCliente();
    const { cuerpo } = await personal.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Personal H08", correo: "personal.h08@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const personalId = cuerpo.perfil.id;

    // Un admin de esa misma organización crea el servicio y se lo
    // asigna a la cuenta "personal" de arriba.
    await consultar(`insert into invitaciones (correo, org_id, rol, token) values ('admin.h08@lxl.test', '${orgId2}', 'admin', '${TOKEN_INVITACION_PRUEBA}')`);
    const adminH08 = crearCliente();
    await adminH08.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Admin H08", correo: "admin.h08@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const { cuerpo: servicioH08 } = await adminH08.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Servicio H08", icono: "FileText", orgId: orgId2 }),
    });
    const servicioH08Id = servicioH08.id;
    await adminH08.pedirJson(`/usuarios/${personalId}`, {
      method: "PATCH",
      body: JSON.stringify({ servicioIds: [servicioH08Id] }),
    });
    const { cuerpo: ticket } = await adminH08.pedirJson<{ id: string; folio: string }>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        servicioId: servicioH08Id, nombre: "Cliente H08", tipoUsuario: "Externo", categoria: "General",
        procedimientoIds: [], estado: "credito",
      }),
    });

    // Con el acceso todavía completo, sí lo ve — para que la prueba de
    // abajo demuestre de verdad una pérdida de acceso, no una consulta
    // que de cualquier forma no traía nada.
    const antes = await personal.pedirJson<{ folio: string }[]>(`/tickets?servicioId=${servicioH08Id}`);
    assert.ok(antes.cuerpo.some((t) => t.folio === ticket.folio));

    // El admin quita la organización, pero simulando exactamente el
    // reporte de la auditoría: la fila de service_access sobrevive
    // porque se inserta directo en la base, sin pasar por la ruta que
    // ahora también la limpia — así se prueba la defensa real (la
    // política SQL en puede_acceder_servicio()), no solo el efecto
    // colateral de una sola ruta.
    await adminH08.pedirJson(`/usuarios/${personalId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgIds: [] }),
    });
    await consultar(`insert into service_access (service_id, user_id) values ('${servicioH08Id}', '${personalId}') on conflict do nothing;`);
    const sobrante = await consultar(`select count(*) from service_access where user_id = '${personalId}' and service_id = '${servicioH08Id}';`);
    assert.equal(sobrante.trim(), "1", "la fila sobrante debe existir para que esta prueba sea real");

    // RLS filtra en silencio (no da error, da una lista sin ese
    // folio) — por eso se compara el contenido, no el status.
    const despues = await personal.pedirJson<{ folio: string }[]>(`/tickets?servicioId=${servicioH08Id}`);
    assert.ok(
      !despues.cuerpo.some((t) => t.folio === ticket.folio),
      "sin ser miembro de la organización, el acceso directo al servicio no debe alcanzar"
    );
  });
});
