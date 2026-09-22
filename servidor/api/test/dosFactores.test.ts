import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { generate as generarTotp } from "otplib";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import {
  prepararBaseDeDatos,
  borrarBaseDeDatos,
  iniciarServidor,
  detenerServidor,
  crearCliente,
  crearOrgConInvitacion,
  consultar,
  TOKEN_INVITACION_PRUEBA,
  JWT_SECRET_PRUEBA,
} from "./helpers.js";

// Misma derivación que auth.ts (derivarSecreto) — se reproduce aquí
// porque estas pruebas necesitan firmar, con la misma llave que usa el
// servidor de pruebas, una sesión y un token de reautenticación de
// Microsoft sin poder completar el flujo OAuth real (este entorno no
// tiene acceso a Microsoft).
function derivarSecretoDePrueba(dominio: string): string {
  return createHmac("sha256", JWT_SECRET_PRUEBA).update(dominio).digest("hex");
}

let admin: ReturnType<typeof crearCliente>;
const CORREO = "admin.2fa@lxl.test";
const PASSWORD = "ClaveSegura123!";

before(async () => {
  await prepararBaseDeDatos();
  await iniciarServidor();
  await crearOrgConInvitacion("Org 2FA", CORREO, "admin");
  admin = crearCliente();
  await admin.pedirJson("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre: "Admin 2FA", correo: CORREO, password: PASSWORD, token: TOKEN_INVITACION_PRUEBA }),
  });
});

after(async () => {
  detenerServidor();
  await borrarBaseDeDatos();
});

let secreto: string;

describe("Configurar la autenticación de dos factores", () => {
  test("iniciar genera un secreto y un código QR", async () => {
    const { status, cuerpo } = await admin.pedirJson<{ secretoManual: string; qr: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(status, 200);
    assert.ok(cuerpo.secretoManual.length > 0);
    assert.match(cuerpo.qr, /^data:image\/png;base64,/);
    secreto = cuerpo.secretoManual;
  });

  test("confirmar con un código incorrecto no activa la cuenta", async () => {
    const { status } = await admin.pedirJson("/auth/2fa/confirmar", {
      method: "POST",
      body: JSON.stringify({ codigo: "000000" }),
    });
    assert.equal(status, 400);
  });

  test("confirmar con el código real activa la cuenta", async () => {
    const codigo = await generarTotp({ secret: secreto });
    const { status, cuerpo } = await admin.pedirJson<{ ok: boolean }>("/auth/2fa/confirmar", {
      method: "POST",
      body: JSON.stringify({ codigo }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.ok, true);

    const sesion = await admin.pedirJson<{ perfil: { totpHabilitado: boolean } }>("/auth/sesion");
    assert.equal(sesion.cuerpo.perfil.totpHabilitado, true);
  });
});

describe("Reemplazar un secreto 2FA ya activo no lo desactiva de golpe", () => {
  test("iniciar sin la contraseña, o con una incorrecta, se rechaza", async () => {
    const sinPassword = await admin.pedirJson("/auth/2fa/iniciar", { method: "POST" });
    assert.equal(sinPassword.status, 400);

    const passwordMala = await admin.pedirJson("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: "equivocada" }),
    });
    assert.equal(passwordMala.status, 400);
  });

  test("iniciar un reemplazo con la contraseña correcta no desactiva el secreto ya activo hasta confirmarlo", async () => {
    // 2FA ya está activo desde el describe anterior, con "secreto".
    // Pedir uno nuevo no debe romper el que ya funciona.
    const { cuerpo } = await admin.pedirJson<{ secretoManual: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    const secretoPendiente = cuerpo.secretoManual;
    assert.notEqual(secretoPendiente, secreto, "debe ser un secreto distinto al que ya estaba activo");

    // Sin confirmar el nuevo, el código del secreto VIEJO sigue
    // sirviendo para entrar — antes de esta corrección, el secreto
    // nuevo reemplazaba al viejo de inmediato, sin pedir contraseña ni
    // esperar confirmación.
    const cliente = crearCliente();
    const { cuerpo: loginCuerpo } = await cliente.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    const codigoViejo = await generarTotp({ secret: secreto });
    const { status } = await cliente.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: loginCuerpo.tokenPre, codigo: codigoViejo }),
    });
    assert.equal(status, 200, "el código del secreto ya activo debe seguir sirviendo mientras el reemplazo no se confirme");

    // El código del secreto PENDIENTE, en cambio, todavía no sirve para
    // entrar — solo /auth/2fa/confirmar lo activa.
    const cliente2 = crearCliente();
    const { cuerpo: loginCuerpo2 } = await cliente2.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    const codigoPendiente = await generarTotp({ secret: secretoPendiente });
    const intento = await cliente2.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: loginCuerpo2.tokenPre, codigo: codigoPendiente }),
    });
    assert.notEqual(intento.status, 200, "el código del secreto pendiente no debe servir todavía");

    // No hace falta limpiar nada más: nunca se confirmó este reemplazo
    // (no se llamó /auth/2fa/confirmar), así que totp_secret —y
    // "secreto"— siguen intactos para el resto de este archivo. El
    // secreto pendiente sin confirmar se queda ahí, sin efecto sobre
    // nada más.
  });
});

