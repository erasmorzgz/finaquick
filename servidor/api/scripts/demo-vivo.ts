// Genera actividad real y visible en tu propia base de datos local
// (no en una aparte, a diferencia de scripts/prueba-de-carga.ts): unas
// cuantas cuentas de "personal" de verdad, que de vez en cuando crean
// un folio contra el servidor real que ya tienes corriendo — para que
// se vean en "Usuarios" y en "Actividad" mientras tú mismo usas la
// app, sin que compita fuerte por el procesador ni te saque de tu
// sesión (a diferencia de correr la prueba de carga al mismo tiempo).
//
// Uso (con el servidor real ya corriendo, por ejemplo vía
// "Iniciar Finaquick"):
//   cd servidor/api
//   npm run demo:vivo
//
// Necesita que YA exista una organización, un administrador, y al
// menos un servicio con una categoría — si nunca corriste
// `npm run demo`, hazlo primero (o crea un servicio y una categoría a
// mano desde la app).
//
// Se puede ajustar:
//   PERSONAS=12 INTERVALO_SEG=15 npm run demo:vivo
// - PERSONAS (default 8, máximo 14 — el tamaño de la lista de
//   nombres): cuántas cuentas de demo. La mayoría queda con rol
//   "personal"; de cada 4, una queda como "finanzas" — para que
//   Usuarios se vea con la mezcla de roles de un equipo real, no todos
//   idénticos.
// - INTERVALO_SEG (default 10): cada cuánto, en promedio, UNA de esas
//   personas hace algo — no todas a la vez, para que se vea como uso
//   real, no una ráfaga.
// - API_URL (default http://localhost:4000/api): a qué servidor
//   conectarse — el real que ya tienes corriendo, no uno aparte.
//
// La actividad no es solo "crear folios" — igual que el tráfico mixto
// de prueba-de-carga.ts, también hay quien solo revisa el historial,
// busca un folio, o mira el panel financiero — así se ve más como uso
// real de la app completa, no una sola pantalla repitiéndose.
//
// Se detiene con Ctrl+C, en cualquier momento — no borra nada al
// salir: a diferencia de prueba-de-carga.ts, aquí el punto es que los
// datos se queden, para que se vean después. Los folios que crea
// llevan el nombre con el prefijo "Demo — ", igual que los de
// datos_demo.sql, para poder identificarlos (y borrarlos, si algún día
// hace falta) fácilmente.
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const URL_BASE = process.env.API_URL || "http://localhost:4000/api";
const PASSWORD_DEMO = "DemoEnVivo123!";
const TOKEN_DEMO = "token-de-demo-en-vivo";
const PREFIJO_FOLIO = "Demo — ";

const NOMBRES = [
  "Ana Martínez", "Carlos Hernández", "Sofía Ramírez", "Luis Torres",
  "María González", "Jorge Sánchez", "Valentina Cruz", "Diego Flores",
  "Fernanda Castillo", "Roberto Aguilar", "Isabel Navarro", "Patricio Domínguez",
  "Lucía Fuentes", "Emiliano Rojas",
];

const PERSONAS = Math.min(Number(process.env.PERSONAS) || 8, NOMBRES.length);
const INTERVALO_SEG = Number(process.env.INTERVALO_SEG) || 10;

const PACIENTES = [
  "Fernanda López", "Ricardo Morales", "Camila Ortiz", "Andrés Reyes",
  "Paola Jiménez", "Miguel Vargas", "Daniela Castro", "Emilio Ríos",
  "Renata Guzmán", "Sebastián Mora",
];

// Mismo buscador que ya usan scripts/respaldar-bd.js y
// scripts/cargar-demo.js para psql — no todas las instalaciones de
// PostgreSQL agregan su carpeta bin al PATH por sí solas.
function candidatosPsql() {
  const candidatos = ["psql"];
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      for (const version of readdirSync(base)) candidatos.push(join(base, version, "bin", "psql.exe"));
    }
  } else {
    for (const prefijo of ["/opt/homebrew/opt", "/usr/local/opt"]) {
      if (!existsSync(prefijo)) continue;
      for (const carpeta of readdirSync(prefijo)) {
        if (carpeta.startsWith("postgresql")) candidatos.push(join(prefijo, carpeta, "bin", "psql"));
      }
    }
  }
  return candidatos;
}

async function encontrarPsql(): Promise<string> {
  for (const candidato of candidatosPsql()) {
    try {
      await execFileAsync(candidato, ["--version"]);
      return candidato;
    } catch {
      // no es este — se prueba el siguiente
    }
  }
  throw new Error(
    "No se encontró psql (viene con PostgreSQL). Si está instalado en una " +
      "ruta distinta a la normal, agrega su carpeta bin al PATH e intenta de nuevo."
  );
}

