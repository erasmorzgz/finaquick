import { Router } from "express";
import crypto from "node:crypto";
import type { Response } from "express";
import rateLimit from "express-rate-limit";
import { generateSecret, verify as verificarTotp, generateURI } from "otplib";
import QRCode from "qrcode";
import { conSesionDe, pool } from "./db.js";
import {
  hashPassword,
  verificarPassword,
  firmarSesion,
  requerirSesion,
  ponerCookieSesion,
  limpiarCookieSesion,
  firmarTokenAccion,
  verificarTokenAccion,
  cifrarTotp,
  descifrarTotp,
  MARCADOR_SIN_PASSWORD_PROPIA,
} from "./auth.js";
import type { RequestConUsuario } from "./auth.js";
import { mandarCorreo, correoConfigurado, escaparHtml } from "./correo.js";
import { interpretarConIA, narrarResultado, responderChatLibre, estadoIA } from "./asistente.js";
import * as registro from "./registro.js";

export const rutas = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LARGO_MIN_PASSWORD = 8;

/** El formulario ya valida esto, pero el formulario se puede saltar
 * llamando la API directo — sin esto, cualquiera podría registrar una
 * cuenta con "123" de contraseña vía una petición HTTP a mano. */
function validarCredenciales(correo: unknown, password: unknown): string | null {
  if (typeof correo !== "string" || !REGEX_CORREO.test(correo.trim())) return "Ese correo no es válido.";
  if (typeof password !== "string" || password.length < LARGO_MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${LARGO_MIN_PASSWORD} caracteres.`;
  }
  return null;
}

// Límites de campos de texto/imagen — sin esto, cualquiera podría
// mandar un "nombre" o "bio" de varios megabytes, o una "foto" que en
// realidad es un archivo enorme disfrazado de imagen (el navegador
// respeta accept="image/*" en el selector de archivos, pero eso es
// solo una sugerencia de interfaz — no protege nada si alguien llama
// la API directo). Los límites de longitud de texto son generosos
// para uso normal, no arbitrarios.
const LARGO_MAX_NOMBRE = 200;
const LARGO_MAX_TEXTO_CORTO = 120; // teléfono, etc.
const LARGO_MAX_BIO = 2000;
const LARGO_MAX_IMAGEN_DATAURL = 2_000_000; // ~1.5MB de imagen real, de sobra para una foto de perfil o un logo

// Mismas tres formas de pago que ofrece la interfaz (ver FormaPago en
// src/lib/db/types.ts) — antes el servidor aceptaba cualquier texto no
// vacío aquí, así que una petición hecha a mano (no desde la interfaz)
// podía guardar un valor que el cierre de caja no supiera agrupar
// ("transferencia", "tarjeta" en minúsculas, etc.): el total del día
// seguía sumando ese folio, pero el desglose por forma de pago no,
// dando un total que no cuadraba con la suma de sus partes. Aceptar
// "transferencia" como una forma de pago más es una decisión de
// producto de la institución, no algo que decida este código — por
// ahora el servidor solo garantiza que lo que se guarda es una de las
// tres que la interfaz ya sabe mostrar.
const FORMAS_PAGO_VALIDAS = ["Efectivo", "Tarjeta de débito", "Tarjeta de crédito"] as const;

// Espacios, mayúsculas/minúsculas o forma de normalización Unicode
// distintos no deben bastar para esquivar la reserva de abajo — el
// primer intento de este candado comparaba el texto crudo, y un
// espacio al final ("Cambió el rol de un usuario ") ya alcanzaba para
// que `Set.has()` dijera "no coincide" y dejara pasar, sin que se
// notara a simple vista en la bitácora. Esto NO cierra un homógrafo
// deliberado (una "o" cirílica en vez de la latina, por ejemplo) —
// nadie audita visualmente contra eso, y resolverlo de verdad necesita
// el rediseño más amplio ya señalado (procedencia autoritativa
// separada de comentarios de texto libre), no un `trim()` más.
function normalizarAccion(s: string): string {
  return s.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}
// Ver el comentario junto a su uso en POST /eventos — cada una de
// estas ya la registra el servidor mismo, de forma atómica, dentro de
// la misma transacción que la acción real (ver registrarEventoAtomico
// y las rutas que la usan) — un cliente no debe poder insertar OTRA
// con el mismo texto (ni una variante suya solo en mayúsculas o
// espacios) para que aparente ser una de estas.
const ACCIONES_RESERVADAS_AL_SERVIDOR = new Set(
  [
    "Cambió el rol de un usuario",
    "Restableció la contraseña de alguien",
    "Cambió la marca",
    "Creó el servicio",
    "Eliminó el servicio",
    "Agregó a alguien a la organización",
    "Quitó a alguien de la organización",
    "Le asignó un servicio a alguien",
    "Le quitó un servicio a alguien",
    "Cambió el nivel de acceso de alguien",
    "Invitó a alguien nuevo",
    "Aprobó una requisición",
    "Rechazó una requisición",
  ].map(normalizarAccion)
);

function validarTexto(valor: unknown, maxLargo: number, requerido = false): string | true {
  if (typeof valor !== "string") return "Ese campo no es válido.";
  if (requerido && valor.trim().length === 0) return "Ese campo no puede quedar vacío.";
  if (valor.length > maxLargo) return `Ese campo no puede tener más de ${maxLargo} caracteres.`;
  return true;
}

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formato de UUID, nada más — no si existe ni si hay permiso sobre
 * él (eso lo decide la consulta/política que lo use después). Sin
 * esto, un id mal formado llega tal cual a PostgreSQL y sale como un
 * error de "invalid input syntax for type uuid" (500 genérico) en vez
 * de un 400 claro. */
function validarUuid(valor: unknown, requerido = false): string | true {
  if (valor === undefined) return requerido ? "Falta un identificador." : true;
  if (typeof valor !== "string" || !REGEX_UUID.test(valor)) return "Ese identificador no es válido.";
  return true;
}

function validarImagenDataUrl(valor: unknown): string | true {
  if (typeof valor !== "string") return "Esa imagen no es válida.";
  if (!valor.startsWith("data:image/")) return "El archivo debe ser una imagen.";
  if (valor.length > LARGO_MAX_IMAGEN_DATAURL) return "La imagen es demasiado grande — usa una más chica.";
  return true;
}

const MONTO_MAXIMO = 99_999_999.99; // el límite real de numeric(10,2) en el esquema

function validarMonto(valor: unknown): string | true {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return "Ese monto no es válido.";
  if (valor < 0) return "Ese monto no puede ser negativo.";
  if (valor > MONTO_MAXIMO) return "Ese monto es demasiado grande.";
  return true;
}

function falla(res: Response, status: number, mensaje: string, error?: unknown) {
  if (error) registro.error(mensaje, error);
  res.status(status).json({ error: mensaje });
}

// ---------- Mapeos fila (snake_case, Postgres) -> objeto (camelCase, app) ----------
function aOrganizacion(r: any) {
  return { id: r.id, nombre: r.nombre, colorPrimario: r.color_primario, logoUrl: r.logo_url ?? undefined };
}
function aServicio(r: any) {
  return {
    id: r.id,
    orgId: r.org_id,
    nombre: r.nombre,
    icono: r.icono,
    campoPersonaLabel: r.campo_persona_label,
    campoIdLabel: r.campo_id_label,
    campoCategoriaLabel: r.campo_categoria_label,
    cierreCajaLabel: r.cierre_caja_label,
    features: r.features,
    activo: r.activo,
  };
}
function aCategoria(r: any) {
  return { id: r.id, servicioId: r.service_id, nombre: r.nombre };
}
function aProcedimiento(r: any) {
  return { id: r.id, servicioId: r.service_id, nombre: r.nombre, precio: Number(r.precio) };
}
function aTicket(r: any) {
  return {
    id: r.id,
    servicioId: r.service_id,
    folio: r.folio,
    nombre: r.nombre,
    identificador: r.identificador ?? undefined,
    tipoUsuario: r.tipo_usuario,
    categoria: r.categoria,
    procedimientos: r.procedimientos ?? [],
    total: Number(r.total),
    estado: r.estado,
    formaPago: r.forma_pago ?? undefined,
    creadoPor: r.creado_por,
    fecha: r.fecha,
    fechaPago: r.fecha_pago ?? undefined,
  };
}
function aRequisicion(r: any) {
  return {
    id: r.id,
    servicioId: r.service_id,
    folio: r.folio,
    concepto: r.concepto,
    cantidad: r.cantidad,
    notas: r.notas ?? undefined,
    estado: r.estado,
    solicitadoPor: r.solicitado_por,
    solicitanteNombre: r.solicitante_nombre ?? undefined,
    aprobadoPor: r.aprobado_por ?? undefined,
    aprobadorNombre: r.aprobador_nombre ?? undefined,
    firmaResolucion: r.firma_resolucion ?? undefined,
    motivoRechazo: r.motivo_rechazo ?? undefined,
    creadoEn: r.creado_en,
    resueltoEn: r.resuelto_en ?? undefined,
  };
}
function aInvitacion(r: any) {
  return {
    id: r.id,
    correo: r.correo,
    orgId: r.org_id,
    rol: r.rol,
    servicioIds: r.servicio_ids ?? [],
    creadaPor: r.creada_por,
    creadaEn: r.creada_en,
  };
}
function aEvento(r: any) {
  return { id: r.id, orgId: r.org_id, actorId: r.actor_id, actorNombre: r.actor_nombre, accion: r.accion, detalle: r.detalle, fecha: r.fecha };
}
function aArchivo(r: any) {
  return {
    id: r.id,
    orgId: r.org_id,
    deId: r.de_id,
    paraId: r.para_id,
    servicioId: r.service_id ?? undefined,
    servicioNombre: r.servicio_nombre ?? undefined,
    tipo: r.tipo,
    nombreArchivo: r.nombre_archivo,
    contenido: r.contenido,
    mensaje: r.mensaje ?? undefined,
    fecha: r.fecha,
    leido: r.leido,
  };
}

// Inserta un evento de bitácora dentro de la MISMA transacción que la
// acción real que describe — nunca como una petición aparte que el
// navegador manda después. actor_id sale de usuario_actual() (la
// sesión, vía la variable que conSesionDe ya puso para esta
// transacción), nunca de un parámetro que alguien pudiera falsear; la
// política de INSERT de eventos_auditoria (ver esquema_local.sql)
// exige exactamente eso también, como defensa en profundidad. Antes,
// crear/eliminar un servicio, cambiar la marca, o agregar/quitar a
// alguien de una organización o un servicio dependían de que el
// navegador mandara, aparte, un segundo POST a /eventos después de
// que la acción real ya hubiera tenido éxito — una falla de red justo
// ahí dejaba la acción aplicada sin ningún rastro.
async function registrarEventoAtomico(cliente: any, orgId: string, accion: string, detalle: string) {
  await cliente.query(
    `insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
     select $1, usuario_actual(), coalesce(nombre, correo), $2, $3
     from profiles where id = usuario_actual()`,
    [orgId, accion, detalle]
  );
}

async function construirUsuarios(cliente: any, filas: any[]) {
  const ids = filas.map((f) => f.id);
  if (ids.length === 0) return [];
  const [{ rows: miembros }, { rows: accesos }] = await Promise.all([
    cliente.query("select org_id, user_id from org_members where user_id = any($1)", [ids]),
    cliente.query("select service_id, user_id, solo_consulta from service_access where user_id = any($1)", [ids]),
  ]);
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    correo: f.correo,
    telefono: f.telefono ?? undefined,
    fotoUrl: f.foto_url ?? undefined,
    firmaUrl: f.firma_url ?? undefined,
    bio: f.bio ?? undefined,
    rol: f.rol,
    orgIds: miembros.filter((m: any) => m.user_id === f.id).map((m: any) => m.org_id),
    servicioIds: accesos.filter((a: any) => a.user_id === f.id).map((a: any) => a.service_id),
    serviciosSoloConsulta: accesos.filter((a: any) => a.user_id === f.id && a.solo_consulta).map((a: any) => a.service_id),
    creadoEn: f.creado_en,
    totpHabilitado: f.totp_habilitado ?? false,
    debeCambiarPassword: f.debe_cambiar_password ?? false,
    // Nunca se expone password_hash en sí — solo si coincide con el
    // marcador que usa registrar_usuario_via_microsoft() (ver
    // microsoft.ts) para cuentas sin contraseña propia. El frontend lo
    // usa para decidir si pedir contraseña o reautenticación con
    // Microsoft al iniciar la configuración de 2FA (ver Profile.tsx).
    soloMicrosoft: f.password_hash === MARCADOR_SIN_PASSWORD_PROPIA,
  }));
}

async function obtenerUsuario(cliente: any, id: string) {
  const { rows } = await cliente.query("select * from profiles where id = $1", [id]);
  if (rows.length === 0) return null;
  const [completo] = await construirUsuarios(cliente, rows);
  return completo;
}

// ================================================================
// Auth
// ================================================================
rutas.post("/auth/registrar", async (req, res) => {
  const { nombre, correo, password, trampa, token } = req.body ?? {};
  // "trampa" es un campo invisible en el formulario — nadie real lo
  // llena nunca, solo un bot que autocompleta todo. Si viene algo,
  // se responde exactamente el mismo error que "correo no válido" en
  // vez de delatar que hay un honeypot.
  if (typeof trampa === "string" && trampa.length > 0) return falla(res, 400, "Ese correo no es válido.");
  if (!nombre || !correo || !password) return falla(res, 400, "Faltan datos.");
  const errorCredenciales = validarCredenciales(correo, password);
  if (errorCredenciales) return falla(res, 400, errorCredenciales);
  const errorNombre = validarTexto(nombre, LARGO_MAX_NOMBRE, true);
  if (errorNombre !== true) return falla(res, 400, errorNombre);
  // El código de invitación se exige aquí también (no solo dentro de
  // registrar_usuario()) para poder distinguir "faltó el campo" de
  // "el código no coincide" con mensajes distintos y útiles.
  if (typeof token !== "string" || token.length === 0) {
    return falla(res, 400, "Falta el código de invitación que te dio tu administrador.");
  }
  try {
    const hash = await hashPassword(password);
    // Sin sesión todavía (la cuenta ni existe) — registrar_usuario()
    // corre con privilegios propios (SECURITY DEFINER) precisamente
    // para este caso: valida la invitación y el código, y crea todo en
    // un solo paso atómico, sin que el rol de la aplicación necesite
    // permiso directo de escritura en profiles/org_members/invitaciones.
    const { rows } = await pool.query("select * from registrar_usuario($1, $2, $3, $4)", [nombre, correo, hash, token]);
    const usuarioId = rows[0].id;
    const perfil = await conSesionDe(usuarioId, (c) => obtenerUsuario(c, usuarioId));
    ponerCookieSesion(res, firmarSesion(usuarioId));
    res.json({ perfil });

    // Fuera del try/catch de arriba a propósito — la respuesta ya se
    // mandó, así que nada de aquí debe poder intentar mandar una
    // segunda (eso tronaría con "headers already sent"). No hace
    // sentido que crear la cuenta espere a que salga un correo, y si
    // el envío no está configurado esto no hace nada (ver correo.ts).
    try {
      if (correoConfigurado) {
        const token = firmarTokenAccion("confirmar_correo", usuarioId, {}, "2d");
        const link = `${FRONTEND_URL}/confirmar-correo?token=${token}`;
        mandarCorreo(
          correo.trim(),
          "Confirma tu correo — Finaquick",
          `<p>Hola ${escaparHtml(nombre)},</p><p>Confirma tu correo para Finaquick dando clic aquí (válido 2 días):</p><p><a href="${link}">${link}</a></p>`
        ).catch(() => {});
      }
    } catch {
      // No hace nada más que lo de arriba — un correo de confirmación
      // que no sale no debe afectar el registro, que ya se completó.
    }
  } catch (error: any) {
    // Sin invitación no es un error del servidor — pasa todos los
    // días, alguien intenta entrar sin que un admin lo haya invitado
    // todavía. Registrarlo como ERROR en el log ensuciaría justo lo
    // que ese log sirve para encontrar: errores reales e inesperados.
    if (error?.message?.includes("invitarte")) {
      return falla(res, 403, "Tu administrador debe invitarte primero desde Configuración → Usuarios.");
    }
    // Tampoco es un error del servidor — pasa si alguien escribe mal el
    // código, o intenta adivinarlo.
    if (error?.message?.includes("código de invitación")) {
      return falla(res, 403, "Ese código de invitación no es correcto.");
    }
    // Código 23505 de PostgreSQL: violación de la restricción "unique"
    // en profiles.correo — pasa si dos personas mandan el registro con
    // el mismo correo casi al mismo instante (probado a propósito
    // disparando dos registros simultáneos de verdad): la cuenta
    // queda creada una sola vez, correcta, pero a quien "pierde" la
    // carrera no le toca un error de servidor genérico, le toca este
    // mensaje claro.
    if (error?.code === "23505") {
      return falla(res, 400, "Ya existe una cuenta con ese correo — si crees que fuiste tú, intenta iniciar sesión.");
    }
    falla(res, 500, "No se pudo crear la cuenta.", error);
  }
});

rutas.post("/auth/login", async (req, res) => {
  const { correo, password, trampa } = req.body ?? {};
  // Mismo honeypot que en registrar — mismo mensaje que credenciales
  // incorrectas, para no delatarlo.
  if (typeof trampa === "string" && trampa.length > 0) return falla(res, 401, "Contraseña incorrecta o la cuenta no existe.");
  if (!correo || !password) return falla(res, 400, "Faltan datos.");
  try {
    // Igual que el registro: sin sesión todavía, así que se usa la
    // función que expone solo id + password_hash + bloqueo (nunca el
    // resto del perfil) en vez de una consulta directa que RLS
    // bloquearía entera.
    const { rows } = await pool.query("select * from obtener_credenciales_login($1)", [correo]);
    if (rows.length === 0) return falla(res, 401, "Contraseña incorrecta o la cuenta no existe.");

    if (rows[0].bloqueado_hasta && new Date(rows[0].bloqueado_hasta) > new Date()) {
      return falla(res, 429, "Cuenta bloqueada temporalmente por varios intentos fallidos — espera unos minutos y vuelve a intentar.");
    }

    const ok = await verificarPassword(password, rows[0].password_hash);
    if (!ok) {
      // No se espera la respuesta — que el registro del intento fallido
      // sea lento no debe hacer más lento el "contraseña incorrecta".
      pool.query("select registrar_intento_fallido($1)", [correo]).catch(() => {});
      return falla(res, 401, "Contraseña incorrecta o la cuenta no existe.");
    }

    // Con 2FA activo, la contraseña correcta NO basta todavía — se
    // manda un token de un solo propósito, de vida corta, en vez de la
    // cookie de sesión real. La cookie de verdad solo se pone después
    // de verificar el código en /auth/login/2fa — y el contador de
    // intentos fallidos también se resetea allá, no aquí: si se
    // reseteara ya con solo la contraseña correcta, alguien que ya
    // sabe la contraseña podría volver a pedir un login cada vez que
    // estuviera por bloquearse por códigos incorrectos, reiniciando su
    // propio contador indefinidamente y sin llegar nunca al bloqueo.
    if (rows[0].totp_habilitado) {
      // emitidoEnMs, igual que la cookie de sesión completa — para que
      // el segundo paso pueda rechazar este token si la contraseña
      // cambia antes de que se complete (ver /auth/login/2fa).
      const tokenPre = firmarTokenAccion("login_2fa", rows[0].id, { emitidoEnMs: Date.now() }, "5m");
      return res.json({ requiere2FA: true, tokenPre });
    }

    await pool.query("select registrar_login_exitoso($1)", [correo]);
    const perfil = await conSesionDe(rows[0].id, (c) => obtenerUsuario(c, rows[0].id));
    ponerCookieSesion(res, firmarSesion(rows[0].id));
    res.json({ perfil });
  } catch (error) {
    falla(res, 500, "No se pudo iniciar sesión.", error);
  }
});

rutas.post("/auth/login/2fa", async (req, res) => {
  const { tokenPre, codigo } = req.body ?? {};
  const payload = typeof tokenPre === "string" ? verificarTokenAccion(tokenPre, "login_2fa") : null;
  if (!payload) return falla(res, 400, "Esta solicitud ya venció — vuelve a iniciar sesión desde el principio.");
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo)) return falla(res, 400, "Ese código no es válido.");
  try {
    // El mismo mensaje sea cual sea el motivo del rechazo (código
    // incorrecto, cuenta sin 2FA por alguna razón, lo que sea) — no hay
    // nada útil que revelar de más en este paso.
    const { rows } = await pool.query("select * from obtener_credenciales_login_por_id($1)", [payload.sub]);
    if (rows.length === 0 || !rows[0].totp_habilitado || !rows[0].totp_secret) {
      return falla(res, 401, "Código incorrecto.");
    }
    // Un tokenPre emitido ANTES de que la contraseña cambiara no debe
    // poder completar el login, así su firma y su código sigan siendo
    // válidos — mismo criterio que ya aplica a la cookie de sesión
    // completa (ver requerirSesion en auth.ts), aplicado aquí también.
    const validaDesde = rows[0].sesion_valida_desde ? new Date(rows[0].sesion_valida_desde).getTime() : 0;
    if (typeof payload.emitidoEnMs !== "number" || payload.emitidoEnMs < validaDesde) {
      return falla(res, 400, "Esta solicitud ya venció — vuelve a iniciar sesión desde el principio.");
    }
    // Mismo bloqueo por cuenta que la contraseña: sin esto, alguien con
    // un tokenPre válido podía seguir probando códigos de 6 dígitos sin
    // límite real repartiendo los intentos entre varias direcciones IP
    // — el límite de tasa del servidor es por IP, esto no lo es.
    if (rows[0].bloqueado_hasta && new Date(rows[0].bloqueado_hasta) > new Date()) {
      return falla(res, 429, "Cuenta bloqueada temporalmente por varios códigos incorrectos — espera unos minutos y vuelve a intentar.");
    }
    const { valid: valido } = await verificarTotp({ secret: descifrarTotp(rows[0].totp_secret), token: codigo });
    if (!valido) {
      pool.query("select registrar_intento_fallido_por_id($1)", [payload.sub]).catch(() => {});
      return falla(res, 401, "Código incorrecto.");
    }
    await pool.query("select registrar_login_exitoso_por_id($1)", [payload.sub]);

    const perfil = await conSesionDe(payload.sub, (c) => obtenerUsuario(c, payload.sub));
    ponerCookieSesion(res, firmarSesion(payload.sub));
    res.json({ perfil });
  } catch (error) {
    falla(res, 500, "No se pudo iniciar sesión.", error);
  }
});

rutas.get("/auth/sesion", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const perfil = await conSesionDe(req.usuarioId!, (c) => obtenerUsuario(c, req.usuarioId!));
    res.json({ perfil });
  } catch (error) {
    falla(res, 500, "No se pudo leer tu sesión.", error);
  }
});

rutas.post("/auth/logout", (_req, res) => {
  // La cookie es httpOnly a propósito — el navegador no puede borrarla
  // por su cuenta desde JS, tiene que pedírselo al servidor.
  limpiarCookieSesion(res);
  res.json({ ok: true });
});

// Estas tres rutas son opcionales — solo hacen algo de verdad si el
// envío de correo está configurado (ver correo.ts). Sin eso, el
// registro y el login normales funcionan exactamente igual.
rutas.get("/auth/confirmar-correo", async (req, res) => {
  const token = req.query.token;
  if (typeof token !== "string") return falla(res, 400, "Enlace inválido.");
  const payload = verificarTokenAccion(token, "confirmar_correo");
  if (!payload) return falla(res, 400, "Este enlace no es válido o ya venció.");
  try {
    await pool.query("select confirmar_correo($1)", [payload.sub]);
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo confirmar el correo.", error);
  }
});

rutas.post("/auth/olvide-password", async (req, res) => {
  const correo = String(req.body?.correo ?? "").trim();
  if (!correoConfigurado) {
    return falla(
      res,
      400,
      "Esta instalación no tiene correo configurado — pide a tu administrador que te restablezca la contraseña desde Configuración → Usuarios."
    );
  }
  if (!REGEX_CORREO.test(correo)) return falla(res, 400, "Ese correo no es válido.");
  try {
    const { rows } = await pool.query("select id, password_hash from obtener_credenciales_login($1)", [correo]);
    if (rows.length > 0) {
      const hashTermina = String(rows[0].password_hash).slice(-12);
      const token = firmarTokenAccion("restablecer_password", rows[0].id, { hashTermina }, "1h");
      const link = `${FRONTEND_URL}/restablecer-password?token=${token}`;
      mandarCorreo(
        correo,
        "Restablece tu contraseña — Finaquick",
        `<p>Para restablecer tu contraseña de Finaquick, da clic aquí (válido 1 hora):</p><p><a href="${link}">${link}</a></p><p>Si no pediste esto, ignora este correo — tu contraseña sigue igual.</p>`
      );
    }
    // Mismo mensaje exista o no esa cuenta — para no revelar qué
    // correos sí están registrados.
    res.json({ ok: true, mensaje: "Si ese correo existe, te llegará un enlace para restablecer tu contraseña." });
  } catch (error) {
    falla(res, 500, "No se pudo procesar la solicitud.", error);
  }
});

rutas.post("/auth/restablecer-password-con-token", async (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof password !== "string" || password.length < LARGO_MIN_PASSWORD) {
    return falla(res, 400, `La contraseña debe tener al menos ${LARGO_MIN_PASSWORD} caracteres.`);
  }
  const payload = typeof token === "string" ? verificarTokenAccion(token, "restablecer_password") : null;
  if (!payload) return falla(res, 400, "Este enlace no es válido o ya venció.");
  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query("select restablecer_password_via_token($1, $2, $3) as ok", [
      payload.sub,
      payload.hashTermina,
      hash,
    ]);
    if (!rows[0].ok) return falla(res, 400, "Este enlace ya se usó o ya no es válido — pide uno nuevo.");
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo restablecer la contraseña.", error);
  }
});

rutas.post("/auth/cambiar-password", requerirSesion, async (req: RequestConUsuario, res) => {
  const { actual, nueva } = req.body ?? {};
  if (typeof nueva !== "string" || nueva.length < LARGO_MIN_PASSWORD) {
    return falla(res, 400, `La contraseña nueva debe tener al menos ${LARGO_MIN_PASSWORD} caracteres.`);
  }
  try {
    await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select password_hash from profiles where id = $1", [req.usuarioId]);
      if (rows.length === 0 || !(await verificarPassword(actual, rows[0].password_hash))) {
        throw new Error("CONTRASENA_INCORRECTA");
      }
      const hash = await hashPassword(nueva);
      // sesion_valida_desde = now() invalida cualquier sesión existente
      // (la propia incluida) — por eso se firma y se pone una cookie
      // nueva justo después: sin esto, cambiar tu propia contraseña te
      // hubiera cerrado la sesión a TI también, en tu propio navegador,
      // de inmediato.
      await c.query(
        "update profiles set password_hash = $1, sesion_valida_desde = now(), debe_cambiar_password = false where id = $2",
        [hash, req.usuarioId]
      );
    });
    ponerCookieSesion(res, firmarSesion(req.usuarioId!));
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.message === "CONTRASENA_INCORRECTA") return falla(res, 400, "Tu contraseña actual no es correcta.");
    falla(res, 500, "No se pudo cambiar la contraseña.", error);
  }
});

// ================================================================
// Autenticación de dos factores (TOTP) — opcional, cada quien la
// activa para su propia cuenta. Todo el cálculo es local (otplib):
// nunca se llama a ningún servicio externo, ni para generar el
// secreto ni para verificar un código.
// ================================================================
rutas.post("/auth/2fa/iniciar", requerirSesion, async (req: RequestConUsuario, res) => {
  const { password, reauthToken } = req.body ?? {};
  // Una cuenta creada solo por Microsoft (ver MARCADOR_SIN_PASSWORD_
  // PROPIA) nunca tuvo una contraseña real que pedirle — exigírsela de
  // todos modos la dejaba sin poder activar 2FA nunca (bcrypt.compare
  // contra el marcador siempre da false). reauthToken es la
  // alternativa para esas cuentas: un token de un solo propósito y
  // vida corta que emite el callback de Microsoft cuando alguien ya
  // con sesión abierta se reautentica ahí mismo (ver microsoft.ts,
  // ?intent=2fa) — la reautenticación real la hizo Microsoft, no una
  // contraseña que esta cuenta nunca tuvo.
  if (typeof password !== "string" && typeof reauthToken !== "string") {
    return falla(res, 400, "Falta la contraseña, o reautenticarte con Microsoft.");
  }
  try {
    const secreto = generateSecret();
    const { correo } = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select correo, password_hash from profiles where id = $1", [req.usuarioId]);
      if (rows.length === 0) throw new Error("CONTRASENA_INCORRECTA");
      if (typeof reauthToken === "string") {
        if (rows[0].password_hash !== MARCADOR_SIN_PASSWORD_PROPIA) {
          // Una cuenta que SÍ tiene contraseña propia no puede saltarse
          // ese chequeo mandando un reauthToken en vez de la
          // contraseña — el token solo tiene sentido, y solo se acepta,
          // para cuentas que de verdad no tienen otra forma de probar
          // quién son.
          throw new Error("REAUTENTICACION_INVALIDA");
        }
        const payload = verificarTokenAccion(reauthToken, "2fa_reautenticado_microsoft");
        if (!payload || payload.sub !== req.usuarioId) throw new Error("REAUTENTICACION_INVALIDA");
      } else if (!(await verificarPassword(password, rows[0].password_hash))) {
        throw new Error("CONTRASENA_INCORRECTA");
      }
      // A un campo pendiente aparte, NUNCA directo a totp_secret — si
      // 2FA ya estaba activo, el secreto que de verdad se usa para
      // verificar el login (totp_secret) debe seguir siendo el
      // anterior hasta que este nuevo se confirme con un código real;
      // si no, una sesión con acceso momentáneo a la cuenta podía
      // reemplazar el secreto activo de golpe, sin que su dueño real
      // hiciera nada. Cifrado antes de guardarse — nunca en texto
      // plano en la base de datos. También exige la contraseña actual
      // (igual que desactivarlo) para que ni siquiera iniciar un
      // reemplazo sea posible con solo una sesión abierta.
      await c.query("update profiles set totp_secret_pendiente = $1 where id = $2", [cifrarTotp(secreto), req.usuarioId]);
      return rows[0];
    });
    const uri = generateURI({ issuer: "Finaquick", label: correo, secret: secreto });
    const qr = await QRCode.toDataURL(uri);
    res.json({ secretoManual: secreto, qr });
  } catch (error: any) {
    if (error?.message === "CONTRASENA_INCORRECTA") return falla(res, 400, "Tu contraseña no es correcta.");
    if (error?.message === "REAUTENTICACION_INVALIDA") {
      return falla(res, 400, "Esa reautenticación con Microsoft no es válida o ya venció — inténtalo de nuevo.");
    }
    falla(res, 500, "No se pudo iniciar la configuración de dos factores.", error);
  }
});

rutas.post("/auth/2fa/confirmar", requerirSesion, async (req: RequestConUsuario, res) => {
  const codigo = req.body?.codigo;
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo)) return falla(res, 400, "Ese código no es válido.");
  try {
    await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select totp_secret_pendiente from profiles where id = $1", [req.usuarioId]);
      const secretoPendiente = rows[0]?.totp_secret_pendiente;
      if (!secretoPendiente) throw new Error("SIN_SECRETO_PENDIENTE");
      const { valid } = await verificarTotp({ secret: descifrarTotp(secretoPendiente), token: codigo });
      if (!valid) throw new Error("CODIGO_INCORRECTO");
      // El secreto pendiente pasa a ser el activo solo ahora, con un
      // código real ya verificado — nunca antes. sesion_valida_desde =
      // now() invalida cualquier otra sesión que ya existiera antes de
      // este cambio (activar 2FA por primera vez, o reemplazar un
      // secreto ya activo) — sin esto, una sesión ya copiada (de un
      // dispositivo perdido, por ejemplo) seguía siendo válida después,
      // igual que ya pasaba al cambiar la contraseña.
      //
      // "and totp_secret_pendiente = $2" (comparando contra el MISMO
      // valor que se acaba de verificar arriba, no releyendo la
      // columna) es lo que evita una carrera real: si entre el select
      // de arriba y este update otra petición de /auth/2fa/iniciar (con
      // la contraseña correcta) alcanza a sustituir el secreto
      // pendiente por uno nuevo, un UPDATE que solo dijera "set
      // totp_secret = totp_secret_pendiente" activaría ESE secreto
      // nuevo, nunca verificado, en vez del que en verdad se acaba de
      // confirmar. Con esta condición, esa segunda petición hace que
      // esto afecte 0 filas y se rechace, en vez de activar un secreto
      // equivocado.
      const { rowCount } = await c.query(
        `update profiles
         set totp_secret = $2, totp_secret_pendiente = null,
             totp_habilitado = true, sesion_valida_desde = now()
         where id = $1 and totp_secret_pendiente = $2`,
        [req.usuarioId, secretoPendiente]
      );
      if (rowCount === 0) throw new Error("SECRETO_PENDIENTE_CAMBIO");
    });
    ponerCookieSesion(res, firmarSesion(req.usuarioId!));
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.message === "SIN_SECRETO_PENDIENTE") return falla(res, 400, "Primero pide un código QR nuevo — no hay ninguna configuración pendiente.");
    if (error?.message === "CODIGO_INCORRECTO") return falla(res, 400, "Ese código no es correcto — revisa la hora de tu teléfono e intenta con el siguiente código.");
    if (error?.message === "SECRETO_PENDIENTE_CAMBIO") {
      return falla(res, 409, "La configuración de dos factores cambió mientras confirmabas este código — pide un código QR nuevo e intenta de nuevo.");
    }
    falla(res, 500, "No se pudo activar la autenticación de dos factores.", error);
  }
});

rutas.post("/auth/2fa/desactivar", requerirSesion, async (req: RequestConUsuario, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== "string") return falla(res, 400, "Falta la contraseña.");
  try {
    await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select password_hash from profiles where id = $1", [req.usuarioId]);
      if (rows.length === 0 || !(await verificarPassword(password, rows[0].password_hash))) {
        throw new Error("CONTRASENA_INCORRECTA");
      }
      // Mismo candado que al activarlo: desactivar 2FA también invalida
      // cualquier otra sesión existente, para que no quede una sesión
      // vieja con el nivel de acceso de "antes" dando vueltas. Limpia
      // también un secreto pendiente sin confirmar, si lo había —
      // desactivar de plano no debería dejar ese reemplazo a medias
      // esperando un código que ya nadie va a mandar.
      await c.query(
        `update profiles
         set totp_habilitado = false, totp_secret = null, totp_secret_pendiente = null, sesion_valida_desde = now()
         where id = $1`,
        [req.usuarioId]
      );
    });
    ponerCookieSesion(res, firmarSesion(req.usuarioId!));
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.message === "CONTRASENA_INCORRECTA") return falla(res, 400, "Tu contraseña no es correcta.");
    falla(res, 500, "No se pudo desactivar la autenticación de dos factores.", error);
  }
});

// ================================================================
// Usuarios
// ================================================================
rutas.get("/usuarios", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const usuarios = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from profiles");
      return construirUsuarios(c, rows);
    });
    res.json(usuarios);
  } catch (error) {
    falla(res, 500, "No se pudieron leer los usuarios.", error);
  }
});

rutas.patch("/usuarios/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  const { id } = req.params;
  const cambios = req.body ?? {};

  for (const [campo, validar] of [
    ["nombre", () => validarTexto(cambios.nombre, LARGO_MAX_NOMBRE, true)],
    ["telefono", () => validarTexto(cambios.telefono, LARGO_MAX_TEXTO_CORTO)],
    ["bio", () => validarTexto(cambios.bio, LARGO_MAX_BIO)],
    ["fotoUrl", () => validarImagenDataUrl(cambios.fotoUrl)],
    ["firmaUrl", () => validarImagenDataUrl(cambios.firmaUrl)],
  ] as const) {
    if (cambios[campo] === undefined) continue;
    const resultado = validar();
    if (resultado !== true) return falla(res, 400, resultado);
  }

  try {
    await conSesionDe(req.usuarioId!, async (c) => {
      const columnas: string[] = [];
      const valores: any[] = [];
      let i = 1;
      for (const [campo, columna] of [["nombre", "nombre"], ["telefono", "telefono"], ["fotoUrl", "foto_url"], ["bio", "bio"], ["firmaUrl", "firma_url"]] as const) {
        if (cambios[campo] !== undefined) {
          columnas.push(`${columna} = $${i++}`);
          valores.push(cambios[campo]);
        }
      }
      // RLS ("cada quien edita su propio perfil": id = usuario_actual()
      // o eres admin) filtra el UPDATE a 0 filas en vez de lanzar un
      // error cuando quien llama no tiene permiso sobre ESTE id — sin
      // este chequeo, alguien editando el perfil de otra persona sin
      // permiso recibía 200 "éxito" con el perfil de la otra persona
      // sin cambiar, en vez de un error. Mismo criterio que ya se usa
      // en las rutas de eliminar de este archivo.
      if (columnas.length > 0) {
        valores.push(id);
        const { rowCount } = await c.query(`update profiles set ${columnas.join(", ")} where id = $${i}`, valores);
        if (rowCount === 0) throw new Error("SIN_PERMISO");
      }
      // Nombre de la cuenta afectada, para describir los eventos de
      // abajo ("a quién" se le agregó/quitó qué) — se lee una sola vez,
      // solo si de verdad hace falta.
      let nombreAfectado: string | undefined;
      if (cambios.orgIds !== undefined || cambios.servicioIds !== undefined || cambios.serviciosSoloConsulta !== undefined) {
        const { rows } = await c.query("select nombre from profiles where id = $1", [id]);
        nombreAfectado = rows[0]?.nombre ?? id;
      }
      if (cambios.orgIds !== undefined) {
        const { rows: actuales } = await c.query("select org_id from org_members where user_id = $1", [id]);
        const actualesIds = new Set(actuales.map((r: any) => r.org_id));
        const nuevosIds = new Set(cambios.orgIds as string[]);
        for (const orgId of actualesIds) {
          if (nuevosIds.has(orgId)) continue;
          const { rowCount } = await c.query("delete from org_members where user_id = $1 and org_id = $2", [id, orgId]);
          if (rowCount === 0) throw new Error("SIN_PERMISO");
          // puede_acceder_servicio() ya exige membresía vigente a la
          // organización dueña del servicio (ver esquema_local.sql), así
          // que quitar la organización basta para cortar el acceso real
          // — esto de aquí es solo para que servicioIds del perfil deje
          // de mostrar, en la interfaz, accesos que ya no sirven para
          // nada, y no queden filas huérfanas de service_access dando
          // vueltas si esa organización se borra y luego se vuelve a
          // crear con el mismo servicio reutilizando otro UUID... lo
          // cual no pasa, pero de cualquier forma es basura que ya no
          // debería estar ahí.
          await c.query(
            "delete from service_access where user_id = $1 and service_id in (select id from services where org_id = $2)",
            [id, orgId]
          );
          await registrarEventoAtomico(c, orgId, "Quitó a alguien de la organización", nombreAfectado!);
        }
        for (const orgId of nuevosIds) {
          if (actualesIds.has(orgId)) continue;
          await c.query("insert into org_members (org_id, user_id) values ($1, $2)", [orgId, id]);
          await registrarEventoAtomico(c, orgId, "Agregó a alguien a la organización", nombreAfectado!);
        }
      }
      if (cambios.servicioIds !== undefined) {
        const { rows: actuales } = await c.query("select service_id from service_access where user_id = $1", [id]);
        const actualesIds = new Set(actuales.map((r: any) => r.service_id));
        const nuevosIds = new Set(cambios.servicioIds as string[]);
        const soloSet = new Set((cambios.serviciosSoloConsulta as string[]) ?? []);
        for (const servicioId of actualesIds) {
          if (nuevosIds.has(servicioId)) continue;
          // El nombre y el org_id del servicio, ANTES de que
          // service_access se borre — para describir el evento con el
          // nombre del servicio (no solo su UUID) y saber en qué
          // organización se debe registrar.
          const { rows: servicioFila } = await c.query("select nombre, org_id from services where id = $1", [servicioId]);
          const { rowCount } = await c.query("delete from service_access where user_id = $1 and service_id = $2", [id, servicioId]);
          if (rowCount === 0) throw new Error("SIN_PERMISO");
          if (servicioFila[0]) {
            await registrarEventoAtomico(c, servicioFila[0].org_id, "Le quitó un servicio a alguien", `${nombreAfectado} · ${servicioFila[0].nombre}`);
          }
        }
        for (const servicioId of nuevosIds) {
          if (actualesIds.has(servicioId)) continue;
          await c.query("insert into service_access (service_id, user_id, solo_consulta) values ($1, $2, $3)", [servicioId, id, soloSet.has(servicioId)]);
          const { rows: servicioFila } = await c.query("select nombre, org_id from services where id = $1", [servicioId]);
          if (servicioFila[0]) {
            await registrarEventoAtomico(c, servicioFila[0].org_id, "Le asignó un servicio a alguien", `${nombreAfectado} · ${servicioFila[0].nombre}`);
          }
        }
      }
      if (cambios.serviciosSoloConsulta !== undefined) {
        const soloSet = new Set(cambios.serviciosSoloConsulta as string[]);
        const { rows: actuales } = await c.query("select service_id, solo_consulta from service_access where user_id = $1", [id]);
        for (const row of actuales) {
          const nuevoValor = soloSet.has(row.service_id);
          // Solo se registra si de verdad cambió — esta misma petición
          // también llega, sin cambiar nada aquí, cuando lo que en
          // realidad se tocó fue otra cosa (agregar/quitar un servicio
          // completo, arriba), y ese caso ya deja su propio evento.
          if (row.solo_consulta === nuevoValor) continue;
          const { rowCount } = await c.query("update service_access set solo_consulta = $1 where user_id = $2 and service_id = $3", [nuevoValor, id, row.service_id]);
          if (rowCount === 0) throw new Error("SIN_PERMISO");
          const { rows: servicioFila } = await c.query("select nombre, org_id from services where id = $1", [row.service_id]);
          if (servicioFila[0]) {
            await registrarEventoAtomico(
              c,
              servicioFila[0].org_id,
              "Cambió el nivel de acceso de alguien",
              `${nombreAfectado} · ${servicioFila[0].nombre} → ${nuevoValor ? "solo consulta" : "puede operar"}`
            );
          }
        }
      }
    });
    const actualizado = await conSesionDe(req.usuarioId!, (c) => obtenerUsuario(c, id));
    res.json(actualizado);
  } catch (error: any) {
    if (error?.message === "SIN_PERMISO") return falla(res, 404, "Ese usuario no existe, o no tienes permiso para editarlo.");
    falla(res, 500, "No se pudo actualizar el perfil.", error);
  }
});

rutas.post("/usuarios/:id/rol", requerirSesion, async (req: RequestConUsuario, res) => {
  if (!["admin", "finanzas", "personal"].includes(req.body?.rol)) return falla(res, 400, "Ese rol no es válido.");
  try {
    // El chequeo de "eres admin" vive dentro de cambiar_rol() —
    // profiles.rol no es una columna que este rol pueda tocar con un
    // UPDATE normal, a propósito (ver GRANT en el esquema).
    await conSesionDe(req.usuarioId!, (c) => c.query("select cambiar_rol($1, $2)", [req.params.id, req.body.rol]));
    res.json({ ok: true });
  } catch (error: any) {
    falla(res, 403, error.message ?? "No se pudo cambiar el rol.", error);
  }
});

rutas.post("/usuarios/:id/restablecer-password", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    // Genera una contraseña temporal aleatoria — nunca elegimos ni
    // recibimos la contraseña de nadie por chat/soporte.
    // restablecer_password() marca debe_cambiar_password = true; hasta
    // que la cambie, requerirSesion() (servidor/api/src/auth.ts) le
    // bloquea cualquier ruta que no sea cambiar la contraseña o cerrar
    // sesión — no es solo una convención de uso.
    const temporal = crypto.randomBytes(9).toString("base64url"); // ~12 caracteres, alta entropía
    const hash = await hashPassword(temporal);
    await conSesionDe(req.usuarioId!, (c) =>
      // El chequeo de "eres admin" vive dentro de restablecer_password().
      c.query("select restablecer_password($1, $2)", [req.params.id, hash])
    );
    // La contraseña temporal viaja en el cuerpo de esta respuesta, no
    // por otro canal — solo la ve el administrador que la pidió, en su
    // propia sesión. No queda registrada en ningún log del servidor
    // (esta ruta no pasa por ningún log de cuerpos de petición/
    // respuesta), pero si el transporte no es HTTPS, viaja en claro
    // igual que el resto de la sesión — ver "Consideraciones según el
    // entorno de despliegue" en SECURITY.md.
    res.json({ ok: true, passwordTemporal: temporal });
  } catch (error: any) {
    falla(res, 403, error.message ?? "No se pudo restablecer la contraseña.", error);
  }
});

// ================================================================
// Invitaciones
// ================================================================
rutas.post("/invitaciones", requerirSesion, async (req: RequestConUsuario, res) => {
  const { correo: correoCrudo, orgId, rol, servicioIds } = req.body ?? {};
  const correo = String(correoCrudo ?? "").trim();
  if (!REGEX_CORREO.test(correo)) return falla(res, 400, "Ese correo no es válido.");
  if (!["admin", "finanzas", "personal"].includes(rol)) return falla(res, 400, "Ese rol no es válido.");
  try {
    // El código de invitación (no el correo) es lo que de verdad
    // demuestra que quien se registra es a quien el administrador le
    // dio este código — solo coincidir el correo no probaba que la
    // persona controlara esa cuenta. Se genera aquí, nunca en el
    // cliente, y se regresa solo en esta respuesta (como la contraseña
    // temporal de restablecer-password): quien crea la invitación debe
    // copiarlo y dárselo a la persona invitada por el canal que elija
    // (en persona, por chat, por su propio correo institucional).
    const token = crypto.randomBytes(9).toString("base64url");
    const inv = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows: existente } = await c.query("select id from profiles where lower(correo) = $1", [correo.toLowerCase()]);
      if (existente.length > 0) throw new Error("CORREO_YA_EXISTE");
      await c.query("delete from invitaciones where lower(correo) = $1", [correo.toLowerCase()]);
      const { rows } = await c.query(
        "insert into invitaciones (correo, org_id, rol, servicio_ids, creada_por, token) values ($1,$2,$3,$4,$5,$6) returning *",
        [correo, orgId, rol, servicioIds ?? [], req.usuarioId, token]
      );
      await registrarEventoAtomico(c, orgId, "Invitó a alguien nuevo", `${correo} · ${rol}`);
      return rows[0];
    });
    res.json({ ...aInvitacion(inv), token });
  } catch (error: any) {
    if (error?.message === "CORREO_YA_EXISTE") return falla(res, 400, "Ya existe una cuenta con ese correo.");
    falla(res, 500, "No se pudo invitar.", error);
  }
});

rutas.get("/invitaciones", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from invitaciones where org_id = $1 order by creada_en desc", [req.query.orgId]);
      return rows;
    });
    res.json(filas.map(aInvitacion));
  } catch (error) {
    falla(res, 500, "No se pudieron leer las invitaciones.", error);
  }
});

rutas.delete("/invitaciones/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    // rowCount, no solo "no truena" — si RLS filtra la fila (sin permiso,
    // o el id ya no existe), el delete "tiene éxito" sin tocar nada, y
    // sin este chequeo se le habría dicho "ok" a alguien a quien en
    // realidad no se le canceló nada. Mismo criterio en las demás rutas
    // de eliminar de este archivo.
    const { rowCount } = await conSesionDe(req.usuarioId!, (c) => c.query("delete from invitaciones where id = $1", [req.params.id]));
    if (rowCount === 0) return falla(res, 404, "Esa invitación ya no existe, o no tienes permiso para cancelarla.");
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo cancelar la invitación.", error);
  }
});

// ================================================================
// Servicios y catálogo
// ================================================================
rutas.get("/servicios", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from services where org_id = $1 order by nombre", [req.query.orgId]);
      return rows;
    });
    res.json(filas.map(aServicio));
  } catch (error) {
    falla(res, 500, "No se pudieron leer los servicios.", error);
  }
});

rutas.patch("/servicios/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  const mapa: Record<string, string> = {
    nombre: "nombre", icono: "icono", campoPersonaLabel: "campo_persona_label", campoIdLabel: "campo_id_label",
    campoCategoriaLabel: "campo_categoria_label", cierreCajaLabel: "cierre_caja_label", features: "features", activo: "activo",
  };
  for (const campo of ["nombre", "campoPersonaLabel", "campoIdLabel", "campoCategoriaLabel", "cierreCajaLabel"] as const) {
    if (req.body[campo] === undefined) continue;
    const resultado = validarTexto(req.body[campo], LARGO_MAX_NOMBRE, campo === "nombre");
    if (resultado !== true) return falla(res, 400, resultado);
  }
  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      const columnas: string[] = [];
      const valores: any[] = [];
      let i = 1;
      for (const [campo, columna] of Object.entries(mapa)) {
        if (req.body[campo] !== undefined) {
          columnas.push(`${columna} = $${i++}`);
          valores.push(campo === "features" ? JSON.stringify(req.body[campo]) : req.body[campo]);
        }
      }
      valores.push(req.params.id);
      const { rows } = await c.query(`update services set ${columnas.join(", ")} where id = $${i} returning *`, valores);
      return rows[0];
    });
    // RLS filtra el UPDATE a 0 filas (sin lanzar error) cuando quien
    // llama no es admin de la organización dueña de este servicio —
    // sin este chequeo, eso se colaba hasta aOrganizacion/aServicio
    // intentando leer .id de "undefined" y tronaba con un 500 genérico
    // en vez de decir con claridad que era un problema de permisos.
    if (!fila) return falla(res, 404, "Ese servicio ya no existe, o no tienes permiso para editarlo.");
    res.json(aServicio(fila));
  } catch (error) {
    falla(res, 500, "No se pudo actualizar el servicio.", error);
  }
});

rutas.post("/servicios", requerirSesion, async (req: RequestConUsuario, res) => {
  const { nombre, icono, orgId } = req.body ?? {};
  const errorNombre = validarTexto(nombre, LARGO_MAX_NOMBRE, true);
  if (errorNombre !== true) return falla(res, 400, errorNombre);
  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query(
        `insert into services (org_id, nombre, icono, campo_persona_label, campo_id_label, campo_categoria_label, cierre_caja_label, features, activo)
         values ($1,$2,$3,'Nombre del cliente','ID','Categoría','Cierre de caja','{"creditos":true,"cierreCaja":true,"requisiciones":true,"requiereId":true,"esDerechoClinica":false}'::jsonb,true) returning *`,
        [orgId, nombre, icono]
      );
      await registrarEventoAtomico(c, orgId, "Creó el servicio", nombre);
      return rows[0];
    });
    res.json(aServicio(fila));
  } catch (error) {
    falla(res, 500, "No se pudo crear el servicio.", error);
  }
});

rutas.delete("/servicios/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const eliminado = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select count(*) from tickets where service_id = $1", [req.params.id]);
      if (Number(rows[0].count) > 0) throw new Error("Este servicio ya tiene folios registrados — desactívalo en vez de eliminarlo.");
      // Nombre y org_id ANTES de borrar — para el evento de la bitácora,
      // y porque una vez borrado el servicio ya no hay de dónde leerlos.
      const { rows: previo } = await c.query("select nombre, org_id from services where id = $1", [req.params.id]);
      const { rowCount } = await c.query("delete from services where id = $1", [req.params.id]);
      if (rowCount! > 0 && previo[0]) {
        await registrarEventoAtomico(c, previo[0].org_id, "Eliminó el servicio", previo[0].nombre);
      }
      return rowCount! > 0;
    });
    if (!eliminado) return falla(res, 404, "Ese servicio ya no existe, o no tienes permiso para eliminarlo.");
    res.json({ ok: true });
  } catch (error: any) {
    falla(res, 400, error.message ?? "No se pudo eliminar el servicio.", error);
  }
});

rutas.get("/categorias", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from categorias where service_id = $1 order by nombre", [req.query.servicioId]);
      return rows;
    });
    res.json(filas.map(aCategoria));
  } catch (error) {
    falla(res, 500, "No se pudieron leer las categorías.", error);
  }
});

rutas.post("/categorias", requerirSesion, async (req: RequestConUsuario, res) => {
  const { nombre, servicioId } = req.body ?? {};
  const errorNombre = validarTexto(nombre, LARGO_MAX_NOMBRE, true);
  if (errorNombre !== true) return falla(res, 400, errorNombre);
  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query(
        "insert into categorias (service_id, nombre) values ($1, $2) returning *",
        [servicioId, nombre]
      );
      return rows[0];
    });
    res.json(aCategoria(fila));
  } catch (error: any) {
    // Código 42501 de PostgreSQL: la política de seguridad a nivel de
    // fila rechazó el insert (el servicio no existe, o no pertenece a
    // una organización donde quien pidió esto es administrador) — sin
    // este catch, esto llegaba como un 500 genérico en vez de un
    // mensaje claro.
    if (error?.code === "42501") {
      return falla(res, 403, "Ese servicio no existe, o no tienes permiso para agregarle categorías.");
    }
    falla(res, 500, "No se pudo agregar la categoría.", error);
  }
});

rutas.delete("/categorias/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const { rowCount } = await conSesionDe(req.usuarioId!, (c) => c.query("delete from categorias where id = $1", [req.params.id]));
    if (rowCount === 0) return falla(res, 404, "Esa categoría ya no existe, o no tienes permiso para eliminarla.");
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo eliminar la categoría.", error);
  }
});

rutas.get("/procedimientos", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from procedimientos where service_id = $1 order by nombre", [req.query.servicioId]);
      return rows;
    });
    res.json(filas.map(aProcedimiento));
  } catch (error) {
    falla(res, 500, "No se pudieron leer los procedimientos.", error);
  }
});

rutas.put("/procedimientos", requerirSesion, async (req: RequestConUsuario, res) => {
  const { id, servicioId, nombre, precio } = req.body ?? {};
  const errorNombre = validarTexto(nombre, LARGO_MAX_NOMBRE, true);
  if (errorNombre !== true) return falla(res, 400, errorNombre);
  const errorPrecio = validarMonto(precio);
  if (errorPrecio !== true) return falla(res, 400, errorPrecio);
  try {
    await conSesionDe(req.usuarioId!, (c) =>
      c.query(
        `insert into procedimientos (id, service_id, nombre, precio) values (coalesce($1, gen_random_uuid()), $2, $3, $4)
         on conflict (id) do update set nombre = excluded.nombre, precio = excluded.precio`,
        [id?.startsWith("p_") ? null : id, servicioId, nombre, precio]
      )
    );
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo guardar el procedimiento.", error);
  }
});

rutas.delete("/procedimientos/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const { rowCount } = await conSesionDe(req.usuarioId!, (c) => c.query("delete from procedimientos where id = $1", [req.params.id]));
    if (rowCount === 0) return falla(res, 404, "Ese procedimiento ya no existe, o no tienes permiso para eliminarlo.");
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo eliminar el procedimiento.", error);
  }
});

// ================================================================
// Folios
// ================================================================
rutas.get("/tickets", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from tickets where service_id = $1 order by fecha desc", [req.query.servicioId]);
      return rows;
    });
    res.json(filas.map(aTicket));
  } catch (error) {
    falla(res, 500, "No se pudieron leer los folios.", error);
  }
});

rutas.get("/tickets/siguiente-numero", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const n = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query(
        "select count(*) from tickets where service_id = $1 and tipo_usuario = 'Externo'",
        [req.query.servicioId]
      );
      return Number(rows[0].count) + 1;
    });
    res.json({ numero: `PRY-${String(n).padStart(4, "0")}` });
  } catch (error) {
    falla(res, 500, "No se pudo calcular el número de proyecto.", error);
  }
});

// Comparación campo por campo, no JSON.stringify(a) === JSON.stringify(b)
// a secas — un valor guardado como jsonb no conserva el orden de sus
// llaves (a diferencia de json), así que comparar el texto serializado
// completo podía decir "distinto" para dos objetos con exactamente los
// mismos valores, solo por el orden en que Postgres los reacomodó al
// guardarlos. Los arreglos sí conservan su orden dentro de un jsonb —
// por eso procedimientoIds (ya ordenado antes de guardarse) sí se
// compara con JSON.stringify.
function mismoPayloadIdempotencia(a: any, b: any): boolean {
  if (!a || !b) return false;
  return (
    a.nombre === b.nombre &&
    (a.identificador ?? null) === (b.identificador ?? null) &&
    a.tipoUsuario === b.tipoUsuario &&
    a.categoria === b.categoria &&
    (a.estado ?? null) === (b.estado ?? null) &&
    (a.formaPago ?? null) === (b.formaPago ?? null) &&
    JSON.stringify(a.procedimientoIds ?? []) === JSON.stringify(b.procedimientoIds ?? [])
  );
}

rutas.post("/tickets", requerirSesion, async (req: RequestConUsuario, res) => {
  const t = req.body ?? {};
  for (const [_campo, resultado] of [
    ["nombre", validarTexto(t.nombre, LARGO_MAX_NOMBRE, true)],
    ["tipoUsuario", validarTexto(t.tipoUsuario, LARGO_MAX_NOMBRE, true)],
    ["categoria", validarTexto(t.categoria, LARGO_MAX_NOMBRE, true)],
    ["identificador", t.identificador !== undefined ? validarTexto(t.identificador, LARGO_MAX_TEXTO_CORTO) : true],
  ] as const) {
    if (resultado !== true) return falla(res, 400, resultado);
  }
  if (!["pagado", "credito"].includes(t.estado)) return falla(res, 400, "Ese estado de folio no es válido.");
  // Un folio "pagado" siempre debe traer una forma de pago reconocida
  // (ver FORMAS_PAGO_VALIDAS más arriba); si viene en un folio en
  // crédito también se valida por consistencia, aunque en ese caso no
  // es obligatoria (la real llega después, con POST /tickets/:id/pago).
  if (t.estado === "pagado" || t.formaPago !== undefined) {
    if (!FORMAS_PAGO_VALIDAS.includes(t.formaPago)) return falla(res, 400, "Esa forma de pago no es válida.");
  }
  // La columna es NOT NULL en la base de datos — sin esta validación,
  // un folio sin procedimientos (un cuerpo de petición incompleto, de
  // un cliente con un bug) tronaba con un 500 genérico ("No se pudo
  // generar el folio") en vez de decir con claridad qué faltaba.
  // Encontrado con `npm run carga` al armar los folios de prueba.
  // Ahora se manda como IDs, no como {nombre, costo} — ver el porqué
  // más abajo, junto al total.
  if (!Array.isArray(t.procedimientoIds) || !t.procedimientoIds.every((id: unknown) => typeof id === "string")) {
    return falla(res, 400, "Falta la lista de procedimientos (puede ir vacía, pero debe existir).");
  }
  // Opcional: un identificador que el navegador genera una sola vez
  // por intento de crear el folio (ver NewTicket.tsx) y reenvía tal
  // cual si reintenta después de perder la respuesta — ver el bloque
  // más abajo que la usa, y el comentario junto a la columna en
  // esquema_local.sql sobre qué problema real evita.
  if (t.idempotencyKey !== undefined) {
    const errorClave = validarTexto(t.idempotencyKey, LARGO_MAX_TEXTO_CORTO, true);
    if (errorClave !== true) return falla(res, 400, errorClave);
  }
  // Foto de esta petición tal como debe compararse contra un reintento
  // — ver el comentario junto a idempotencia_payload en
  // esquema_local.sql sobre por qué esto NUNCA se compara contra las
  // columnas en vivo del folio (estado/forma_pago pueden cambiar
  // después, por un pago normal, sin relación con si esta petición de
  // creación se reintentó). "Externo" no lleva identificador propio —
  // lo asigna el servidor, así que compararlo haría que hasta un
  // reintento idéntico se viera como contenido distinto.
  const payloadIdempotencia = {
    nombre: t.nombre,
    identificador: t.tipoUsuario === "Externo" ? null : (t.identificador ?? null),
    tipoUsuario: t.tipoUsuario,
    categoria: t.categoria,
    procedimientoIds: Array.isArray(t.procedimientoIds) ? [...t.procedimientoIds].sort() : [],
    estado: t.estado,
    formaPago: t.formaPago ?? null,
  };
  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      if (t.idempotencyKey) {
        const { rows: previos } = await c.query(
          "select * from tickets where service_id = $1 and clave_idempotencia = $2",
          [t.servicioId, t.idempotencyKey]
        );
        if (previos.length > 0) {
          const anterior = previos[0];
          // Mismo contenido ORIGINAL → es de verdad un reintento: se
          // regresa el folio que ya existe, sin tocar nada más (ni
          // siquiera se gasta un número de contador nuevo). Contenido
          // distinto con la misma clave no es un reintento — es la
          // clave reusada para otra cosa, y eso sí se rechaza.
          if (!mismoPayloadIdempotencia(anterior.idempotencia_payload, payloadIdempotencia)) {
            throw new Error("CLAVE_IDEMPOTENCIA_REUTILIZADA");
          }
          return anterior;
        }
      }
      // El nombre y el precio de cada procedimiento se leen del
      // catálogo AQUÍ, nunca de lo que mande el cliente: un usuario
      // autenticado podría modificar la petición HTTP a mano y
      // registrar un total distinto al que en verdad corresponde a los
      // procedimientos elegidos — en un sistema financiero, eso es
      // grave aunque no haya de por medio ninguna otra vulnerabilidad.
      let procedimientosSnapshot: { procedimientoId: string; nombre: string; costo: number }[] = [];
      let total = 0;
      if (t.procedimientoIds.length > 0) {
        const { rows: catalogo } = await c.query(
          "select id, nombre, precio from procedimientos where id = any($1) and service_id = $2",
          [t.procedimientoIds, t.servicioId]
        );
        // Si algún id no existe, no pertenece a este servicio, o viene
        // repetido, esto no cuadra — WHERE id = ANY(...) nunca devuelve
        // la misma fila dos veces, así que un id repetido en la lista
        // enviada también cae aquí.
        if (catalogo.length !== t.procedimientoIds.length) throw new Error("PROCEDIMIENTOS_INVALIDOS");
        procedimientosSnapshot = t.procedimientoIds.map((id: string) => {
          const p = catalogo.find((row: any) => row.id === id)!;
          return { procedimientoId: id, nombre: p.nombre, costo: Number(p.precio) };
        });
        total = procedimientosSnapshot.reduce((suma, p) => suma + p.costo, 0);
      }

      // El folio también lo asigna el servidor, de forma atómica — no
      // el navegador, y no con una parte aleatoria sin garantía real de
      // no repetirse. La tabla "contadores" (ver esquema_local.sql) da
      // un número consecutivo por servicio y día, sin condición de
      // carrera aunque dos personas lo pidan casi al mismo instante.
      const hoy = new Date();
      const dia = `${String(hoy.getFullYear()).slice(2)}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}`;
      const { rows: contadorFolio } = await c.query("select siguiente_contador($1) as n", [`folio:${t.servicioId}:${dia}`]);
      const folio = `F${dia}-${String(contadorFolio[0].n).padStart(4, "0")}`;

      // Mismo caso para "Externo": el número de proyecto que el
      // navegador mostraba como vista previa (GET /tickets/siguiente-
      // numero) no estaba reservado — dos personas de tipo "Externo"
      // dadas de alta casi al mismo tiempo podían terminar con el mismo
      // número. Aquí se asigna el de verdad, de forma atómica,
      // ignorando lo que haya mandado el cliente.
      let identificador = t.identificador;
      if (t.tipoUsuario === "Externo") {
        const { rows: contadorProyecto } = await c.query("select siguiente_contador($1) as n", [`proyecto:${t.servicioId}`]);
        identificador = `PRY-${String(contadorProyecto[0].n).padStart(4, "0")}`;
      }

      const { rows } = await c.query(
        // creado_por sale de la sesión, nunca del cuerpo de la petición
        // — mismo motivo que en /eventos: sin esto, cualquiera con
        // acceso al servicio podría generar un folio atribuido a OTRA
        // persona del equipo (un registro financiero, no cualquier cosa).
        // fecha tampoco sale del cliente: siempre el reloj del servidor,
        // con el default de la columna — antes el navegador mandaba su
        // propia fecha/hora y el servidor la guardaba tal cual.
        `insert into tickets (service_id, folio, nombre, identificador, tipo_usuario, categoria, procedimientos, total, estado, forma_pago, creado_por, clave_idempotencia, idempotencia_payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning *`,
        [
          t.servicioId, folio, t.nombre, identificador, t.tipoUsuario, t.categoria, JSON.stringify(procedimientosSnapshot), total, t.estado, t.formaPago, req.usuarioId,
          t.idempotencyKey ?? null,
          t.idempotencyKey ? JSON.stringify(payloadIdempotencia) : null,
        ]
      );
      return rows[0];
    });
    res.json(aTicket(fila));
  } catch (error: any) {
    if (error?.message === "PROCEDIMIENTOS_INVALIDOS") {
      return falla(res, 400, "Uno o más procedimientos no existen en este servicio, o están repetidos.");
    }
    if (error?.message === "CLAVE_IDEMPOTENCIA_REUTILIZADA") {
      return falla(res, 409, "Esta petición ya se usó antes para crear un folio distinto — no se puede reutilizar la misma clave con datos diferentes.");
    }
    // Código 23505 = unique_violation: dos peticiones con la misma
    // clave llegaron tan cerca en el tiempo que ambas pasaron el
    // "select" de arriba antes de que la primera terminara de
    // insertar — el índice único (ver esquema_local.sql) es lo que de
    // verdad evita el folio duplicado en ese caso; aquí solo falta
    // decidir qué responder, no soltar el 500 genérico de más abajo.
    //
    // Comparar contenido AQUÍ también, no solo devolver ciegamente lo
    // que sea que haya ganado la carrera: si dos peticiones con la
    // MISMA clave pero contenido DISTINTO chocan justo así, la que
    // pierde no debe recibir como "su" folio uno que en realidad
    // corresponde a la otra petición — eso sería reportar éxito (200)
    // sobre una operación que nunca ocurrió tal como se pidió.
    if (error?.code === "23505" && t.idempotencyKey) {
      try {
        const { rows: existente } = await conSesionDe(req.usuarioId!, (c) =>
          c.query("select * from tickets where service_id = $1 and clave_idempotencia = $2", [t.servicioId, t.idempotencyKey])
        );
        if (existente.length > 0) {
          if (!mismoPayloadIdempotencia(existente[0].idempotencia_payload, payloadIdempotencia)) {
            return falla(res, 409, "Esta petición ya se usó antes para crear un folio distinto — no se puede reutilizar la misma clave con datos diferentes.");
          }
          return res.json(aTicket(existente[0]));
        }
      } catch {
        // si ni siquiera esto se pudo leer, cae al 500 genérico de abajo
      }
    }
    falla(res, 500, "No se pudo generar el folio.", error);
  }
});

rutas.post("/tickets/:id/pago", requerirSesion, async (req: RequestConUsuario, res) => {
  const errorFormaPago = validarTexto(req.body?.formaPago, LARGO_MAX_TEXTO_CORTO, true);
  if (errorFormaPago !== true) return falla(res, 400, errorFormaPago);
  if (!FORMAS_PAGO_VALIDAS.includes(req.body.formaPago)) return falla(res, 400, "Esa forma de pago no es válida.");
  try {
    // Por el UUID del ticket, no por su folio: aunque folio ya tiene
    // una restricción UNIQUE (ver esquema_local.sql), identificar por
    // la llave primaria nunca depende de esa restricción para ser
    // inequívoco.
    //
    // "and estado = 'credito'" hace que esto sea una transición de un
    // solo sentido (crédito -> pagado), no una edición libre: sin esa
    // condición, un segundo POST sobre un folio YA pagado también
    // pasaba, reemplazando en silencio la forma de pago que ya se
    // había registrado — sin dejar ningún rastro de que hubo un
    // cambio, y sin que fuera necesariamente un error (una cuenta con
    // permiso normal podía hacerlo sin querer, dos veces seguidas).
    //
    // fecha_pago = now() (nunca antes registrado) — separado de la
    // fecha de creación del folio, para no perder el momento real en
    // que se cobró un crédito que se emitió otro día.
    const { rowCount } = await conSesionDe(req.usuarioId!, (c) =>
      c.query(
        "update tickets set estado = 'pagado', forma_pago = $1, fecha_pago = now() where id = $2 and estado = 'credito'",
        [req.body.formaPago, req.params.id]
      )
    );
    if (rowCount === 0) return falla(res, 404, "Ese folio no existe, ya está pagado, o no tienes permiso para registrarle un pago.");
    res.json({ ok: true });
  } catch (error: any) {
    // Código 22P02 de PostgreSQL: el id de la URL no tiene ni siquiera
    // forma de UUID — antes de cambiar esta ruta de folio (texto libre)
    // a id, esto no podía pasar. Mismo criterio que el 404 de arriba:
    // un id que no existe.
    if (error?.code === "22P02") return falla(res, 404, "Ese folio no existe, o no tienes permiso para registrarle un pago.");
    falla(res, 500, "No se pudo registrar el pago.", error);
  }
});

// H10: saldar una cuenta con varios folios en crédito (Credits.tsx,
// "saldar un grupo") antes mandaba un POST /tickets/:id/pago POR
// FOLIO, uno tras otro — si el tercero de cinco fallaba, los dos
// primeros ya habían quedado pagados y los últimos dos no, sin que
// nada lo deshiciera. Todo o nada: si UN folio del grupo ya no está
// disponible para pagar (alguien más lo pagó mientras tanto, ya no
// existe, o no se tiene permiso sobre él), NINGUNO del grupo se aplica
// — conSesionDe() envuelve todo el ciclo en una sola transacción real,
// así que un error a la mitad deshace lo que ya se había hecho.
const LIMITE_TICKETS_POR_LOTE = 200; // de sobra para cualquier cuenta real; solo evita un abuso obvio
rutas.post("/tickets/pago-lote", requerirSesion, async (req: RequestConUsuario, res) => {
  const { ticketIds, formaPago } = req.body ?? {};
  if (!Array.isArray(ticketIds) || ticketIds.length === 0 || !ticketIds.every((id: unknown) => typeof id === "string")) {
    return falla(res, 400, "Falta la lista de folios a pagar (no puede ir vacía).");
  }
  if (ticketIds.length > LIMITE_TICKETS_POR_LOTE) {
    return falla(res, 400, `No se puede saldar más de ${LIMITE_TICKETS_POR_LOTE} folios en una sola operación.`);
  }
  if (new Set(ticketIds).size !== ticketIds.length) {
    return falla(res, 400, "La lista de folios no puede traer el mismo folio repetido.");
  }
  const errorFormaPago = validarTexto(formaPago, LARGO_MAX_TEXTO_CORTO, true);
  if (errorFormaPago !== true) return falla(res, 400, errorFormaPago);
  if (!FORMAS_PAGO_VALIDAS.includes(formaPago)) return falla(res, 400, "Esa forma de pago no es válida.");
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const pagados: any[] = [];
      for (const id of ticketIds as string[]) {
        // Mismo UPDATE, mismo candado de un solo sentido, que el pago
        // individual de arriba — aquí solo cambia que un fallo en
        // CUALQUIER folio del lote aborta la transacción completa
        // (throw dentro de conSesionDe = rollback de todo lo anterior
        // en este mismo ciclo, no solo de este folio).
        const { rows } = await c.query(
          "update tickets set estado = 'pagado', forma_pago = $1, fecha_pago = now() where id = $2 and estado = 'credito' returning *",
          [formaPago, id]
        );
        if (rows.length === 0) throw new Error(`FOLIO_NO_DISPONIBLE:${id}`);
        pagados.push(rows[0]);
      }
      return pagados;
    });
    res.json(filas.map(aTicket));
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.startsWith("FOLIO_NO_DISPONIBLE:")) {
      return falla(
        res,
        409,
        "Uno o más folios de este grupo ya no estaban disponibles para pagar (alguien más ya los pagó, o ya no existen) — no se aplicó ningún cambio en el grupo."
      );
    }
    if (error?.code === "22P02") {
      return falla(res, 400, "Uno de los identificadores de folio no es válido — no se aplicó ningún cambio en el grupo.");
    }
    falla(res, 500, "No se pudo registrar el pago del grupo.", error);
  }
});

// ================================================================
// Finanzas
// ================================================================
function mesKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MES_LABEL = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });

// Los tres reportes de abajo ya filtran a estado === "pagado" — es
// decir, ya eligieron el criterio de caja (cuánto se ha COBRADO), no
// el de ingreso devengado (cuánto se ha FACTURADO). Antes agrupaban
// ese mismo filtro por "fecha" (cuándo se generó el folio), mezclando
// los dos criterios sin querer: un crédito de agosto cobrado en
// septiembre sumaba al corte de agosto, aunque el dinero de verdad
// haya entrado en septiembre. fechaCobro() da la fecha real del
// cobro — fecha_pago si existe, o fecha si el folio nació "pagado"
// (ahí las dos coinciden, así que no hace falta guardarla aparte, ver
// esquema_local.sql). Un reporte de ingreso DEVENGADO de verdad
// tendría que incluir también los créditos todavía sin cobrar — eso
// sería un reporte nuevo y distinto, no una variación de este.
function fechaCobro(t: { fecha: string; fechaPago?: string }): string {
  return t.fechaPago ?? t.fecha;
}

async function serviciosDeOrg(c: any, orgId: string) {
  const { rows } = await c.query("select * from services where org_id = $1", [orgId]);
  return rows.map(aServicio);
}
async function ticketsDeOrg(c: any, orgId: string) {
  const servicios = await serviciosDeOrg(c, orgId);
  const ids = servicios.map((s: any) => s.id);
  if (ids.length === 0) return [];
  const { rows } = await c.query("select * from tickets where service_id = any($1)", [ids]);
  return rows.map(aTicket);
}

rutas.get("/finanzas/ingresos-mensuales", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const puntos = await conSesionDe(req.usuarioId!, async (c) => {
      const tickets = (await ticketsDeOrg(c, req.query.orgId as string)).filter(
        (t: any) => t.estado === "pagado" && (!req.query.servicioId || t.servicioId === req.query.servicioId)
      );
      const acc: Record<string, number> = {};
      for (const t of tickets) {
        const mes = mesKey(fechaCobro(t));
        acc[mes] = (acc[mes] ?? 0) + t.total;
      }
      return Object.entries(acc)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([mes, total]) => ({ mes, label: MES_LABEL.format(new Date(mes + "-02")), total }));
    });
    res.json(puntos);
  } catch (error) {
    falla(res, 500, "No se pudieron leer los ingresos.", error);
  }
});

rutas.get("/finanzas/ingresos-por-servicio", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const servicios = await serviciosDeOrg(c, req.query.orgId as string);
      const tickets = (await ticketsDeOrg(c, req.query.orgId as string)).filter(
        (t: any) => t.estado === "pagado" && (!req.query.mes || mesKey(fechaCobro(t)) === req.query.mes)
      );
      return servicios.map((s: any) => ({
        servicioId: s.id,
        servicioNombre: s.nombre,
        total: tickets.filter((t: any) => t.servicioId === s.id).reduce((sum: number, t: any) => sum + t.total, 0),
      }));
    });
    res.json(filas);
  } catch (error) {
    falla(res, 500, "No se pudieron leer los ingresos por servicio.", error);
  }
});

rutas.get("/finanzas/comparativo", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const servicios = await serviciosDeOrg(c, req.query.orgId as string);
      const tickets = (await ticketsDeOrg(c, req.query.orgId as string)).filter((t: any) => t.estado === "pagado");
      const meses = Array.from(new Set(tickets.map((t: any) => mesKey(fechaCobro(t))))).sort();
      const actual = meses[meses.length - 1];
      const anterior = meses[meses.length - 2];
      return servicios.map((s: any) => {
        const mesActual = tickets.filter((t: any) => t.servicioId === s.id && mesKey(fechaCobro(t)) === actual).reduce((sum: number, t: any) => sum + t.total, 0);
        const mesAnterior = tickets.filter((t: any) => t.servicioId === s.id && anterior && mesKey(fechaCobro(t)) === anterior).reduce((sum: number, t: any) => sum + t.total, 0);
        const deltaPct = mesAnterior > 0 ? ((mesActual - mesAnterior) / mesAnterior) * 100 : null;
        return { servicioId: s.id, servicioNombre: s.nombre, mesActual, mesAnterior, deltaPct };
      });
    });
    res.json(filas);
  } catch (error) {
    falla(res, 500, "No se pudo calcular el comparativo.", error);
  }
});

rutas.get("/finanzas/pendiente-creditos", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const total = await conSesionDe(req.usuarioId!, async (c) => {
      const tickets = (await ticketsDeOrg(c, req.query.orgId as string)).filter(
        (t: any) => t.estado === "credito" && (!req.query.servicioId || t.servicioId === req.query.servicioId)
      );
      return tickets.reduce((sum: number, t: any) => sum + t.total, 0);
    });
    res.json({ total });
  } catch (error) {
    falla(res, 500, "No se pudo calcular el pendiente en créditos.", error);
  }
});

// ================================================================
// Organizaciones
// ================================================================
rutas.get("/organizaciones", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select * from organizations order by nombre");
      return rows;
    });
    res.json(filas.map(aOrganizacion));
  } catch (error) {
    falla(res, 500, "No se pudieron leer las organizaciones.", error);
  }
});

const REGEX_COLOR_HEX = /^#[0-9a-fA-F]{6}$/;

rutas.patch("/organizaciones/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  const mapa: Record<string, string> = { nombre: "nombre", colorPrimario: "color_primario", logoUrl: "logo_url" };
  const b = req.body ?? {};
  for (const [campo, validar] of [
    ["nombre", () => validarTexto(b.nombre, LARGO_MAX_NOMBRE, true)],
    ["colorPrimario", () => (REGEX_COLOR_HEX.test(b.colorPrimario) ? true : "Ese color no es válido.")],
    ["logoUrl", () => validarImagenDataUrl(b.logoUrl)],
  ] as const) {
    if (b[campo] === undefined) continue;
    const resultado = validar();
    if (resultado !== true) return falla(res, 400, resultado);
  }
  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      // Antes de cambiar nada — para saber si nombre/color de verdad
      // cambiaron (el evento de la bitácora solo tiene sentido ahí,
      // igual que ya decidía el frontend antes de esta corrección) y
      // para poder describir el cambio con el nombre/color anteriores.
      const { rows: antes } = await c.query("select nombre, color_primario from organizations where id = $1", [req.params.id]);
      const columnas: string[] = [];
      const valores: any[] = [];
      let i = 1;
      for (const [campo, columna] of Object.entries(mapa)) {
        if (req.body[campo] !== undefined) {
          columnas.push(`${columna} = $${i++}`);
          valores.push(req.body[campo]);
        }
      }
      valores.push(req.params.id);
      const { rows } = await c.query(`update organizations set ${columnas.join(", ")} where id = $${i} returning *`, valores);
      if (rows[0] && antes[0] && (rows[0].nombre !== antes[0].nombre || rows[0].color_primario !== antes[0].color_primario)) {
        await registrarEventoAtomico(c, req.params.id, "Cambió la marca", `Nombre: "${rows[0].nombre}" · color: ${rows[0].color_primario}`);
      }
      return rows[0];
    });
    // Mismo caso que /servicios/:id: RLS filtra el UPDATE a 0 filas sin
    // avisar cuando quien llama no es admin de esta organización.
    if (!fila) return falla(res, 404, "Esa organización ya no existe, o no tienes permiso para editarla.");
    res.json(aOrganizacion(fila));
  } catch (error) {
    falla(res, 500, "No se pudo actualizar la organización.", error);
  }
});

rutas.post("/organizaciones", requerirSesion, async (req: RequestConUsuario, res) => {
  const errorNombre = validarTexto(req.body?.nombre, LARGO_MAX_NOMBRE, true);
  if (errorNombre !== true) return falla(res, 400, errorNombre);
  try {
    // crear_organizacion() ya revisa "eres admin" por dentro y corre
    // con privilegios propios — organizations no tiene política de
    // INSERT para el rol de la aplicación a propósito, solo esta
    // función puede crear una.
    const { rows } = await conSesionDe(req.usuarioId!, (c) => c.query("select * from crear_organizacion($1)", [req.body.nombre]));
    res.json(aOrganizacion(rows[0]));
  } catch (error: any) {
    falla(res, 403, error.message ?? "No se pudo crear la organización.", error);
  }
});

rutas.delete("/organizaciones/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    await conSesionDe(req.usuarioId!, (c) => c.query("select eliminar_organizacion($1)", [req.params.id]));
    res.json({ ok: true });
  } catch (error: any) {
    falla(res, 400, error.message ?? "No se pudo eliminar la organización.", error);
  }
});

// ================================================================
// Archivos enviados
// ================================================================
const LARGO_MAX_CONTENIDO_ARCHIVO = 3_000_000; // ~2MB reales — de sobra para un reporte CSV, evita abusar del campo

// Ninguna ruta autenticada de escritura tenía límite de tasa — una
// cuenta cualquiera (hasta una comprometida) podía mandar archivos sin
// límite, y esta es la única ruta con cuerpos pesados (hasta ~3MB
// cada uno): en bucle, esto llenaría el disco del servidor con el
// tiempo. Se aplica solo a ESTA ruta exacta, no a /archivos/recibidos
// ni a /archivos/:id/leido (marcar como leído es frecuente y sin
// riesgo — no debe competir por el mismo presupuesto). El número es
// deliberadamente generoso: mandar un reporte a un compañero es algo
// ocasional, no algo que una persona real haga decenas de veces en un
// cuarto de hora — no debería notarlo nadie usando la app
// normalmente, ni siquiera varias personas a la vez compartiendo la
// misma IP (mismo razonamiento que el límite de login en index.ts).
// Configurable por si la institución necesita ajustarlo.
const limitadorArchivos = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LIMITE_ARCHIVOS_POR_IP) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados archivos enviados — espera unos minutos y vuelve a intentar." },
});

rutas.post("/archivos", limitadorArchivos, requerirSesion, async (req: RequestConUsuario, res) => {
  const a = req.body ?? {};
  for (const [_campo, resultado] of [
    ["orgId", validarUuid(a.orgId, true)],
    ["paraId", validarUuid(a.paraId, true)],
    ["servicioId", validarUuid(a.servicioId)],
    ["tipo", validarTexto(a.tipo, LARGO_MAX_NOMBRE, true)],
  ] as const) {
    if (resultado !== true) return falla(res, 400, resultado);
  }
  if (typeof a.contenido !== "string" || a.contenido.length === 0) return falla(res, 400, "Falta el contenido del archivo.");
  if (a.contenido.length > LARGO_MAX_CONTENIDO_ARCHIVO) return falla(res, 400, "El archivo es demasiado grande.");
  if (typeof a.nombreArchivo !== "string" || a.nombreArchivo.length === 0 || a.nombreArchivo.length > LARGO_MAX_NOMBRE) {
    return falla(res, 400, "Nombre de archivo inválido.");
  }
  if (a.mensaje !== undefined && (typeof a.mensaje !== "string" || a.mensaje.length > LARGO_MAX_BIO)) {
    return falla(res, 400, "El mensaje es demasiado largo.");
  }
  try {
    const { fila, destinatario } = await conSesionDe(req.usuarioId!, async (c) => {
      // de_id siempre de la sesión, nunca de lo que mande el cliente —
      // RLS ya lo exige (de_id = usuario_actual()) y habría rechazado un
      // deId falso de todos modos, pero es mejor no depender solo de
      // eso: mismo criterio que ya se aplicó en /eventos y /tickets.
      //
      // servicioNombre igual: se lee del catálogo real cuando viene un
      // servicioId, en vez del texto que mande el cliente — antes, dos
      // personas del mismo servicio podían mandar el mismo servicioId
      // con un servicioNombre distinto (con un error de dedo, o a
      // propósito), y quien recibiera el archivo nunca sabría cuál
      // nombre era el real. El servicio también tiene que pertenecer a
      // la organización indicada (org_id = $2, no solo id = $1) — sin
      // esto, un id de servicio de otra organización pasaba la consulta
      // igual, dejando el archivo con una combinación service_id/org_id
      // inconsistente.
      let servicioNombre: string | undefined;
      if (a.servicioId !== undefined) {
        const { rows: servicioRows } = await c.query(
          "select nombre from services where id = $1 and org_id = $2",
          [a.servicioId, a.orgId]
        );
        if (servicioRows.length === 0) throw new Error("SERVICIO_INVALIDO");
        servicioNombre = servicioRows[0].nombre;
      }
      const { rows } = await c.query(
        `insert into archivos_enviados (org_id, de_id, para_id, service_id, servicio_nombre, tipo, nombre_archivo, contenido, mensaje)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [a.orgId, req.usuarioId, a.paraId, a.servicioId, servicioNombre, a.tipo, a.nombreArchivo, a.contenido, a.mensaje]
      );
      const { rows: destRows } = await c.query("select correo, nombre from profiles where id = $1", [a.paraId]);
      return { fila: rows[0], destinatario: destRows[0] as { correo: string; nombre: string } | undefined };
    });
    res.json(aArchivo(fila));

    // Aparte del try/catch de arriba a propósito — la respuesta ya se
    // mandó; si esto fallara, no hay un segundo res.json() que enviar.
    if (correoConfigurado && destinatario?.correo) {
      mandarCorreo(
        destinatario.correo,
        "Te enviaron un archivo en Finaquick",
        `<p>Hola ${escaparHtml(destinatario.nombre ?? "")},</p><p>Te llegó un archivo nuevo en Finaquick${
          fila.servicio_nombre ? ` (${escaparHtml(String(fila.servicio_nombre))})` : ""
        }.</p><p>Entra a la app para verlo.</p>`
      ).catch(() => {});
    }
  } catch (error: any) {
    if (error?.message === "SERVICIO_INVALIDO") return falla(res, 400, "Ese servicio no existe.");
    // Mismo caso que en /categorias: la política de seguridad a nivel
    // de fila exige que el destinatario pertenezca de verdad a la
    // organización indicada — si no, esto es un 42501 de PostgreSQL, no
    // un 500 genérico.
    if (error?.code === "42501") {
      return falla(res, 403, "No puedes enviarle un archivo a esa persona — no pertenece a la organización indicada.");
    }
    falla(res, 500, "No se pudo enviar el archivo.", error);
  }
});