describe("Confirmar 2FA no puede activar un secreto que nunca se verificó", () => {
  const CORREO_CARRERA = "carrera.2fa@lxl.test";
  let cuentaCarrera: ReturnType<typeof crearCliente>;

  before(async () => {
    await crearOrgConInvitacion("Org Carrera 2FA", CORREO_CARRERA, "admin");
    cuentaCarrera = crearCliente();
    await cuentaCarrera.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Carrera 2FA", correo: CORREO_CARRERA, password: PASSWORD, token: TOKEN_INVITACION_PRUEBA }),
    });
  });

  test("un /auth/2fa/iniciar concurrente con la confirmación no deja activo un secreto sin código verificado", async () => {
    const { cuerpo: inicioA } = await cuentaCarrera.pedirJson<{ secretoManual: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    const secretoA = inicioA.secretoManual;
    const codigoA = await generarTotp({ secret: secretoA });

    // Dos peticiones REALES en paralelo sobre la misma cuenta: una
    // confirma con el código de A (ya generado, válido en este
    // instante); la otra pide un secreto nuevo B, como si fuera otra
    // pestaña de la misma persona. Antes de esta corrección, si la
    // segunda alcanzaba a sustituir totp_secret_pendiente por B justo
    // entre la verificación del código de A y el UPDATE de la primera
    // (que releía la columna en vez de usar el valor ya verificado),
    // ese UPDATE activaba B — un secreto cuyo código nunca se
    // verificó. No se fuerza el orden exacto a propósito: el punto es
    // que, ganara quien ganara la carrera, NUNCA debe quedar activo un
    // secreto sin verificar.
    const [confirmacion] = await Promise.all([
      cuentaCarrera.pedirJson("/auth/2fa/confirmar", { method: "POST", body: JSON.stringify({ codigo: codigoA }) }),
      cuentaCarrera.pedirJson("/auth/2fa/iniciar", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }),
    ]);

    const fila = await consultar(`select totp_habilitado from profiles where correo = '${CORREO_CARRERA}';`);
    const habilitado = fila.trim() === "t";

    if (habilitado) {
      // Si quedó activo, tiene que ser justo el que se verificó (A) —
      // nunca uno que la petición concurrente haya dejado a medias.
      assert.equal(confirmacion.status, 200, "si 2FA quedó activo, la confirmación con el código de A debió reportar éxito");
      const cliente = crearCliente();
      const { cuerpo } = await cliente.pedirJson<{ tokenPre: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ correo: CORREO_CARRERA, password: PASSWORD }),
      });
      const codigoRealA = await generarTotp({ secret: secretoA });
      const { status } = await cliente.pedirJson("/auth/login/2fa", {
        method: "POST",
        body: JSON.stringify({ tokenPre: cuerpo.tokenPre, codigo: codigoRealA }),
      });
      assert.equal(status, 200, "el secreto activo debe ser A — el único cuyo código se verificó de verdad");
    } else {
      // Si no quedó activo, la confirmación debió rechazarse con
      // claridad (409: "cambió mientras confirmabas"), no un éxito a
      // medias ni un 500 genérico.
      assert.equal(confirmacion.status, 409);
    }
  });
});

