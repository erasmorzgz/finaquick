// Inicio de sesión con la cuenta institucional de Microsoft (Azure AD /
// Microsoft Entra ID) — flujo estándar OAuth 2.0 "authorization code".
// La invitación sigue siendo obligatoria: tener una cuenta de Microsoft
// válida del tenant de la institución NO basta por sí sola para entrar,
// igual que con correo y contraseña — un administrador debe haber
// invitado ese correo primero.
import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { firmarSesion, firmarTokenAccion, ponerCookieSesion, secretoOAuthMicrosoft, MARCADOR_SIN_PASSWORD_PROPIA } from "./auth.js";
import type { RequestConUsuario } from "./auth.js";
import * as registro from "./registro.js";

export const microsoftRutas = Router();

const {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  MICROSOFT_TENANT_ID,
  MICROSOFT_REDIRECT_URI,
  FRONTEND_URL,
} = process.env;

const configurado = Boolean(
  MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET && MICROSOFT_TENANT_ID && MICROSOFT_REDIRECT_URI
);

// El "state" de OAuth va firmado, con un vencimiento corto, y verificado
// al volver de Microsoft. Pero la firma por sí sola solo demuestra que
// ESTE SERVIDOR lo generó en algún momento de los últimos 10 minutos —
// no que quien está completando el callback es el mismo navegador que
// inició el flujo. Sin ese segundo amarre, alguien podía arrancar su
// propio inicio de sesión con SU cuenta de Microsoft (obteniendo un
// "state" válido y firmado), y luego lograr que el navegador de OTRA
// persona visitara la URL de vuelta con ese code/state — dejándola con
// una sesión de Finaquick a nombre del atacante, sin que ella lo
// supiera ("login CSRF").
//
// El amarre real es un valor aleatorio, guardado en una cookie httpOnly
// de vida corta en ESTE navegador al iniciar el flujo, y repetido
// dentro del "state" firmado — al volver, si la cookie no existe o no
// coincide con lo que dice el state, se rechaza. Solo el navegador que
// inició el flujo tiene esa cookie.
// "intentoReautenticarId", cuando viene, amarra este flujo a una
// cuenta ya conocida (ver /auth/microsoft/iniciar?intent=2fa más
// abajo) — sirve para que alguien con 2FA activo, pero sin contraseña
// propia (cuenta creada solo por Microsoft), pueda reautenticarse con
// Microsoft en vez de escribir una contraseña que nunca tuvo, para
// iniciar la configuración de un nuevo secreto TOTP. No reemplaza el
// amarre de nonce/cookie de
// arriba (ese sigue siendo lo que evita el "login CSRF" entre
// navegadores distintos) — este es un amarre aparte, de CUENTA: exige
// que la persona que completa el callback sea, de verdad, la misma
// cuenta de Finaquick que iba a reautenticarse, no cualquier cuenta de
// Microsoft del mismo tenant.
function firmarState(nonce: string, intentoReautenticarId?: string): string {
  return jwt.sign({ tipo: "oauth_microsoft", nonce, intentoReautenticarId }, secretoOAuthMicrosoft, { expiresIn: "10m" });
}
function stateValido(state: string, nonceDeCookie: string | undefined): { intentoReautenticarId?: string } | null {
  if (!nonceDeCookie) return null;
  try {
    const payload = jwt.verify(state, secretoOAuthMicrosoft, { algorithms: ["HS256"] }) as {
      tipo?: string;
      nonce?: string;
      intentoReautenticarId?: string;
    };
    if (payload.tipo !== "oauth_microsoft" || payload.nonce !== nonceDeCookie) return null;
    return { intentoReautenticarId: payload.intentoReautenticarId };
  } catch {
    return null;
  }
}

const COOKIE_NONCE_OAUTH = "finaquick_oauth_nonce";