// H11: la campana de notificaciones vuelve a pedir este listado cada
// 12 segundos (ver NotificationsContext.tsx) — sin un límite, cada una
// de esas peticiones traía TODO el historial recibido alguna vez,
// creciendo para siempre con el tiempo de uso, no con lo que en
// realidad hace falta mostrar en una campana de notificaciones
// recientes. Un límite razonable aquí no es solo una optimización: es
// además el comportamiento correcto para una campana (nadie espera
// desplazarse por años de archivos ahí).
const LIMITE_ARCHIVOS_RECIBIDOS = 100;
rutas.get("/archivos/recibidos", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    // Sin "contenido" a propósito — este listado se vuelve a pedir cada
    // pocos segundos (ver NotificationsContext.tsx) solo para saber qué
    // hay de nuevo, y "contenido" es el archivo completo en base64;
    // incluirlo aquí haría cada vez más pesada esa consulta repetida a
    // medida que crece el historial recibido. El contenido de verdad se
    // pide aparte, solo cuando alguien decide descargar un archivo —
    // ver GET /archivos/:id/contenido.
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query(
        `select id, org_id, de_id, para_id, service_id, servicio_nombre, tipo, nombre_archivo, mensaje, fecha, leido
         from archivos_enviados where para_id = $1 order by fecha desc limit $2`,
        [req.usuarioId, LIMITE_ARCHIVOS_RECIBIDOS]
      );
      return rows;
    });
    res.json(filas.map(aArchivo));
  } catch (error) {
    falla(res, 500, "No se pudieron leer los archivos recibidos.", error);
  }
});

