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

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

describe("Registro", () => {
  test("rechaza el registro sin invitación vigente", async () => {
    const cliente = crearCliente();
    // Con token, para que la petición llegue hasta el chequeo de si
    // existe invitación (que es lo que esta prueba quiere verificar) —
    // sin token, se rechaza antes, por "falta el código".
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Nadie", correo: "sin.invitacion@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    assert.equal(status, 403);
    assert.match(cuerpo.error, /invitarte/);
  });

  test("rechaza el registro sin el campo de código de invitación", async () => {
    await crearOrgConInvitacion("Org Sin Token", "sin.token@lxl.test", "admin");
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Alguien", correo: "sin.token@lxl.test", password: "ClaveSegura123!" }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /código de invitación/);
  });

  test("rechaza el registro con un código de invitación incorrecto", async () => {
    await crearOrgConInvitacion("Org Token Incorrecto", "token.incorrecto@lxl.test", "admin");
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Alguien", correo: "token.incorrecto@lxl.test", password: "ClaveSegura123!", token: "el-codigo-equivocado" }),
    });
    assert.equal(status, 403);
    assert.match(cuerpo.error, /código de invitación/);

    // La cuenta no debió crearse — igual que un correo incorrecto no
    // debe dejar rastro de que "casi entró".
    const cuenta = await consultar("select count(*) from profiles where correo = 'token.incorrecto@lxl.test';");
    assert.equal(cuenta.trim(), "0");
  });

  test("acepta el registro con una invitación vigente, con ese correo exacto", async () => {
    await crearOrgConInvitacion("Org Registro", "admin.registro@lxl.test", "admin");
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Admin Registro", correo: "admin.registro@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.perfil.correo, "admin.registro@lxl.test");
    assert.equal(cuerpo.perfil.rol, "admin");
  });

  test("rechaza una contraseña de menos de 8 caracteres, aunque haya invitación", async () => {
    await crearOrgConInvitacion("Org Corta", "corta@lxl.test", "admin");
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "X", correo: "corta@lxl.test", password: "123", token: TOKEN_INVITACION_PRUEBA }),
    });
    assert.equal(status, 400);
    assert.match(cuerpo.error, /8 caracteres/);
  });

  test("el campo trampa (honeypot) rechaza el registro con el mismo mensaje genérico", async () => {
    await crearOrgConInvitacion("Org Trampa", "trampa.reg@lxl.test", "admin");
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Bot", correo: "trampa.reg@lxl.test", password: "ClaveSegura123!", trampa: "relleno-de-bot", token: TOKEN_INVITACION_PRUEBA }),
    });
    assert.equal(status, 400);
    assert.equal(cuerpo.error, "Ese correo no es válido.");
    // Nunca se creó la cuenta de verdad.
    const cuenta = await consultar("select count(*) from profiles where correo = 'trampa.reg@lxl.test';");
    assert.equal(cuenta.trim(), "0");
  });
});

describe("Inicio de sesión", () => {
  test("rechaza contraseña incorrecta con mensaje genérico (no revela si la cuenta existe)", async () => {
    await crearOrgConInvitacion("Org Login", "login@lxl.test", "admin");
    const registro = crearCliente();
    await registro.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Login Test", correo: "login@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "login@lxl.test", password: "contraseña-equivocada" }),
    });
    assert.equal(status, 401);
    assert.equal(cuerpo.error, "Contraseña incorrecta o la cuenta no existe.");
  });

  test("un correo que no existe da exactamente el mismo mensaje que una contraseña incorrecta", async () => {
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "no.existe.para.nada@lxl.test", password: "cualquier-cosa123" }),
    });
    assert.equal(status, 401);
    assert.equal(cuerpo.error, "Contraseña incorrecta o la cuenta no existe.");
  });

  test("con la contraseña correcta, la sesión persiste en llamadas siguientes (cookie)", async () => {
    await crearOrgConInvitacion("Org Sesion", "sesion@lxl.test", "admin");
    const registro = crearCliente();
    await registro.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Sesion Test", correo: "sesion@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    const cliente = crearCliente();
    const login = await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "sesion@lxl.test", password: "ClaveSegura123!" }),
    });
    assert.equal(login.status, 200);

    const sesion = await cliente.pedirJson("/auth/sesion");
    assert.equal(sesion.status, 200);
    assert.equal(sesion.cuerpo.perfil.correo, "sesion@lxl.test");
  });

  test("sin cookie de sesión, /auth/sesion no revela ningún perfil", async () => {
    const cliente = crearCliente();
    const { status } = await cliente.pedirJson("/auth/sesion");
    // 401 sin sesión — es el chequeo normal de "¿ya inicié sesión?" que
    // hace la app al cargar, no un error real.
    assert.equal(status, 401);
  });

  test("cerrar sesión invalida la cookie de verdad", async () => {
    await crearOrgConInvitacion("Org Logout", "logout@lxl.test", "admin");
    const registro = crearCliente();
    await registro.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Logout Test", correo: "logout@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    const cliente = crearCliente();
    await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "logout@lxl.test", password: "ClaveSegura123!" }),
    });
    await cliente.pedirJson("/auth/logout", { method: "POST" });
    const sesion = await cliente.pedirJson("/auth/sesion");
    assert.equal(sesion.status, 401);
  });

  test("bloquea la cuenta después de 5 contraseñas incorrectas seguidas", async () => {
    await crearOrgConInvitacion("Org Bloqueo", "bloqueo@lxl.test", "admin");
    const registro = crearCliente();
    await registro.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Bloqueo Test", correo: "bloqueo@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    for (let i = 0; i < 5; i++) {
      const intento = crearCliente();
      await intento.pedirJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ correo: "bloqueo@lxl.test", password: "equivocada" }),
      });
    }

    // Ahora, hasta con la contraseña CORRECTA, debe quedar bloqueada.
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "bloqueo@lxl.test", password: "ClaveSegura123!" }),
    });
    assert.equal(status, 429);
    assert.match(cuerpo.error, /bloqueada/);
  });
});

