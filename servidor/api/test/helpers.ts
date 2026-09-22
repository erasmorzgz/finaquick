// Infraestructura compartida por toda la suite de pruebas: prepara una
// base de datos real desde cero (el mismo esquema que se usa en
// producción, no una versión simplificada), arranca el servidor real
// como proceso aparte contra esa base, y da un cliente HTTP que
// recuerda la cookie de sesión entre peticiones — como un navegador
// real, para que cada prueba ejercite la API igual que la usaría
// alguien de verdad.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ_API = join(__dirname, "..");
const RAIZ_SERVIDOR = join(RAIZ_API, "..");
const ESQUEMA = join(RAIZ_SERVIDOR, "esquema_local.sql");

export const DB_PRUEBA = "finaquick_pruebas_automaticas";
export const PUERTO_PRUEBA = 4099;
export const URL_BASE = `http://localhost:${PUERTO_PRUEBA}/api`;
const CONTRASENA_APP = "pruebas_automaticas_pw_2026";
// Mismo valor que se le pasa al servidor de pruebas más abajo — se
// exporta para que una prueba pueda firmar, con la misma llave, un
// token que el servidor real acepte como propio (sesión, token de
// acción) sin pasar por su ruta normal de emisión — por ejemplo, para
// simular la reautenticación con Microsoft que el propio servidor no
// puede completar en un entorno de pruebas sin red real a Microsoft.
export const JWT_SECRET_PRUEBA = "llave-de-pruebas-automaticas-no-usar-en-produccion-nunca";

// Toda invitación de prueba usa este mismo código fijo (no hay nada
// adversarial que probar en el valor en sí — lo que importa es que
// /auth/registrar lo exija y lo compare contra el de la invitación).
export const TOKEN_INVITACION_PRUEBA = "token-de-prueba-fijo";

// psql/dropdb/createdb viven en la misma carpeta "bin" de PostgreSQL.
// Si esa carpeta no está en el PATH de la terminal donde se corre esto
// (típico en Windows), o si PostgreSQL exige un usuario/contraseña que
// no es el de quien abrió la terminal — mismo problema y misma
// solución que ya tienen scripts/respaldar-bd.js y
// scripts/prueba-de-carga.ts: buscar en las rutas conocidas de
// instalación, y probar la conexión tal cual antes de forzar
// PGUSER=postgres.
function candidatos(nombre: string): string[] {
  const candidatos = [nombre];
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      for (const version of readdirSync(base)) {
        candidatos.push(join(base, version, "bin", `${nombre}.exe`));
      }
    }
  } else {
    for (const prefijo of ["/opt/homebrew/opt", "/usr/local/opt"]) {
      if (!existsSync(prefijo)) continue;
      for (const carpeta of readdirSync(prefijo)) {
        if (carpeta.startsWith("postgresql")) candidatos.push(join(prefijo, carpeta, "bin", nombre));
      }
    }
  }
  return candidatos;
}

const encontrados = new Map<string, string>();

async function encontrarHerramienta(nombre: string): Promise<string> {
  if (encontrados.has(nombre)) return encontrados.get(nombre)!;
  for (const candidato of candidatos(nombre)) {
    try {
      await execFileAsync(candidato, ["--version"]);
      encontrados.set(nombre, candidato);
      return candidato;
    } catch {
      // no es este — se prueba el siguiente
    }
  }
  throw new Error(
    `No se encontró "${nombre}" (viene con PostgreSQL, junto a psql). ` +
      "Si PostgreSQL está instalado en una ruta distinta a la normal, agrega su carpeta bin al PATH e intenta de nuevo."
  );
}

let entornoResuelto: NodeJS.ProcessEnv | null = null;