rutas.get("/archivos/:id/contenido", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    // La seguridad a nivel de fila ya limita esto a "lo que enviaste o lo
    // que recibiste" (ver esquema_local.sql) — no hace falta repetir esa
    // condición aquí, con un WHERE por id ya basta.
    const { rows } = await conSesionDe(req.usuarioId!, (c) =>
      c.query("select contenido from archivos_enviados where id = $1", [req.params.id])
    );
    if (rows.length === 0) return falla(res, 404, "Ese archivo ya no existe, o no tienes permiso para verlo.");
    res.json({ contenido: rows[0].contenido });
  } catch (error) {
    falla(res, 500, "No se pudo leer el contenido del archivo.", error);
  }
});

rutas.post("/archivos/:id/leido", requerirSesion, async (req: RequestConUsuario, res) => {
  try {
    const { rowCount } = await conSesionDe(req.usuarioId!, (c) => c.query("update archivos_enviados set leido = true where id = $1", [req.params.id]));
    if (rowCount === 0) return falla(res, 404, "Ese archivo ya no existe, o no tienes permiso para marcarlo como leído.");
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo marcar como leído.", error);
  }
});

// ================================================================
// Bitácora de auditoría
// ================================================================
rutas.post("/eventos", requerirSesion, async (req: RequestConUsuario, res) => {
  const { orgId, accion, detalle } = req.body ?? {};
  // "actor" NUNCA sale del cuerpo de la petición — la política de
  // INSERT de esta tabla solo exige pertenecer a la organización, no
  // que el actor seas tú mismo, así que sin esto cualquier miembro
  // podría registrar un evento atribuido a OTRA persona (suplantar la
  // bitácora). Se toma directo de la sesión, que nadie puede falsear.
  const errorAccion = validarTexto(accion, LARGO_MAX_NOMBRE, true);
  if (errorAccion !== true) return falla(res, 400, errorAccion);
  const errorDetalle = validarTexto(detalle, LARGO_MAX_BIO, true);
  if (errorDetalle !== true) return falla(res, 400, errorDetalle);
  // Toda acción administrativa real (cambiar un rol, restablecer una
  // contraseña, crear/eliminar un servicio, cambiar la marca, invitar
  // a alguien, agregar/quitar de una organización o de un servicio) ya
  // la registra el servidor mismo, de forma atómica, dentro de la
  // misma transacción que el cambio real — nunca depende de esta ruta.
  // Esta ruta ya no tiene, del lado de la propia aplicación, ningún
  // llamador real: ninguna pantalla de Finaquick la usa. Sigue
  // existiendo por si alguien quisiera dejar una nota manual llamando
  // a la API directamente (algo que no encaja en ninguna de las
  // acciones de arriba) — lo único que hace este candado es impedir
  // que esa nota pueda hacerse pasar por una de las acciones reales ya
  // enumeradas.
  if (ACCIONES_RESERVADAS_AL_SERVIDOR.has(normalizarAccion(accion))) {
    return falla(res, 400, "Ese texto de acción está reservado — el servidor ya lo registra automáticamente cuando ocurre de verdad.");
  }
  try {
    await conSesionDe(req.usuarioId!, async (c) => {
      const { rows } = await c.query("select nombre from profiles where id = $1", [req.usuarioId]);
      await c.query(
        "insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle) values ($1,$2,$3,$4,$5)",
        [orgId, req.usuarioId, rows[0]?.nombre ?? "—", accion, detalle]
      );
    });
    res.json({ ok: true });
  } catch (error) {
    falla(res, 500, "No se pudo registrar el evento.", error);
  }
});