describe("Cambiar la contraseña invalida cualquier sesión anterior", () => {
  test("una sesión copiada antes del cambio deja de servir, pero la propia (con cookie nueva) sigue viva", async () => {
    await crearOrgConInvitacion("Org Invalidar Sesion", "invalidar.sesion@lxl.test", "admin");
    const cliente = crearCliente();
    await cliente.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Invalidar Sesion", correo: "invalidar.sesion@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    // Simula un JWT robado: una copia exacta de la cookie de sesión,
    // tomada ANTES de cambiar la contraseña.
    const copia = crearCliente();
    copia.ponerCookie(cliente.copiarCookie());
    const antesDeCambiar = await copia.pedirJson("/auth/sesion");
    assert.equal(antesDeCambiar.status, 200, "la copia debe funcionar antes del cambio, como cualquier sesión real");

    const cambio = await cliente.pedirJson("/auth/cambiar-password", {
      method: "POST",
      body: JSON.stringify({ actual: "ClaveSegura123!", nueva: "ClaveNuevaSegura456!" }),
    });
    assert.equal(cambio.status, 200);

    const despuesDeCambiar = await copia.pedirJson("/auth/sesion");
    assert.equal(despuesDeCambiar.status, 401, "la sesión copiada debe morir en cuanto cambia la contraseña");

    // El cliente que SÍ hizo el cambio recibió una cookie nueva en la
    // misma respuesta — a él no lo debe sacar el cambio de su propia
    // contraseña.
    const propia = await cliente.pedirJson("/auth/sesion");
    assert.equal(propia.status, 200, "quien cambió su propia contraseña no debe perder su propia sesión");
  });

  test("un administrador restableciendo la contraseña de otra persona también le invalida su sesión activa", async () => {
    const orgId = await crearOrgConInvitacion("Org Reset Admin", "admin.reset.sesion@lxl.test", "admin");
    const admin = crearCliente();
    await admin.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Admin Reset", correo: "admin.reset.sesion@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    await consultar(
      `insert into invitaciones (correo, org_id, rol, token) values ('victima.reset@lxl.test', '${orgId}', 'personal', '${TOKEN_INVITACION_PRUEBA}')`
    );
    const victima = crearCliente();
    const { cuerpo } = await victima.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Víctima", correo: "victima.reset@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    const antes = await victima.pedirJson("/auth/sesion");
    assert.equal(antes.status, 200);

    const reset = await admin.pedirJson(`/usuarios/${cuerpo.perfil.id}/restablecer-password`, { method: "POST" });
    assert.equal(reset.status, 200);

    const despues = await victima.pedirJson("/auth/sesion");
    assert.equal(despues.status, 401, "la sesión de la persona a la que le restablecieron la contraseña debe morir de inmediato");
  });

  test("una contraseña temporal obliga a cambiarla antes de usar cualquier otra ruta", async () => {
    const orgId = await crearOrgConInvitacion("Org Cambio Obligatorio", "admin.cambio.obligatorio@lxl.test", "admin");
    const admin = crearCliente();
    await admin.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Admin Cambio", correo: "admin.cambio.obligatorio@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });
    await consultar(
      `insert into invitaciones (correo, org_id, rol, token) values ('victima.cambio@lxl.test', '${orgId}', 'personal', '${TOKEN_INVITACION_PRUEBA}')`
    );
    const victima = crearCliente();
    const { cuerpo } = await victima.pedirJson<{ perfil: { id: string } }>("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Víctima Cambio", correo: "victima.cambio@lxl.test", password: "ClaveSegura123!", token: TOKEN_INVITACION_PRUEBA }),
    });

    const { cuerpo: reset } = await admin.pedirJson<{ passwordTemporal: string }>(`/usuarios/${cuerpo.perfil.id}/restablecer-password`, {
      method: "POST",
    });

    // Con la contraseña temporal, sí entra — pero cualquier otra ruta
    // (una que no sea ver la sesión, cambiar la contraseña, o salir)
    // debe quedar bloqueada hasta que la cambie.
    const cliente = crearCliente();
    const login = await cliente.pedirJson<{ perfil: { debeCambiarPassword?: boolean } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: "victima.cambio@lxl.test", password: reset.passwordTemporal }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.cuerpo.perfil.debeCambiarPassword, true);

    const bloqueado = await cliente.pedirJson<{ error: string; debeCambiarPassword?: boolean }>("/servicios");
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.cuerpo.debeCambiarPassword, true);

    // /auth/sesion sigue sirviendo (el frontend lo necesita para saber
    // que debe mostrar la pantalla de cambio).
    const sesion = await cliente.pedirJson("/auth/sesion");
    assert.equal(sesion.status, 200);

    const cambio = await cliente.pedirJson("/auth/cambiar-password", {
      method: "POST",
      body: JSON.stringify({ actual: reset.passwordTemporal, nueva: "OtraClaveSegura789!" }),
    });
    assert.equal(cambio.status, 200);

    // Ahora sí, cualquier ruta vuelve a servir con normalidad.
    const yaLibre = await cliente.pedirJson("/servicios");
    assert.equal(yaLibre.status, 200);
  });
});