describe("Un tokenPre emitido antes de cambiar la contraseña deja de servir", () => {
  const CORREO3 = "tokenpre.vencido@lxl.test";
  let secreto3: string;

  before(async () => {
    await crearOrgConInvitacion("Org TokenPre Vencido", CORREO3, "admin");
    const cuenta = crearCliente();
    await cuenta.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "TokenPre Vencido", correo: CORREO3, password: PASSWORD, token: TOKEN_INVITACION_PRUEBA }),
    });
    const { cuerpo } = await cuenta.pedirJson<{ secretoManual: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    secreto3 = cuerpo.secretoManual;
    const codigo = await generarTotp({ secret: secreto3 });
    await cuenta.pedirJson("/auth/2fa/confirmar", { method: "POST", body: JSON.stringify({ codigo }) });
  });

  test("un tokenPre obtenido antes de cambiar la contraseña no completa el login después", async () => {
    const cliente = crearCliente();
    const { cuerpo } = await cliente.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO3, password: PASSWORD }),
    });
    const tokenPreViejo = cuerpo.tokenPre;

    // Otra sesión (la propia cuenta, con su cookie ya activa) cambia la
    // contraseña — esto es justo el caso real: alguien reacciona a una
    // cuenta comprometida cambiando la contraseña, y ese cambio debe
    // cerrarle la puerta a cualquier login ya en curso, no solo a
    // sesiones ya completas.
    // La cuenta tiene 2FA, así que hace falta completar el login (no
    // solo la contraseña) para tener una sesión real con la que cambiar
    // la contraseña.
    const cuenta = crearCliente();
    const loginCompleto = await cuenta.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO3, password: PASSWORD }),
    });
    const codigoParaEntrar = await generarTotp({ secret: secreto3 });
    await cuenta.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: loginCompleto.cuerpo.tokenPre, codigo: codigoParaEntrar }),
    });
    await cuenta.pedirJson("/auth/cambiar-password", {
      method: "POST",
      body: JSON.stringify({ actual: PASSWORD, nueva: "OtraClaveSegura789!" }),
    });

    // El tokenPre viejo, con el código TOTP correcto, ya no debe
    // bastar — la contraseña cambió después de que se emitió.
    const codigoReal = await generarTotp({ secret: secreto3 });
    const { status } = await cliente.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: tokenPreViejo, codigo: codigoReal }),
    });
    assert.notEqual(status, 200);
  });
});

describe("Iniciar sesión con la cuenta protegida por 2FA", () => {
  test("la contraseña correcta ya NO basta por sí sola — no se pone cookie de sesión", async () => {
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson<{ requiere2FA?: boolean; tokenPre?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    assert.equal(status, 200);
    assert.equal(cuerpo.requiere2FA, true);
    assert.ok(cuerpo.tokenPre);

    // Sin completar el segundo paso, esta misma sesión no debe estar
    // autenticada todavía.
    const sesion = await cliente.pedirJson("/auth/sesion");
    assert.equal(sesion.status, 401);
  });

  test("un código incorrecto en el segundo paso no da sesión", async () => {
    const cliente = crearCliente();
    const { cuerpo } = await cliente.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    const { status } = await cliente.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: cuerpo.tokenPre, codigo: "000000" }),
    });
    assert.equal(status, 401);
  });

  test("el código correcto en el segundo paso sí da sesión completa", async () => {
    const cliente = crearCliente();
    const { cuerpo } = await cliente.pedirJson<{ tokenPre: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    const codigo = await generarTotp({ secret: secreto });
    const { status } = await cliente.pedirJson("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tokenPre: cuerpo.tokenPre, codigo }),
    });
    assert.equal(status, 200);

    const sesion = await cliente.pedirJson<{ perfil: { correo: string } }>("/auth/sesion");
    assert.equal(sesion.status, 200);
    assert.equal(sesion.cuerpo.perfil.correo, CORREO);
  });
});

describe("El segundo paso del login con 2FA también se bloquea por intentos", () => {
  // Cuenta aparte: bloquearla no debe afectar las demás pruebas de este
  // archivo, que siguen usando la cuenta compartida.
  const CORREO_BLOQUEO = "bloqueo.2fa@lxl.test";
  let secretoBloqueo: string;

  before(async () => {
    await crearOrgConInvitacion("Org Bloqueo 2FA", CORREO_BLOQUEO, "admin");
    const cuenta = crearCliente();
    await cuenta.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Bloqueo 2FA", correo: CORREO_BLOQUEO, password: PASSWORD, token: TOKEN_INVITACION_PRUEBA }),
    });
    const { cuerpo } = await cuenta.pedirJson<{ secretoManual: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    secretoBloqueo = cuerpo.secretoManual;
    const codigo = await generarTotp({ secret: secretoBloqueo });
    await cuenta.pedirJson("/auth/2fa/confirmar", { method: "POST", body: JSON.stringify({ codigo }) });
  });

  test("5 códigos incorrectos seguidos bloquean la cuenta, aunque cada intento venga de una sesión distinta", async () => {
    for (let i = 0; i < 5; i++) {
      const intento = crearCliente();
      const { cuerpo } = await intento.pedirJson<{ tokenPre: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ correo: CORREO_BLOQUEO, password: PASSWORD }),
      });
      await intento.pedirJson("/auth/login/2fa", {
        method: "POST",
        body: JSON.stringify({ tokenPre: cuerpo.tokenPre, codigo: "000000" }),
      });
    }

    // Ahora, hasta con la contraseña CORRECTA, el login ni siquiera
    // debe llegar a pedir el código — el bloqueo por cuenta es el mismo
    // que el de contraseña (misma columna bloqueado_hasta), y ya se
    // revisa desde el primer paso.
    const cliente = crearCliente();
    const { status, cuerpo: error } = await cliente.pedirJson<{ error: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO_BLOQUEO, password: PASSWORD }),
    });
    assert.equal(status, 429);
    assert.match(error.error, /bloqueada/);
  });
});