// H11: antes esto traía la bitácora COMPLETA de la organización en una
// sola consulta — con una institución nueva no se nota, pero después
// de meses u años de uso real esa lista solo crece, nunca se acota
// sola. "antesDe" (un ISO, no un número de página) es un cursor real:
// pedir la fecha del último evento ya mostrado siempre da la
// siguiente tanda correcta, incluso si mientras tanto se insertaron
// eventos nuevos más recientes — a diferencia de un offset numérico,
// que se desincroniza con la lista si algo cambia entre una página y
// la siguiente.
const LIMITE_EVENTOS_DEFAULT = 100;
const LIMITE_EVENTOS_MAXIMO = 500;
rutas.get("/eventos", requerirSesion, async (req: RequestConUsuario, res) => {
  const limite = Math.min(Number(req.query.limit) || LIMITE_EVENTOS_DEFAULT, LIMITE_EVENTOS_MAXIMO);
  const antesDe = req.query.antesDe;
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      if (typeof antesDe === "string" && antesDe) {
        const { rows } = await c.query(
          "select * from eventos_auditoria where org_id = $1 and fecha < $2 order by fecha desc limit $3",
          [req.query.orgId, antesDe, limite]
        );
        return rows;
      }
      const { rows } = await c.query("select * from eventos_auditoria where org_id = $1 order by fecha desc limit $2", [req.query.orgId, limite]);
      return rows;
    });
    res.json(filas.map(aEvento));
  } catch (error) {
    falla(res, 500, "No se pudieron leer los eventos.", error);
  }
});

