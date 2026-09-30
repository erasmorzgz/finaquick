import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { leerSesion } from "./auth.js";
import { rutas } from "./rutas.js";
import { microsoftRutas } from "./microsoft.js";
import { pool } from "./db.js";
import * as registro from "./registro.js";

// Sin esto, un error que nadie capturó (un "throw" que se les escapó,
// una promesa rechazada sin .catch) tumbaba el servidor sin dejar
// ningún rastro más que lo que alcanzaba a imprimirse en una terminal
// que, si el servidor corre como servicio en segundo plano, nadie está
// viendo. Node recomienda salir después de un error así (el proceso
// queda en un estado que ya no es confiable) — con un gestor de
// procesos como pm2 (ver LOCAL_SETUP.md), eso hace que se vuelva a
// prender solo, en vez de quedarse caído sin que nadie se entere.
process.on("uncaughtException", (err) => {
  registro.error("Excepción no capturada — el servidor se va a reiniciar", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  registro.error("Promesa rechazada sin capturar — el servidor se va a reiniciar", err);
  process.exit(1);
});

registro.limpiarLogsViejos();

// Zona horaria del servidor. Los folios llevan la fecha del día y los
// totales de Finanzas se agrupan por mes con la hora DEL SERVIDOR,
// mientras que las pantallas (Cierre de caja, Actividad) agrupan con la
// hora del navegador de cada persona. Si no coinciden — un servidor en
// la nube casi siempre corre en UTC —, un cobro hecho después de las 6 pm
// cae "mañana" para el servidor: el folio sale con la fecha del día
// siguiente y, el último día del mes, el total de Finanzas no cuadra con
// el del Cierre de caja. ZONA_HORARIA (ej. America/Mexico_City) la fija
// sin depender de cómo esté configurado el sistema; vacía usa la del
// sistema. Un nombre mal escrito detiene el arranque en vez de caer a
// UTC sin avisar.
if (process.env.ZONA_HORARIA) {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: process.env.ZONA_HORARIA });
  } catch {
    registro.error(`ZONA_HORARIA="${process.env.ZONA_HORARIA}" no es una zona horaria válida (ejemplo: America/Mexico_City)`);
    process.exit(1);
  }
  process.env.TZ = process.env.ZONA_HORARIA;
}

const app = express();

// Apagado por default a propósito: el límite de intentos de abajo
// identifica a cada quien por su IP — si algún día esto corre detrás
// de un proxy/balanceador (nginx, un load balancer, etc.) sin avisarle
// a Express, TODAS las peticiones le llegan con la IP del proxy, no la
// de cada usuario real, y el límite deja de proteger de verdad (o peor,
// un solo usuario abusivo agota el límite compartido de todos los
// demás). Pero activarlo a ciegas sin estar de verdad detrás de un
// proxy es igual de peligroso — cualquiera podría inventar la cabecera
// X-Forwarded-For y saltarse el límite. Por eso es explícito: solo se
// activa si quien despliega esto (ver LOCAL_SETUP.md) pone
// TRUST_PROXY, y con cuántos saltos de proxy confiar, no una bandera
// ciega de "confía en todo".
const saltosDeProxy = Number(process.env.TRUST_PROXY);
if (Number.isInteger(saltosDeProxy) && saltosDeProxy > 0) {
  app.set("trust proxy", saltosDeProxy);
}

// Cabeceras de seguridad estándar (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security cuando corre detrás de
// HTTPS, etc.) — sin esto un API en producción parte de cero.
app.use(helmet());

// Solo el origen exacto del frontend puede llamar a esta API — sin
// ORIGEN_PERMITIDO, cualquier sitio en internet podría intentarlo desde
// el navegador de un usuario ya autenticado.
const origenesPermitidos = (process.env.ORIGEN_PERMITIDO ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());
app.use((req, res, next) => {
  const origen = req.get("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origen && !origenesPermitidos.includes(origen)) {
    res.status(403).json({ error: "El origen de esta solicitud no está permitido." });
    return;
  }
  next();
});
app.use(cors({ origin: origenesPermitidos, credentials: true }));