describe("Desactivar la autenticación de dos factores", () => {
  test("con la contraseña equivocada, no se desactiva", async () => {
    const { status } = await admin.pedirJson("/auth/2fa/desactivar", {
      method: "POST",
      body: JSON.stringify({ password: "equivocada" }),
    });
    assert.equal(status, 400);
    const sesion = await admin.pedirJson<{ perfil: { totpHabilitado: boolean } }>("/auth/sesion");
    assert.equal(sesion.cuerpo.perfil.totpHabilitado, true);
  });

  test("con la contraseña correcta, se desactiva y el login vuelve a ser de un solo paso", async () => {
    const { status } = await admin.pedirJson("/auth/2fa/desactivar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(status, 200);

    const cliente = crearCliente();
    const login = await cliente.pedirJson<{ perfil?: { correo: string }; requiere2FA?: boolean }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo: CORREO, password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.cuerpo.requiere2FA, undefined);
    assert.equal(login.cuerpo.perfil?.correo, CORREO);
  });
});

describe("Activar o desactivar 2FA invalida cualquier otra sesión activa", () => {
  // Cambiar la contraseña ya invalidaba cualquier sesión copiada (ver
  // auth.test.ts); activar o desactivar 2FA debe hacer lo mismo — una
  // sesión ya robada no debe seguir sirviendo después de que su dueño
  // intente protegerse activando 2FA, ni después de desactivarlo.
  const CORREO2 = "invalidar.2fa@lxl.test";
  let dueño: ReturnType<typeof crearCliente>;
  let secreto2: string;

  before(async () => {
    await crearOrgConInvitacion("Org Invalidar 2FA", CORREO2, "admin");
    dueño = crearCliente();
    await dueño.pedirJson("/auth/registrar", {
      method: "POST",
      body: JSON.stringify({ nombre: "Dueño 2FA", correo: CORREO2, password: PASSWORD, token: TOKEN_INVITACION_PRUEBA }),
    });
  });

  test("activar 2FA mata una sesión copiada de antes", async () => {
    const copia = crearCliente();
    copia.ponerCookie(dueño.copiarCookie());
    const antes = await copia.pedirJson("/auth/sesion");
    assert.equal(antes.status, 200, "la copia debe funcionar antes de activar 2FA");

    const { cuerpo } = await dueño.pedirJson<{ secretoManual: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    secreto2 = cuerpo.secretoManual;
    const codigo = await generarTotp({ secret: secreto2 });
    const activar = await dueño.pedirJson("/auth/2fa/confirmar", {
      method: "POST",
      body: JSON.stringify({ codigo }),
    });
    assert.equal(activar.status, 200);

    const despues = await copia.pedirJson("/auth/sesion");
    assert.equal(despues.status, 401, "la sesión copiada debe morir en cuanto se activa 2FA");

    const propia = await dueño.pedirJson("/auth/sesion");
    assert.equal(propia.status, 200, "quien activó su propio 2FA no debe perder su propia sesión");
  });

  test("desactivar 2FA mata una sesión copiada de antes", async () => {
    const copia = crearCliente();
    copia.ponerCookie(dueño.copiarCookie());
    const antes = await copia.pedirJson("/auth/sesion");
    assert.equal(antes.status, 200, "la copia debe funcionar antes de desactivar 2FA");

    const desactivar = await dueño.pedirJson("/auth/2fa/desactivar", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(desactivar.status, 200);

    const despues = await copia.pedirJson("/auth/sesion");
    assert.equal(despues.status, 401, "la sesión copiada debe morir en cuanto se desactiva 2FA");

    const propia = await dueño.pedirJson("/auth/sesion");
    assert.equal(propia.status, 200, "quien desactivó su propio 2FA no debe perder su propia sesión");
  });
});

describe("Una cuenta sin contraseña propia (creada por Microsoft) puede iniciar 2FA reautenticándose ahí, no con una contraseña que nunca tuvo", () => {
  const CORREO_MS = "solo.microsoft@lxl.test";
  let idMicrosoft: string;

  before(async () => {
    await crearOrgConInvitacion("Org Solo Microsoft", CORREO_MS, "admin");
    // Lo mismo que hace de verdad registrar_usuario_via_microsoft()
    // cuando alguien entra por primera vez con Microsoft (ver
    // microsoft.ts) — se llama aquí directo porque este entorno de
    // pruebas no tiene acceso real a Microsoft para completar el flujo
    // OAuth de punta a punta.
    const fila = await consultar(
      `select id from registrar_usuario_via_microsoft('Solo Microsoft', '${CORREO_MS}', 'microsoft-sso:sin-password-propia');`
    );
    idMicrosoft = fila.trim();
  });

  function sesionDe(usuarioId: string): string {
    // Una sesión real, firmada con la misma llave que usa el servidor
    // de pruebas — no hay forma de que esta cuenta complete un login
    // real (ni por Microsoft, que no está disponible aquí, ni por
    // contraseña, que nunca tuvo).
    return `finaquick_sesion=${jwt.sign({ sub: usuarioId, emitidoEnMs: Date.now() }, derivarSecretoDePrueba("sesion"), { expiresIn: "30d" })}`;
  }

  test("con una contraseña (cualquiera), esta cuenta nunca puede iniciar 2FA", async () => {
    const cliente = crearCliente();
    cliente.ponerCookie(sesionDe(idMicrosoft));
    const { status } = await cliente.pedirJson("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ password: "cualquier-cosa-que-alguien-intente" }),
    });
    // Antes de esta corrección, esto era un 400 PERMANENTE — la cuenta
    // no podía activar 2FA de ninguna forma, porque bcrypt.compare
    // contra el marcador de "sin password propia" siempre da false.
    assert.equal(status, 400);
  });

  test("con un token de reautenticación de Microsoft válido para esta misma cuenta, sí puede iniciar 2FA", async () => {
    const cliente = crearCliente();
    cliente.ponerCookie(sesionDe(idMicrosoft));
    const reauthToken = jwt.sign(
      { tipo: "2fa_reautenticado_microsoft", sub: idMicrosoft },
      derivarSecretoDePrueba("accion"),
      { expiresIn: "5m" }
    );
    const { status, cuerpo } = await cliente.pedirJson<{ secretoManual: string; qr: string }>("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ reauthToken }),
    });
    assert.equal(status, 200);
    assert.ok(cuerpo.secretoManual);
  });

  test("un token de reautenticación firmado para OTRA cuenta se rechaza", async () => {
    const cliente = crearCliente();
    cliente.ponerCookie(sesionDe(idMicrosoft));
    const reauthTokenAjeno = jwt.sign(
      { tipo: "2fa_reautenticado_microsoft", sub: "00000000-0000-0000-0000-000000000099" },
      derivarSecretoDePrueba("accion"),
      { expiresIn: "5m" }
    );
    const { status } = await cliente.pedirJson("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ reauthToken: reauthTokenAjeno }),
    });
    assert.equal(status, 400);
  });

  test("una cuenta CON contraseña propia no puede usar un reauthToken para saltarse la contraseña", async () => {
    const idConPassword = (await consultar(`select id from profiles where correo = '${CORREO}';`)).trim();
    const cliente = crearCliente();
    cliente.ponerCookie(sesionDe(idConPassword));
    // El "tipo" y el "sub" del token son exactamente los correctos —
    // lo único que no calza es que esta cuenta SÍ tiene una contraseña
    // real, así que el reauthToken no debe bastarle.
    const reauthToken = jwt.sign(
      { tipo: "2fa_reautenticado_microsoft", sub: idConPassword },
      derivarSecretoDePrueba("accion"),
      { expiresIn: "5m" }
    );
    const { status } = await cliente.pedirJson("/auth/2fa/iniciar", {
      method: "POST",
      body: JSON.stringify({ reauthToken }),
    });
    assert.equal(status, 400);
  });
});