// ================================================================
// Búsqueda global de folios
// ================================================================
rutas.get("/buscar-folio", requerirSesion, async (req: RequestConUsuario, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  try {
    const filas = await conSesionDe(req.usuarioId!, async (c) => {
      const servicios = await serviciosDeOrg(c, req.query.orgId as string);
      const nombrePorServicio = new Map(servicios.map((s: any) => [s.id, s.nombre]));
      const ids = servicios.map((s: any) => s.id);
      if (ids.length === 0) return [];
      const { rows } = await c.query(
        `select * from tickets where service_id = any($1)
         and (folio ilike $2 or nombre ilike $2 or identificador ilike $2) order by fecha desc`,
        [ids, `%${q}%`]
      );
      return rows.map((r: any) => ({ ...aTicket(r), servicioNombre: nombrePorServicio.get(r.service_id) ?? "" }));
    });
    res.json(filas);
  } catch (error) {
    falla(res, 500, "No se pudo buscar el folio.", error);
  }
});

// Interpreta una pregunta en lenguaje natural para la búsqueda de la
// lupa del encabezado — opcional (ver asistente.ts). El modelo NUNCA
// ve datos reales ni genera consultas: solo clasifica la pregunta en
// una de tres formas fijas, que se valida antes de usarse. Si no está
// configurado (o el proveedor falla), responde 204 — el navegador cae
// de vuelta a su propia búsqueda por patrones sin avisar de un error,
// porque no es uno: es un modo opcional que simplemente no está
// prendido en este servidor.
rutas.post("/asistente/interpretar", requerirSesion, async (req: RequestConUsuario, res) => {
  const errorTexto = validarTexto(req.body?.texto, 200, true);
  if (errorTexto !== true) return falla(res, 400, errorTexto);
  // Preguntas anteriores de esta misma conversación, para que el
  // modelo pueda resolver un "¿y el mes pasado?" sin que se le repita
  // el contexto — nunca respuestas ni datos reales, y acotado (máximo
  // 5, 200 caracteres cada una, igual que la pregunta misma) para que
  // esto no se vuelva una forma disfrazada de mandar texto arbitrario.
  const historialCrudo = req.body?.historial;
  let historial: string[] = [];
  if (historialCrudo !== undefined) {
    const esValido =
      Array.isArray(historialCrudo) &&
      historialCrudo.length <= 5 &&
      historialCrudo.every((h) => typeof h === "string" && h.length <= 200);
    if (!esValido) return falla(res, 400, "El historial de la conversación no es válido.");
    historial = historialCrudo;
  }
  const resultado = await interpretarConIA(req.body.texto, historial);
  if (!resultado) return res.status(204).end();
  res.json(resultado);
});