async function resolverEntornoPostgres(): Promise<NodeJS.ProcessEnv> {
  if (entornoResuelto) return entornoResuelto;
  const ruta = await encontrarHerramienta("psql");
  const intentos: NodeJS.ProcessEnv[] = [
    { ...process.env, PGCONNECT_TIMEOUT: "5" },
    { ...process.env, PGUSER: "postgres", PGCONNECT_TIMEOUT: "5" },
  ];
  for (const env of intentos) {
    try {
      await execFileAsync(ruta, ["-d", "postgres", "-c", "select 1", "-w"], { env });
      entornoResuelto = env;
      return env;
    } catch {
      // no fue con este — se prueba el siguiente
    }
  }
  throw new Error(
    'No se pudo conectar a PostgreSQL (ni con el usuario actual, ni con "postgres"). ' +
      "Si PostgreSQL pide contraseña (la que se puso al instalarlo), defínela antes de correr esto, por ejemplo:\n" +
      '  set PGPASSWORD=tu-contraseña-de-postgres && npm test   (cmd de Windows)\n' +
      '  $env:PGPASSWORD="tu-contraseña-de-postgres"; npm test  (PowerShell)\n' +
      "Si el rol de PostgreSQL no se llama \"postgres\" en tu instalación, define también PGUSER."
  );
}

async function psql(args: string[]): Promise<string> {
  // "-q" además de "-t": sin esto, un INSERT/UPDATE ... RETURNING deja
  // el mensaje de "INSERT 0 1" pegado después del valor devuelto, no
  // solo espacio en blanco que un .trim() pudiera quitar — encontrado
  // corriendo la suite por primera vez.
  const ruta = await encontrarHerramienta("psql");
  const { stdout } = await execFileAsync(ruta, ["-q", ...args], { env: await resolverEntornoPostgres() });
  return stdout;
}

/** Crea la base de datos de pruebas desde cero, aplicando el esquema
 * real del proyecto — no una versión reducida. Segura de correr varias
 * veces: siempre borra lo que hubiera antes primero. */
export async function prepararBaseDeDatos(): Promise<void> {
  const env = await resolverEntornoPostgres();
  await execFileAsync(await encontrarHerramienta("dropdb"), ["--if-exists", DB_PRUEBA], { env });
  await execFileAsync(await encontrarHerramienta("createdb"), [DB_PRUEBA], { env });
  await psql(["-d", DB_PRUEBA, "-f", ESQUEMA]);
  await psql(["-d", DB_PRUEBA, "-c", `alter role finaquick_app password '${CONTRASENA_APP}';`]);
}

export async function borrarBaseDeDatos(): Promise<void> {
  await execFileAsync(await encontrarHerramienta("dropdb"), ["--if-exists", DB_PRUEBA], { env: await resolverEntornoPostgres() }).catch(() => {});
}

/** Corre una consulta directo contra la base de pruebas, como
 * superusuario — para preparar datos (invitaciones) o verificar el
 * resultado real de una prueba sin pasar por la API. */
export async function consultar(sql: string): Promise<string> {
  return psql(["-d", DB_PRUEBA, "-t", "-c", sql]);
}

/** Corre varios bloques de SQL EN PARALELO, cada uno en su propia
 * conexión/transacción — para probar de verdad condiciones de carrera
 * (dos sesiones reales entrelazándose), no solo simularlas en
 * secuencia. Cada bloque puede traer su propio BEGIN/COMMIT y
 * pg_sleep() para forzar un entrelazado exacto. No lanza si un bloque
 * falla (una excepción de PL/pgSQL, por ejemplo) — regresa `ok: false`
 * y el `stderr` para que la prueba misma decida qué esperaba. */
export async function consultarEnParalelo(
  bloques: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }[]> {
  const ruta = await encontrarHerramienta("psql");
  const env = await resolverEntornoPostgres();
  return Promise.all(
    bloques.map(async (sql) => {
      try {
        const { stdout, stderr } = await execFileAsync(ruta, ["-d", DB_PRUEBA, "-c", sql], { env });
        return { ok: true, stdout, stderr };
      } catch (error: any) {
        return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
      }
    })
  );
}

let procesoServidor: ChildProcess | null = null;