microsoftRutas.get("/auth/microsoft/iniciar", (req: RequestConUsuario, res) => {
  if (!configurado) {
    res.status(503).send(
      "El inicio de sesión con Microsoft todavía no está configurado en este servidor " +
        "(faltan MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID / " +
        "MICROSOFT_REDIRECT_URI en servidor/api/.env — ver LOCAL_SETUP.md)."
    );
    return;
  }
  // ?intent=2fa: no es un login nuevo, es una cuenta YA con sesión
  // abierta (sin contraseña propia, porque se creó por Microsoft) que
  // necesita reautenticarse para poder iniciar la configuración de un
  // secreto 2FA nuevo — ver Profile.tsx y el callback más abajo. Sin
  // sesión, esto no tiene sentido: se rechaza aquí mismo, antes de
  // mandar a nadie a Microsoft.
  const intentoReautenticar2fa = req.query.intent === "2fa";
  if (intentoReautenticar2fa && !req.usuarioId) {
    res.status(401).send("Necesitas haber iniciado sesión antes de reautenticarte con Microsoft.");
    return;
  }
  const nonce = crypto.randomBytes(24).toString("hex");
  res.cookie(COOKIE_NONCE_OAUTH, nonce, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    // "Lax", no "Strict": esta cookie tiene que sobrevivir la
    // navegación de nivel superior que trae de vuelta desde
    // login.microsoftonline.com — con "Strict" el navegador no la
    // manda de regreso y el amarre nunca coincidiría, ni siquiera en
    // el flujo legítimo.
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/microsoft",
  });
  const parametros = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: MICROSOFT_REDIRECT_URI!,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state: firmarState(nonce, intentoReautenticar2fa ? req.usuarioId : undefined),
    // "login": para el login normal, una sesión de Microsoft ya activa
    // en el navegador (SSO) es exactamente el punto — no tiene sentido
    // pedir credenciales otra vez solo para entrar a Finaquick. Pero
    // reautenticarse para configurar 2FA (?intent=2fa) es, por
    // definición, una prueba de identidad NUEVA — sin este parámetro,
    // una sesión de Microsoft ya abierta en el equipo (compartido, o
    // simplemente sin cerrar sesión de Microsoft) habría bastado para
    // completar el flujo entero sin pedir nada, dejando el candado de
    // "reautenticación" sin efecto real en ese caso. `prompt=login`
    // exige escribir credenciales para ESTA solicitud en particular,
    // sin cerrar la sesión de Microsoft del resto del navegador.
    ...(intentoReautenticar2fa ? { prompt: "login" } : {}),
  });
  res.redirect(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${parametros}`
  );
});

microsoftRutas.get("/auth/microsoft/callback", async (req, res) => {
  const frontend = FRONTEND_URL ?? "http://localhost:5173";
  const { code, state, error, error_description } = req.query;
  // Se lee y se borra en el mismo paso — de un solo uso, como el
  // "code" de Microsoft mismo. Si esto falla más adelante y la persona
  // reintenta desde el botón de "Iniciar con Microsoft", vuelve a
  // arrancar el flujo completo con un nonce nuevo.
  const nonceDeCookie = req.cookies?.[COOKIE_NONCE_OAUTH] as string | undefined;
  res.clearCookie(COOKIE_NONCE_OAUTH, { path: "/api/auth/microsoft" });

  if (error) {
    res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent(String(error_description ?? error))}`);
    return;
  }
  const estadoDecodificado = typeof state === "string" ? stateValido(state, nonceDeCookie) : null;
  if (!estadoDecodificado) {
    res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent("Solicitud inválida o vencida — intenta de nuevo.")}`);
    return;
  }
  const intentoReautenticarId = estadoDecodificado.intentoReautenticarId;
  if (typeof code !== "string") {
    res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent("Microsoft no envió el código esperado.")}`);
    return;
  }

  try {
    // 1. Intercambia el código por un token de acceso — server-to-
    //    server, el client_secret nunca toca el navegador.
    const respuestaToken = await fetch(
      `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: MICROSOFT_CLIENT_ID!,
          client_secret: MICROSOFT_CLIENT_SECRET!,
          code,
          redirect_uri: MICROSOFT_REDIRECT_URI!,
          grant_type: "authorization_code",
        }),
      }
    );
    if (!respuestaToken.ok) throw new Error(`Microsoft rechazó el intercambio de token (${respuestaToken.status}).`);
    const { access_token } = (await respuestaToken.json()) as { access_token: string };

    // 2. Con ese token, pide los datos del perfil a Microsoft Graph —
    //    más simple y igual de confiable que validar el id_token a mano.
    const respuestaPerfil = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!respuestaPerfil.ok) throw new Error("No se pudo leer el perfil de Microsoft.");
    const perfilMs = (await respuestaPerfil.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    const correo = (perfilMs.mail ?? perfilMs.userPrincipalName ?? "").trim().toLowerCase();
    const nombre = perfilMs.displayName ?? correo;
    if (!correo) throw new Error("La cuenta de Microsoft no tiene un correo asociado.");

    // 3. Mismo candado que el registro normal: sin invitación vigente
    //    para ese correo, no entra — tener cuenta de Microsoft del
    //    tenant correcto no es, por sí solo, autorización para usar
    //    Finaquick. Sin sesión todavía, así que se usan las mismas
    //    funciones con privilegios propios que usa el registro normal
    //    (ver servidor/esquema_local.sql) en vez de escribir directo.
    const { rows: existente } = await pool.query("select * from obtener_credenciales_login($1)", [correo]);
    let usuarioId: string;
    let totpHabilitado = false;
    if (existente.length > 0) {
      usuarioId = existente[0].id;
      // Si esta cuenta ya tiene 2FA local activo, entrar por Microsoft
      // no puede saltárselo — de lo contrario, el segundo factor local
      // quedaría sin efecto para cualquiera que entrara por este camino
      // en vez del de correo/contraseña.
      totpHabilitado = existente[0].totp_habilitado;
    } else {
      try {
        // Cuenta de Microsoft: sin contraseña propia que guardar — se
        // marca con un hash que ningún password real puede producir
        // (bcrypt nunca genera este formato), así que iniciar sesión
        // con correo/contraseña para esta cuenta siempre falla —
        // correcto, esta cuenta solo entra por Microsoft.
        //
        // registrar_usuario_via_microsoft(), no registrar_usuario(): no
        // exige el código de invitación que sí exige el registro por
        // correo/contraseña — aquí Microsoft ya demostró que quien
        // inicia sesión controla de verdad este correo institucional
        // (Azure AD/Entra ID lo autenticó), una prueba más fuerte que
        // un código relayado a mano.
        const { rows } = await pool.query("select * from registrar_usuario_via_microsoft($1, $2, $3)", [
          nombre,
          correo,
          MARCADOR_SIN_PASSWORD_PROPIA,
        ]);
        usuarioId = rows[0].id;
      } catch (error: any) {
        if (error?.message?.includes("invitarte")) throw new Error("SIN_INVITACION");
        throw error;
      }
    }

    // Reautenticación para configurar 2FA (ver /auth/microsoft/iniciar
    // más arriba), no un login nuevo: en vez de abrir sesión, se manda
    // un token de un solo propósito y vida corta de vuelta a Profile,
    // que lo usa para llamar a POST /auth/2fa/iniciar sin contraseña —
    // la cuenta nunca tuvo una propia, porque se creó por Microsoft.
    if (intentoReautenticarId) {
      // "usuarioId !== intentoReautenticarId" cubre el caso de alguien
      // que abre esta reautenticación con SU sesión, pero termina el
      // flujo de Microsoft con la cuenta de OTRA persona (dos cuentas
      // de Microsoft abiertas en el mismo navegador, por ejemplo) — sin
      // este chequeo, el token resultante quedaría firmado para la
      // cuenta de Finaquick equivocada.
      if (usuarioId !== intentoReautenticarId) {
        throw new Error("REAUTENTICACION_CUENTA_DISTINTA");
      }
      const tokenReauth = firmarTokenAccion("2fa_reautenticado_microsoft", usuarioId, {}, "5m");
      res.redirect(`${frontend}/microsoft/completado#reauth2fa=${encodeURIComponent(tokenReauth)}`);
      return;
    }

    // Con 2FA activo, entrar con Microsoft no basta por sí solo —
    // mismo criterio exacto que el login con correo/contraseña
    // (rutas.ts, POST /auth/login): se manda un token de un solo
    // propósito y de vida corta a la pantalla de "escribe tu código",
    // en vez de la cookie de sesión real. Esa pantalla llama al mismo
    // POST /auth/login/2fa de siempre para completar el acceso.
    //
    // Va en el fragmento de la URL (#), no en un parámetro de consulta
    // (?) — el navegador nunca manda el fragmento al servidor (ni a
    // este ni a ningún otro sitio, ni siquiera como Referer), así que
    // no puede quedar registrado en un log de acceso, un proxy, o una
    // herramienta de analítica de terceros. Sí puede quedar en el
    // historial local del navegador de quien inició sesión, pero el
    // token expira en 5 minutos y no sirve de nada sin también conocer
    // la contraseña de esa cuenta (ya verificada por Microsoft antes de
    // llegar aquí).
    if (totpHabilitado) {
      const tokenPre = firmarTokenAccion("login_2fa", usuarioId, { emitidoEnMs: Date.now() }, "5m");
      res.redirect(`${frontend}/microsoft/completado#tokenPre=${encodeURIComponent(tokenPre)}`);
      return;
    }

    // La cookie httpOnly se pone aquí, en el servidor — el token nunca
    // viaja por la URL del navegador (donde quedaría en el historial,
    // en logs del servidor web, etc.).
    ponerCookieSesion(res, firmarSesion(usuarioId));
    res.redirect(`${frontend}/microsoft/completado`);
  } catch (error: any) {
    // Sin invitación no es un error del servidor — pasa todos los
    // días, no algo que deba ensuciar el log de errores reales.
    if (error?.message === "SIN_INVITACION") {
      const mensaje = "Tu administrador debe invitarte primero desde Configuración → Usuarios, con este mismo correo institucional.";
      res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent(mensaje)}`);
      return;
    }
    if (error?.message === "REAUTENTICACION_CUENTA_DISTINTA") {
      const mensaje = "Reautenticaste con una cuenta de Microsoft distinta a la que tenías abierta en Finaquick.";
      res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent(mensaje)}`);
      return;
    }
    registro.error("Error en login de Microsoft", error);
    res.redirect(`${frontend}/microsoft/completado?error=${encodeURIComponent("No se pudo completar el inicio de sesión con Microsoft.")}`);
  }
});