// Redacta en prosa un resultado que el navegador ya calculó (ver
// narrarResultado en asistente.ts) — nunca recibe datos crudos, solo
// un resumen ya agregado (totales, conteos, nombres de procedimientos
// del catálogo). Es una mejora opcional de redacción, nunca la única
// forma de ver la respuesta: si esto falla o no está configurado, el
// navegador se queda con su frase fija de siempre, sin que se note
// ningún error. Comparte el limitador de /api/asistente de arriba.
rutas.post("/asistente/narrar", requerirSesion, async (req: RequestConUsuario, res) => {
  const texto = await narrarResultado(req.body?.tipo, req.body?.resumen);
  if (!texto) return res.status(204).end();
  res.json({ texto });
});

// Chat libre: Gemini contesta directamente con un resumen ya agregado
// de la cuenta (ver responderChatLibre en asistente.ts) — la
// alternativa "que la IA decida todo" a clasificar primero en una de
// las nueve formas fijas. Mismo criterio de siempre: nunca bloquea,
// nunca recibe datos crudos, y sin IA (o si Gemini falla) el
// navegador cae de vuelta al flujo de clasificación de siempre.
// Comparte el limitador de /api/asistente de arriba.
rutas.post("/asistente/chat", requerirSesion, async (req: RequestConUsuario, res) => {
  const errorTexto = validarTexto(req.body?.texto, 500, true);
  if (errorTexto !== true) return falla(res, 400, errorTexto);
  const historialCrudo = req.body?.historial;
  let historial: string[] = [];
  if (historialCrudo !== undefined) {
    const esValido =
      Array.isArray(historialCrudo) && historialCrudo.length <= 5 && historialCrudo.every((h) => typeof h === "string" && h.length <= 500);
    if (!esValido) return falla(res, 400, "El historial de la conversación no es válido.");
    historial = historialCrudo;
  }
  const texto = await responderChatLibre(req.body.texto, historial, req.body?.digesto);
  if (!texto) return res.status(204).end();
  res.json({ texto });
});