// En Windows, el usuario que abrió la terminal casi nunca es un rol
// válido de PostgreSQL — mismo problema y misma solución que ya tienen
// prueba-de-carga.ts, test/helpers.ts y cargar-demo.js: probar la
// conexión tal cual primero, y si falla, forzar PGUSER=postgres.
async function resolverEntornoPostgres(psql: string): Promise<NodeJS.ProcessEnv> {
  // PGCLIENTENCODING fuerza que psql hable UTF-8 con el servidor sin
  // importar qué locale tenga la consola de Windows — sin esto, un
  // nombre con acento podía llegar bien desde el archivo temporal (ver
  // consultar() más abajo) pero psql lo reinterpretaba mal de todos
  // modos si el "code page" activo de esa consola no era UTF-8.
  const intentos: NodeJS.ProcessEnv[] = [
    { ...process.env, PGCONNECT_TIMEOUT: "5", PGCLIENTENCODING: "UTF8" },
    { ...process.env, PGUSER: "postgres", PGCONNECT_TIMEOUT: "5", PGCLIENTENCODING: "UTF8" },
  ];
  for (const env of intentos) {
    try {
      await execFileAsync(psql, ["-d", "postgres", "-c", "select 1", "-w"], { env });
      return env;
    } catch {
      // no fue con este — se prueba el siguiente
    }
  }
  throw new Error(
    'No se pudo conectar a PostgreSQL (ni con el usuario actual, ni con "postgres"). ' +
      "Si PostgreSQL pide contraseña, defínela antes de correr esto, por ejemplo:\n" +
      "  set PGPASSWORD=tu-contraseña-de-postgres && npm run demo:vivo   (cmd de Windows)\n" +
      '  $env:PGPASSWORD="tu-contraseña-de-postgres"; npm run demo:vivo  (PowerShell)\n' +
      "Si el rol de PostgreSQL no se llama \"postgres\" en tu instalación, define también PGUSER."
  );
}

const NOMBRE_BD = process.argv[2] || "finaquick_local";

