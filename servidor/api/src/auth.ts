import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db.js";

if (!process.env.JWT_SECRET) {
  throw new Error(
    "Falta JWT_SECRET en el .env del servidor — genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
}
const SECRETO_JWT: string = process.env.JWT_SECRET;

/** Deriva, a partir del único JWT_SECRET que configura quien despliega
 * esto, una llave distinta por cada dominio de uso (sesión, token de
 * acción, state de OAuth, cifrado del secreto TOTP) — sin pedirle a
 * quien instala Finaquick que genere y guarde varios secretos en vez
 * de uno. Un valor derivado para un dominio no sirve para ningún otro,
 * así que confundir un uso con otro en el código no basta por sí solo
 * para que uno funcione como el otro. */
function derivarSecreto(dominio: string): string {
  return createHmac("sha256", SECRETO_JWT).update(dominio).digest("hex");
}

const SECRETO_SESION = derivarSecreto("sesion");
const SECRETO_ACCION = derivarSecreto("accion");
export const secretoOAuthMicrosoft = derivarSecreto("oauth_microsoft");

// Marcador que registrar_usuario_via_microsoft() guarda como
// password_hash de una cuenta que solo entra por Microsoft (ver
// microsoft.ts) — bcrypt nunca genera este formato, así que un login
// por correo/contraseña para esa cuenta siempre falla, como debe ser.
// Compartido (no repetido como texto suelto en dos archivos) porque
// tanto microsoft.ts como rutas.ts necesitan reconocerlo: el primero
// para escribirlo al crear la cuenta, el segundo para decidir si una
// cuenta puede reautenticarse con contraseña o solo con Microsoft.
export const MARCADOR_SIN_PASSWORD_PROPIA = "microsoft-sso:sin-password-propia";

// AES-256-GCM: el secreto TOTP tiene que poder leerse de vuelta (a
// diferencia de una contraseña, no basta con compararlo como hash) para
// verificar el código en cada login, así que cifrado reversible es la
// única opción real — texto plano expondría los secretos de todas las
// cuentas ante una fuga de la base de datos o de un respaldo. La llave
// de cifrado nunca vive en PostgreSQL: se deriva aquí, en el servidor,
// del mismo JWT_SECRET que ya configura quien despliega esto.
//
// Consecuencia de rotar JWT_SECRET: además de cerrar todas las sesiones
// activas (ya documentado), invalida también todos los secretos TOTP ya
// cifrados — nadie con 2FA activo podrá iniciar sesión con su código
// hasta desactivarlo y volver a activarlo. Ver "Rotación de JWT_SECRET"
// en SECURITY.md.
const LLAVE_CIFRADO_TOTP = Buffer.from(derivarSecreto("totp_cifrado"), "hex");

export function cifrarTotp(secretoPlano: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", LLAVE_CIFRADO_TOTP, iv);
  const cifrado = Buffer.concat([cifrador.update(secretoPlano, "utf8"), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), cifrado].map((b) => b.toString("base64")).join(".");
}

export function descifrarTotp(valorCifrado: string): string {
  const [ivB64, tagB64, cifradoB64] = valorCifrado.split(".");
  const descifrador = createDecipheriv("aes-256-gcm", LLAVE_CIFRADO_TOTP, Buffer.from(ivB64, "base64"));
  descifrador.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([descifrador.update(Buffer.from(cifradoB64, "base64")), descifrador.final()]).toString("utf8");
}

const NOMBRE_COOKIE = "finaquick_sesion";
const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verificarPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function firmarSesion(usuarioId: string): string {
  // emitidoEnMs, aparte del "iat" estándar del JWT: "iat" solo tiene
  // precisión de segundos (lo exige el estándar), insuficiente para
  // decidir con confianza "¿esta sesión es de antes o de después del
  // cambio de contraseña?" cuando las dos cosas pasan casi al mismo
  // tiempo (encontrado con la propia suite de pruebas, donde login y
  // cambio de contraseña caen en el mismo segundo real). En
  // milisegundos, la ambigüedad prácticamente desaparece.
  return jwt.sign({ sub: usuarioId, emitidoEnMs: Date.now() }, SECRETO_SESION, { expiresIn: "30d" });
}

/** Pone el token en una cookie httpOnly (JavaScript en el navegador no
 * puede leerla ni con una inyección de código de por medio) en vez de
 * regresarlo en el cuerpo de la respuesta — así nunca pasa por
 * localStorage ni por ningún estado de la app expuesto a JS. */
export function ponerCookieSesion(res: Response, token: string) {
  res.cookie(NOMBRE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    maxAge: TREINTA_DIAS_MS,
    path: "/",
  });
}

export function limpiarCookieSesion(res: Response) {
  res.clearCookie(NOMBRE_COOKIE, { path: "/" });
}

export interface RequestConUsuario extends Request {
  usuarioId?: string;
  usuarioEmitidoEnMs?: number;
}

/** Lee el token de la cookie de sesión, si viene, y expone
 * req.usuarioId. No rechaza la petición si no hay token — algunas
 * rutas son públicas (login, registro) y las que sí lo exigen usan
 * requerirSesion() aparte. */