// Si Quick tiene la IA disponible, para mostrarlo en su encabezado en
// vez de que el usuario lo adivine por cómo contesta. Fuera de
// /api/asistente a propósito: no llama a Gemini, así que no debe
// gastar el cupo del limitador de las preguntas reales.
rutas.get("/estado-asistente", requerirSesion, (_req: RequestConUsuario, res) => {
  res.json(estadoIA());
});

// ---------- Requisiciones (solicitud interna de compra/material) ----------

rutas.get("/requisiciones", requerirSesion, async (req: RequestConUsuario, res) => {
  const errorServicio = validarUuid(req.query.servicioId, true);
  if (errorServicio !== true) return falla(res, 400, errorServicio);
  try {
    const { rows } = await conSesionDe(req.usuarioId!, (c) =>
      c.query(
        `select r.*, sp.nombre as solicitante_nombre, ap.nombre as aprobador_nombre
         from requisiciones r
         left join profiles sp on sp.id = r.solicitado_por
         left join profiles ap on ap.id = r.aprobado_por
         where r.service_id = $1
         order by r.creado_en desc`,
        [req.query.servicioId]
      )
    );
    res.json(rows.map(aRequisicion));
  } catch (error) {
    falla(res, 500, "No se pudieron leer las requisiciones.", error);
  }
});