// El SQL se manda por archivo ("-f"), no como argumento de línea de
// comandos ("-c") — en Windows, un nombre con acento (Martínez,
// Sofía...) pasado como argumento se corrompe antes de que psql lo
// vea (Windows usa el "code page" activo de la consola para convertir
// los argumentos, casi nunca UTF-8) y termina con un error de
// "secuencia de bytes no válida para UTF8". Escribir el archivo con
// Node (que sí respeta UTF-8 real) y que psql lo LEA evita ese punto
// de conversión por completo — encontrado corriendo esto de verdad en
// Windows con nombres reales que llevan acento.
async function consultar(psql: string, env: NodeJS.ProcessEnv, sql: string): Promise<string> {
  const archivo = join(tmpdir(), `finaquick-demo-vivo-${randomUUID()}.sql`);
  writeFileSync(archivo, sql, "utf-8");
  try {
    const { stdout } = await execFileAsync(psql, ["-q", "-t", "-A", "-d", NOMBRE_BD, "-f", archivo], { env });
    return stdout.trim();
  } finally {
    rmSync(archivo, { force: true });
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crearCliente() {
  let cookie = "";
  async function pedirJson<T = any>(ruta: string, opciones: RequestInit = {}): Promise<{ status: number; cuerpo: T }> {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(opciones.headers as Record<string, string> ?? {}) };
    if (cookie) headers["Cookie"] = cookie;
    const res = await fetch(`${URL_BASE}${ruta}`, { ...opciones, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const cuerpo = await res.json().catch(() => ({}));
    return { status: res.status, cuerpo: cuerpo as T };
  }
  return { pedirJson };
}

let detenerAhora = false;
let segundoCtrlC = false;
process.on("SIGINT", () => {
  if (segundoCtrlC) {
    console.log("\nSegundo Ctrl+C — saliendo de inmediato.");
    process.exit(130);
  }
  segundoCtrlC = true;
  detenerAhora = true;
  console.log("\nCtrl+C recibido — terminando después de la acción en curso (Ctrl+C otra vez para salir de golpe)...");
});

function horaActual(): string {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function main() {
  const psql = await encontrarPsql();
  const env = await resolverEntornoPostgres(psql);

  const orgId = await consultar(psql, env, "select id from organizations order by nombre limit 1");
  if (!orgId) throw new Error("No hay ninguna organización todavía — crea una primero desde la app.");

  const admins = await consultar(psql, env, "select count(*) from profiles where rol = 'admin'");
  if (admins === "0") throw new Error("Todavía no existe ninguna cuenta de admin — regístrate primero en la app.");

  const servicioId = await consultar(psql, env, `select id from services where org_id = '${orgId}' order by nombre limit 1`);
  if (!servicioId) {
    throw new Error(
      "Esta organización todavía no tiene ningún servicio — corre `npm run demo` primero " +
        "(carga servicios y categorías de ejemplo), o crea uno a mano desde Configuración → Servicios."
    );
  }
  const categoria = await consultar(psql, env, `select nombre from categorias where service_id = '${servicioId}' order by nombre limit 1`);
  if (!categoria) {
    throw new Error(
      "Ese servicio todavía no tiene ninguna categoría — corre `npm run demo` primero, " +
        "o crea una a mano desde Configuración → Catálogo."
    );
  }

  console.log(`Preparando ${PERSONAS} cuentas de demo (si ya existen de una corrida anterior, se reusan)...`);
  const personas = NOMBRES.slice(0, PERSONAS);
  const clientes: { nombre: string; cliente: ReturnType<typeof crearCliente> }[] = [];
  for (let i = 0; i < personas.length; i++) {
    const nombre = personas[i];
    const correo = `demo-vivo-${i + 1}@finaquick.demo`;
    // De cada 4 personas, una queda con rol "finanzas" — para que
    // Usuarios se vea con la mezcla de un equipo real, no todos con la
    // misma etiqueta. El resto, "personal" — ninguna es "admin" nueva,
    // para no confundirse con el administrador real de la cuenta.
    const rol = i % 4 === 3 ? "finanzas" : "personal";
    const yaExiste = await consultar(psql, env, `select count(*) from profiles where correo = '${correo}'`);
    if (yaExiste === "0") {
      await consultar(
        psql,
        env,
        `insert into invitaciones (correo, org_id, rol, servicio_ids, token) values ('${correo}', '${orgId}', '${rol}', array['${servicioId}']::uuid[], '${TOKEN_DEMO}')`
      );
      // Mismo costo (12) que usa bcryptjs en el resto de la app — pgcrypto
      // genera un hash bcrypt real y compatible, solo que calculado del
      // lado de la base de datos en vez de en Node.
      const hash = await consultar(psql, env, `select crypt('${PASSWORD_DEMO}', gen_salt('bf', 12))`);
      await consultar(psql, env, `select registrar_usuario('${nombre}', '${correo}', '${hash}', '${TOKEN_DEMO}')`);
    }
    const cliente = crearCliente();
    const { status, cuerpo } = await cliente.pedirJson("/auth/login", {
      method: "POST",
      body: JSON.stringify({ correo, password: PASSWORD_DEMO }),
    });
    if (status !== 200) throw new Error(`No se pudo iniciar sesión como ${nombre} (${correo}): ${JSON.stringify(cuerpo)}`);
    clientes.push({ nombre, cliente });
  }

  console.log(`Listo — ${clientes.length} personas conectadas contra ${URL_BASE}.`);
  console.log(`Generando una acción cada ~${INTERVALO_SEG}s. Ctrl+C para detener cuando quieras.\n`);

  let folios = 0;
  while (!detenerAhora) {
    const espera = INTERVALO_SEG * 1000 * (0.5 + Math.random());
    await esperar(espera);
    if (detenerAhora) break;

    const persona = clientes[Math.floor(Math.random() * clientes.length)];
    const dado = Math.random();
    try {
      if (dado < 0.45) {
        const paciente = PACIENTES[Math.floor(Math.random() * PACIENTES.length)];
        const enCredito = Math.random() < 0.25;
        const { status, cuerpo } = await persona.cliente.pedirJson<{ folio?: string }>("/tickets", {
          method: "POST",
          body: JSON.stringify({
            nombre: `${PREFIJO_FOLIO}${paciente}`,
            tipoUsuario: "Externo",
            categoria,
            estado: enCredito ? "credito" : "pagado",
            formaPago: enCredito ? undefined : "Efectivo",
            servicioId,
            procedimientoIds: [],
          }),
        });
        if (status === 200) {
          folios++;
          console.log(`[${horaActual()}] ${persona.nombre} generó el folio ${cuerpo.folio ?? ""} (${paciente})`);
        } else {
          console.log(`[${horaActual()}] ${persona.nombre} intentó generar un folio y falló: ${JSON.stringify(cuerpo)}`);
        }
      } else if (dado < 0.65) {
        await persona.cliente.pedirJson(`/tickets?servicioId=${servicioId}`);
        console.log(`[${horaActual()}] ${persona.nombre} revisó el historial de folios`);
      } else if (dado < 0.8) {
        await persona.cliente.pedirJson(`/finanzas/ingresos-mensuales?orgId=${orgId}`);
        console.log(`[${horaActual()}] ${persona.nombre} consultó el panel financiero`);
      } else if (dado < 0.9) {
        await persona.cliente.pedirJson(`/buscar-folio?orgId=${orgId}&q=F2`);
        console.log(`[${horaActual()}] ${persona.nombre} buscó un folio`);
      } else {
        await persona.cliente.pedirJson(`/categorias?servicioId=${servicioId}`);
        console.log(`[${horaActual()}] ${persona.nombre} revisó el catálogo`);
      }
    } catch (error) {
      console.log(`[${horaActual()}] ${persona.nombre}: error de red (¿sigue corriendo el servidor real?) — ${error}`);
    }
  }

  console.log(`\nDetenido. Se generaron ${folios} folios de demo durante esta corrida.`);
  console.log(
    `Los folios llevan "${PREFIJO_FOLIO}" al inicio del nombre — para quitarlos más adelante, ` +
      `borra desde la base de datos cualquier fila de "tickets" cuyo nombre empiece así (mismo criterio ` +
      `que los folios de datos_demo.sql, con prefijo "DEMO-").`
  );
}

main().catch((error) => {
  console.error("\nNo se pudo correr la actividad de demo:", error.message ?? error);
  process.exit(1);
});