export function leerSesion(req: RequestConUsuario, _res: Response, next: NextFunction) {
  const token = req.cookies?.[NOMBRE_COOKIE];
  if (token) {
    try {
      // "algorithms" fijo a propósito, aunque hoy no hay forma de
      // explotar su ausencia (jsonwebtoken ya rechaza "alg: none" por
      // default, y aquí nunca existió una llave pública/privada que un
      // token falso pudiera reusar como si fuera el secreto HMAC) —
      // pero fijarlo explícitamente cuesta cero y cierra la puerta a
      // que un cambio futuro en la librería, o un tipo de llave nuevo
      // agregado más adelante, reabra ese caso.
      const payload = jwt.verify(token, SECRETO_SESION, { algorithms: ["HS256"] }) as { sub: string; emitidoEnMs?: number };
      req.usuarioId = payload.sub;
      req.usuarioEmitidoEnMs = payload.emitidoEnMs;
    } catch {
      // Token inválido o vencido — se trata como "sin sesión", no como
      // error; las rutas protegidas lo rechazan aparte con requerirSesion.
    }
  }
  next();
}

/** Tokens firmados de un solo propósito (confirmar correo, restablecer
 * contraseña por enlace) — igual que la sesión, pero con su propio
 * "tipo" (para que un token de confirmar-correo no sirva para
 * restablecer contraseña ni viceversa) y su propio vencimiento, más
 * corto. No se guardan en el servidor — la firma es lo que los hace
 * imposibles de falsificar sin conocer JWT_SECRET. */
export function firmarTokenAccion(
  tipo: string,
  usuarioId: string,
  datos: Record<string, unknown> = {},
  expiresIn: jwt.SignOptions["expiresIn"] = "1h"
): string {
  return jwt.sign({ tipo, sub: usuarioId, ...datos }, SECRETO_ACCION, { expiresIn });
}

export function verificarTokenAccion(token: string, tipoEsperado: string): Record<string, any> | null {
  try {
    const payload = jwt.verify(token, SECRETO_ACCION, { algorithms: ["HS256"] }) as Record<string, any>;
    if (payload.tipo !== tipoEsperado) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Además de exigir que haya sesión, revisa que no haya quedado
 * invalidada desde que se emitió: cambiar la contraseña (uno mismo, un
 * administrador restableciéndola, o un enlace de "olvidé mi
 * contraseña") pone profiles.sesion_valida_desde en el momento exacto
 * del cambio. Sin esto, un JWT robado seguía funcionando hasta sus 30
 * días de vencimiento SIN IMPORTAR que la contraseña ya hubiera
 * cambiado — cambiarla no servía para cerrarle la puerta a quien ya
 * tenía una sesión copiada. Cuesta una consulta extra por petición
 * protegida; con el límite de conexiones ya ampliado (ver db.ts) y lo
 * visto en la prueba de carga, es un costo aceptable frente a lo que
 * evita. */
// Rutas que siguen sirviendo aunque la cuenta tenga pendiente un cambio
// de contraseña obligatorio — lo mínimo para que la persona pueda
// resolver esa condición (o salir) sin quedar completamente encerrada:
// ver el propio perfil (para que el frontend sepa que debe mostrar la
// pantalla de "cambia tu contraseña"), cambiarla, y cerrar sesión.
const RUTAS_PERMITIDAS_CON_CAMBIO_PENDIENTE = new Set([
  "/auth/sesion",
  "/auth/cambiar-password",
  "/auth/logout",
]);

export async function requerirSesion(req: RequestConUsuario, res: Response, next: NextFunction) {
  if (!req.usuarioId || req.usuarioEmitidoEnMs === undefined) {
    res.status(401).json({ error: "Necesitas iniciar sesión." });
    return;
  }
  try {
    // Consulta directa a "profiles" (fuera de conSesionDe) toparía con
    // RLS sin usuario_actual() puesto todavía — por eso una función con
    // privilegios propios, mismo patrón que obtener_credenciales_login.
    const { rows } = await pool.query("select * from sesion_valida_desde_de($1)", [req.usuarioId]);
    const validaDesde = rows[0]?.sesion_valida_desde as Date | undefined;
    if (!validaDesde || req.usuarioEmitidoEnMs < validaDesde.getTime()) {
      res.status(401).json({ error: "Tu sesión ya no es válida (la contraseña cambió) — vuelve a iniciar sesión." });
      return;
    }
    // Una contraseña temporal generada por un administrador se queda
    // como tal solo de nombre si nada más la impone — antes, la cuenta
    // podía seguir usándola indefinidamente. Mientras esté pendiente,
    // el servidor mismo bloquea cualquier ruta que no sea de la lista
    // de arriba, no solo lo sugiere en un mensaje.
    if (rows[0]?.debe_cambiar_password && !RUTAS_PERMITIDAS_CON_CAMBIO_PENDIENTE.has(req.path)) {
      res.status(403).json({ error: "Debes cambiar tu contraseña temporal antes de continuar.", debeCambiarPassword: true });
      return;
    }
  } catch {
    res.status(500).json({ error: "No se pudo verificar tu sesión." });
    return;
  }
  next();
}