// Tres límites de tamaño de cuerpo, no uno solo para toda la API: la
// gran mayoría de las rutas (folios, roles, categorías, login...)
// nunca necesita más que unos cuantos KB, así que dejarlas aceptar
// megabytes de cuerpo solo amplía la superficie de abuso de memoria/CPU
// sin ninguna razón real. Cada comparación es por ruta y método
// EXACTOS —nunca un prefijo— para no repetir el error ya corregido en
// el límite de tasa de archivos, donde un prefijo habría afectado
// también a /archivos/:id/leido.
const cuerpoArchivo = express.json({ limit: "5mb" }); // los archivos viajan como texto/base64
// La foto de perfil y el logotipo de organización viajan como imagen
// en base64 dentro del cuerpo JSON de estas dos rutas puntuales, ya
// validadas hasta ~2MB en rutas.ts (LARGO_MAX_IMAGEN_DATAURL).
const cuerpoImagen = express.json({ limit: "2.5mb" });
const RUTA_USUARIO = /^\/api\/usuarios\/[^/]+$/;
const RUTA_ORGANIZACION = /^\/api\/organizaciones\/[^/]+$/;
// Una requisición puede traer hasta 30 imágenes de artículos ya reducidas
// (ver LARGO_MAX_IMAGENES_TOTAL en rutas.ts), y el reporte de Getnet hasta
// 5,000 movimientos: cuerpos más grandes que el normal, solo en esas rutas.
const cuerpoConciliacion = express.json({ limit: "1mb" });
const cuerpoNormal = express.json({ limit: "150kb" });
app.use((req, res, next) => {
  let parser = cuerpoNormal;
  if (req.method === "POST" && req.path === "/api/archivos") parser = cuerpoArchivo;
  else if (req.method === "PATCH" && (RUTA_USUARIO.test(req.path) || RUTA_ORGANIZACION.test(req.path))) parser = cuerpoImagen;
  else if (req.method === "POST" && req.path === "/api/requisiciones") parser = cuerpoImagen;
  else if (req.method === "POST" && req.path === "/api/cierres-caja/conciliar") parser = cuerpoConciliacion;
  parser(req, res, next);
});
app.use(cookieParser());
app.use(leerSesion);

// Límite de intentos en login — la barrera real contra fuerza bruta
// sobre UNA cuenta es el bloqueo de esa cuenta a los 5 intentos
// fallidos (ver profiles.intentos_fallidos); este límite por IP es una
// segunda barrera, más gruesa, contra alguien lanzando muchísimas
// peticiones desde una sola dirección. El número tiene que ser mucho
// más alto que "cuántas veces se equivocaría una sola persona": todo
// un campus suele salir a internet por una sola IP pública (un mismo
// NAT/firewall institucional) — un límite bajo aquí no frenaría a un
// atacante (a quien ya detiene el bloqueo por cuenta), solo dejaría a
// TODO el personal sin poder iniciar sesión en cuanto coincidieran
// varias personas entrando a la vez, como al empezar el turno. Se
// encontró probando con varias decenas de sesiones simultáneas — ver
// npm run carga.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos — espera unos minutos y vuelve a intentar." },
});
// app.post (ruta exacta), no app.use: app.use también atrapaba
// /api/auth/login/2fa, así que cada código de segundo factor gastaba el
// cupo del login.
app.post("/api/auth/login", limitadorLogin);
// El código de 2FA es de 6 dígitos (un millón de combinaciones) — sin
// límite de intentos aquí también, alguien con la contraseña correcta
// pero sin el teléfono podría probarlas todas dentro de los 5 minutos
// que dura el token de la primera mitad del login. Aparte del límite
// de login: alguien ya pasó la contraseña para llegar aquí, así que
// compartir presupuesto con /login no tendría sentido. La barrera
// principal contra probar códigos es el bloqueo por cuenta (ver la ruta
// en rutas.ts); este límite por IP es la segunda, y por la misma razón
// del NAT del campus que el de login no puede ser bajo: muchas personas
// con 2FA entrando al inicio del turno salen por la misma IP.
const limitadorSegundoFactor = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos — espera unos minutos y vuelve a intentar." },
});
app.post("/api/auth/login/2fa", limitadorSegundoFactor);
// Aparte del de login: el registro es un evento raro (una vez por
// persona, no todos los días), así que puede quedarse con un límite
// bajo sin afectar el uso normal — y así una ola de altas de cuentas
// nuevas no le come presupuesto de login a todos los demás en la
// misma IP, ni viceversa.
const limitadorRegistro = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos — espera unos minutos y vuelve a intentar." },
});
app.use("/api/auth/registrar", limitadorRegistro);

