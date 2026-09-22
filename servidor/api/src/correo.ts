// Envío de correo — opcional, apagado por default. Usa la cuenta de
// correo institucional de Microsoft 365 que la universidad ya tiene
// (vía Microsoft Graph), reutilizando el MISMO registro de aplicación
// que el login de Microsoft (microsoft.ts) — nomás que a ese registro
// le agregan el permiso de aplicación "Mail.Send", y aquí además se
// necesita el buzón desde el que se manda.
//
// Sin configurar: correoConfigurado queda en false y mandarCorreo() no
// hace nada — ninguna función de la app depende de que esto exista
// (confirmar correo no bloquea el login, "olvidé mi contraseña" le
// pide al usuario que su administrador se la restablezca).
import * as registro from "./registro.js";

const { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, MICROSOFT_CORREO_ENVIO } = process.env;

export const correoConfigurado = Boolean(
  MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET && MICROSOFT_TENANT_ID && MICROSOFT_CORREO_ENVIO
);

// Los correos se arman con texto que viene del usuario (su nombre, el
// nombre de un servicio, etc.) metido directo en HTML — sin esto,
// alguien podría poner algo como <a href="..."> en su nombre y que le
// llegara como un link de verdad a quien reciba el correo (suplantar
// contenido, no ejecutar nada — los clientes de correo no corren JS —
// pero igual hay que escaparlo, nunca confiar en texto de usuario
// dentro de HTML).
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let tokenCache: { token: string; vence: number } | null = null;

// Flujo "client credentials" de OAuth2 — servidor a servidor, sin que
// ningún usuario tenga que iniciar sesión para esto (a diferencia del
// login de Microsoft, que sí es una acción de cada persona).
async function obtenerTokenGraph(): Promise<string> {
  if (tokenCache && tokenCache.vence > Date.now() + 30_000) return tokenCache.token;
  const resp = await fetch(`https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID!,
      client_secret: MICROSOFT_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!resp.ok) throw new Error(`Microsoft rechazó la solicitud de token para correo (${resp.status}).`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, vence: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/** Manda un correo desde el buzón institucional configurado. Si el
 * envío de correo no está configurado, no hace nada (silencioso a
 * propósito). Si está configurado pero el envío falla (credenciales
 * vencidas, Graph caído, etc.), lo registra en el log del servidor
 * pero NUNCA lanza — nada de lo que dispara un correo (registro,
 * envío de archivos, "olvidé mi contraseña") debe fallar por esto. */
export async function mandarCorreo(destinatario: string, asunto: string, cuerpoHtml: string): Promise<void> {
  if (!correoConfigurado) return;
  try {
    const token = await obtenerTokenGraph();
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MICROSOFT_CORREO_ENVIO!)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: asunto,
          body: { contentType: "HTML", content: cuerpoHtml },
          toRecipients: [{ emailAddress: { address: destinatario } }],
        },
      }),
    });
    if (!resp.ok) {
      const detalle = await resp.text().catch(() => "");
      registro.error(`No se pudo mandar el correo a ${destinatario}`, `${resp.status} ${detalle}`);
    }
  } catch (error) {
    registro.error("Error mandando correo", error);
  }
}