/** Arranca el servidor real (no una versión de prueba aparte) contra
 * la base de datos de pruebas, y espera a que /api/salud conteste bien
 * antes de seguir. */
export async function iniciarServidor(): Promise<void> {
  // node + la ruta real de tsx, no "npx tsx" — en Windows, spawn() sin
  // shell no resuelve "npx" (es un .cmd, no un .exe; solo cmd.exe lo
  // encuentra) y truena con "spawn npx ENOENT". require.resolve
  // encuentra la ruta real sin depender del PATH ni de una extensión
  // de archivo distinta según el sistema operativo.
  procesoServidor = spawn(process.execPath, [require.resolve("tsx/cli"), "src/index.ts"], {
    cwd: RAIZ_API,
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://finaquick_app:${CONTRASENA_APP}@localhost:5432/${DB_PRUEBA}`,
      DATABASE_URL_RESPALDO: `postgresql://finaquick_app:${CONTRASENA_APP}@localhost:5432/${DB_PRUEBA}`,
      JWT_SECRET: JWT_SECRET_PRUEBA,
      PORT: String(PUERTO_PRUEBA),
      ORIGEN_PERMITIDO: "http://localhost:5173",
      FRONTEND_URL: "http://localhost:5173",
    },
    stdio: "pipe",
  });
  procesoServidor.stderr?.on("data", () => {}); // silencia logs normales de la prueba
  for (let intento = 0; intento < 40; intento++) {
    try {
      const res = await fetch(`${URL_BASE}/salud`);
      if (res.ok) return;
    } catch {
      // el servidor todavía no abre el puerto — se reintenta
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("El servidor de pruebas no respondió a tiempo.");
}

export function detenerServidor(): void {
  procesoServidor?.kill();
  procesoServidor = null;
}

/** Cliente HTTP mínimo que recuerda la cookie httpOnly de sesión entre
 * peticiones, igual que haría un navegador real — sin esto, cada
 * llamada llegaría sin sesión, sin importar que ya se haya iniciado
 * sesión antes en la misma prueba. */
export function crearCliente() {
  let cookie = "";
  async function pedir(ruta: string, opciones: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(opciones.headers as Record<string, string> ?? {}) };
    if (cookie) headers["Cookie"] = cookie;
    const res = await fetch(`${URL_BASE}${ruta}`, { ...opciones, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  }
  async function pedirJson<T = any>(ruta: string, opciones: RequestInit = {}): Promise<{ status: number; cuerpo: T }> {
    const res = await pedir(ruta, opciones);
    const cuerpo = await res.json().catch(() => ({}));
    return { status: res.status, cuerpo: cuerpo as T };
  }
  // Para simular una sesión "copiada" (un JWT robado) que se sigue
  // usando desde OTRO cliente después de que la cuenta ya cambió de
  // contraseña — sin esto no hay forma de probar que esa copia deja de
  // servir, solo que el cliente original (que sí recibe la cookie
  // nueva) sigue con sesión.
  function copiarCookie(): string {
    return cookie;
  }
  function ponerCookie(valor: string): void {
    cookie = valor;
  }
  return { pedir, pedirJson, copiarCookie, ponerCookie };
}

/** Da de alta, directo en la base de datos, una organización con una
 * invitación de administrador lista — el mismo paso que hace el
 * instalador con el nombre/correo que se le da por consola, aquí
 * hecho en código para las pruebas. Regresa el id de la organización. */
export async function crearOrgConInvitacion(nombreOrg: string, correo: string, rol: "admin" | "finanzas" | "personal" = "admin"): Promise<string> {
  const salida = await consultar(
    `insert into organizations (nombre, color_primario) values ('${nombreOrg}', '#3a3a3a') returning id`
  );
  const orgId = salida.trim();
  await consultar(
    `insert into invitaciones (correo, org_id, rol, token) values ('${correo}', '${orgId}', '${rol}', '${TOKEN_INVITACION_PRUEBA}')`
  );
  return orgId;
}