rutas.post("/requisiciones", requerirSesion, async (req: RequestConUsuario, res) => {
  const t = req.body ?? {};
  const errorServicio = validarUuid(t.servicioId, true);
  if (errorServicio !== true) return falla(res, 400, errorServicio);
  const errorConcepto = validarTexto(t.concepto, LARGO_MAX_NOMBRE, true);
  if (errorConcepto !== true) return falla(res, 400, errorConcepto);
  const errorNotas = t.notas !== undefined ? validarTexto(t.notas, LARGO_MAX_BIO) : true;
  if (errorNotas !== true) return falla(res, 400, errorNotas);
  if (!Number.isInteger(t.cantidad) || t.cantidad < 1) return falla(res, 400, "La cantidad debe ser un número entero mayor a cero.");

  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      // Mismo criterio que el folio de un ticket: consecutivo por
      // servicio y día, asignado por el servidor — nunca por el
      // navegador. Prefijo "R" para distinguirlo a simple vista de un
      // folio de cobro ("F...").
      const hoy = new Date();
      const dia = `${String(hoy.getFullYear()).slice(2)}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}`;
      const { rows: contador } = await c.query("select siguiente_contador($1) as n", [`requisicion:${t.servicioId}:${dia}`]);
      const folio = `R${dia}-${String(contador[0].n).padStart(4, "0")}`;

      // solicitado_por sale siempre de la sesión, nunca del cuerpo de
      // la petición — mismo motivo que creado_por en tickets: sin
      // esto, cualquiera con acceso al servicio podría generar una
      // requisición atribuida a otra persona del equipo.
      const { rows } = await c.query(
        `insert into requisiciones (service_id, folio, concepto, cantidad, notas, solicitado_por)
         values ($1,$2,$3,$4,$5,$6)
         returning *`,
        [t.servicioId, folio, t.concepto, t.cantidad, t.notas ?? null, req.usuarioId]
      );
      return rows[0];
    });
    res.json(aRequisicion(fila));
  } catch (error) {
    falla(res, 500, "No se pudo crear la requisición.", error);
  }
});

const MOTIVOS_RESOLUCION_VALIDOS = ["aprobada", "rechazada"] as const;

rutas.patch("/requisiciones/:id", requerirSesion, async (req: RequestConUsuario, res) => {
  const { estado, conFirma, motivoRechazo } = req.body ?? {};
  if (!MOTIVOS_RESOLUCION_VALIDOS.includes(estado)) return falla(res, 400, "Ese estado de resolución no es válido.");
  const errorMotivo = motivoRechazo !== undefined ? validarTexto(motivoRechazo, LARGO_MAX_BIO) : true;
  if (errorMotivo !== true) return falla(res, 400, errorMotivo);

  try {
    const fila = await conSesionDe(req.usuarioId!, async (c) => {
      // La firma es la del APROBADOR, leída de su propio perfil en
      // este mismo momento — nunca la que mande el cliente en el
      // cuerpo de la petición (eso permitiría a cualquiera "firmar"
      // con la firma de otra persona con solo mandar su dataURL). Se
      // guarda como copia (firma_resolucion), no como referencia viva,
      // así que si esa persona cambia su firma después, esta
      // requisición ya resuelta no cambia de aspecto retroactivamente.
      let firmaResolucion: string | null = null;
      if (conFirma) {
        const { rows: perfil } = await c.query("select firma_url from profiles where id = usuario_actual()");
        if (!perfil[0]?.firma_url) throw new Error("SIN_FIRMA_GUARDADA");
        firmaResolucion = perfil[0].firma_url;
      }

      // Solo se puede resolver una requisición que sigue "pendiente" —
      // mismo candado de un solo sentido que ya usa el pago de un
      // folio en crédito (ver POST /tickets/:id/pago): evita que dos
      // administradores resolviéndola casi al mismo tiempo la dejen en
      // un estado incoherente, o que se "reabra" una ya resuelta.
      const { rows } = await c.query(
        `update requisiciones
         set estado = $1, aprobado_por = usuario_actual(), firma_resolucion = coalesce($2, firma_resolucion),
             motivo_rechazo = $3, resuelto_en = now()
         where id = $4 and estado = 'pendiente'
         returning *`,
        [estado, firmaResolucion, estado === "rechazada" ? motivoRechazo ?? null : null, req.params.id]
      );
      if (rows.length === 0) throw new Error("YA_RESUELTA_O_SIN_PERMISO");

      await registrarEventoAtomico(
        c,
        (await c.query("select org_id from services where id = $1", [rows[0].service_id])).rows[0]?.org_id,
        estado === "aprobada" ? "Aprobó una requisición" : "Rechazó una requisición",
        `${rows[0].folio} · ${rows[0].concepto}`
      );
      return rows[0];
    });
    res.json(aRequisicion(fila));
  } catch (error: any) {
    if (error?.message === "SIN_FIRMA_GUARDADA") {
      return falla(res, 400, "Todavía no tienes una firma guardada — agrégala primero en Mi perfil.");
    }
    if (error?.message === "YA_RESUELTA_O_SIN_PERMISO") {
      return falla(res, 409, "Esta requisición ya no está pendiente, o no tienes permiso para resolverla.");
    }
    falla(res, 500, "No se pudo resolver la requisición.", error);
  }
});