// Aparte del de arriba — sin esto, "olvidé mi contraseña" se podría
// usar para bombardear de correos a alguien (o gastarle a la
// institución su cuota de envíos de Microsoft Graph), aunque no sirva
// para adivinar ninguna contraseña.
const limitadorRecuperacion = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos — espera unos minutos y vuelve a intentar." },
});
app.use("/api/auth/olvide-password", limitadorRecuperacion);
app.use("/api/auth/restablecer-password-con-token", limitadorRecuperacion);
app.use("/api/auth/confirmar-correo", limitadorRecuperacion);

// A diferencia de las demás rutas, cada llamada aquí cuesta dinero de
// verdad (se le cobra a la institución por el proveedor de IA que
// hayan configurado) — sin este límite, alguien escribiendo rápido en
// la búsqueda (o un error del propio frontend disparando la petición
// de más) podía generar un gasto real sin que nadie lo notara a
// tiempo. 40 en 15 minutos alcanza sobrado para uso normal de una
// sola persona buscando varias cosas seguidas.
const limitadorAsistente = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas búsquedas — espera unos minutos y vuelve a intentar." },
});
app.use("/api/asistente", limitadorAsistente);

app.use("/api", microsoftRutas);
app.use("/api", rutas);

// No solo "el proceso responde" — confirma que la base de datos
// también contesta, que es la forma real de saber si el servicio está
// sano. Pensado para que algo externo lo revise cada cierto tiempo
// (un cron con curl, una herramienta de monitoreo si algún día la
// institución agrega una) y avise si dos o tres seguidas fallan.
app.get("/api/salud", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, baseDeDatos: "conectada", segundosActivo: Math.round(process.uptime()) });
  } catch (error) {
    registro.error("Chequeo de salud: la base de datos no respondió", error);
    res.status(503).json({ ok: false, baseDeDatos: "sin conexión" });
  }
});

// Rutas de la API que no existen: JSON, como todo lo demás de /api (el
// manejador por default de Express contesta con una página HTML).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Esa ruta no existe." });
});

// Último manejador de errores. Sin él, un cuerpo JSON mal formado o
// demasiado grande — que se procesa ANTES de llegar a cualquier ruta,
// incluso sin iniciar sesión — recibía el manejador por default de
// Express: una página HTML con el error completo y el stack trace, con
// las rutas de archivos del servidor (usuario del sistema, carpeta de
// instalación). Aquí se contesta JSON con un mensaje genérico y el
// detalle se queda solo en el registro del servidor.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 413) return res.status(413).json({ error: "El contenido enviado es demasiado grande." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "El cuerpo de la petición no es un JSON válido." });
  if (status >= 400 && status < 500) return res.status(status).json({ error: "La petición no es válida." });
  registro.error("Error no controlado en una petición", err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const puerto = Number(process.env.PORT) || 4000;
const servidor = app.listen(puerto, () => {
  // No dice "localhost" a propósito — este mismo mensaje aparece igual
  // corriendo en la máquina de alguien (donde sí es localhost) que en
  // el servidor real de la institución detrás de su propio dominio
  // (donde decir "localhost" en el log confundiría a quien lo revise,
  // como si algo estuviera mal configurado cuando no es así).
  registro.info(`Servidor de Finaquick escuchando en el puerto ${puerto} (zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
});

// Sin esto, un gestor de procesos (pm2, systemd, un contenedor)
// simplemente mata el proceso al reiniciarlo o detenerlo — cortando de
// tajo cualquier petición HTTP a medias y cualquier conexión abierta
// del pool de PostgreSQL, en vez de dejarlas terminar. server.close()
// deja de aceptar conexiones NUEVAS pero espera a que las que ya están
// en curso terminen solas; recién entonces se cierra el pool. El
// timeout de seguridad es para el caso raro de una conexión que nunca
// termina por su cuenta — sin él, un apagado "ordenado" podría
// quedarse esperando para siempre.
function apagar(señal: string) {
  registro.info(`Señal ${señal} recibida — cerrando el servidor ordenadamente`);
  const forzar = setTimeout(() => {
    registro.error("El apagado ordenado tardó demasiado — cerrando a la fuerza", new Error("timeout de apagado"));
    process.exit(1);
  }, 10_000);
  forzar.unref(); // no debe ser lo único que mantenga vivo el proceso
  servidor.close(async () => {
    await pool.end().catch(() => {});
    clearTimeout(forzar);
    process.exit(0);
  });
}
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
