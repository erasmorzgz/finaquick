// Carga servicios, catálogo y folios de ejemplo (servidor/datos_demo.sql)
// para poder mostrar la app funcionando sin escribir todo a mano —
// pensado para revisión/demostración, no para una instalación que ya
// tenga datos reales.
//
// Uso:  npm run demo   (desde servidor/api, DESPUÉS de registrar la
//                        primera cuenta de administrador en la app —
//                        el script necesita que ya exista esa cuenta y
//                        su organización).
//
// A propósito NO se conecta con DATABASE_URL (el rol de la app,
// finaquick_app): ese rol corre con seguridad por fila FORZADA, y
// psql no pone la variable de sesión (app.usuario_actual) que esas
// políticas necesitan — casi todos los INSERT de datos_demo.sql
// quedarían bloqueados en silencio. Se conecta igual que el propio
// instalador arma la primera invitación: con el usuario del sistema
// (el superusuario normal de una instalación de Homebrew), que no
// tiene ese candado.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RUTA_DATOS_DEMO = join(__dirname, "..", "..", "datos_demo.sql");

// El nombre de base de datos que usan los dos instaladores
// ("Iniciar Finaquick.command" / ".bat") siempre es este — se usa
// como valor por default. Si alguien instaló a mano con otro nombre,
// puede pasarlo como argumento: node scripts/cargar-demo.js otra_bd
const NOMBRE_BD = process.argv[2] || "finaquick_local";

// Mismo buscador que ya usa respaldar-bd.js para pg_dump, adaptado a
// psql — no todas las instalaciones de PostgreSQL (Homebrew, sobre
// todo) agregan su carpeta bin al PATH por sí solas.
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

async function encontrarPsql() {
  for (const candidato of candidatosPsql()) {
    try {
      await execFileAsync(candidato, ["--version"]);
      return candidato;
    } catch {
      // no es este — se prueba el siguiente
    }
  }
  return null;
}

// En Windows, el usuario que abrió la terminal casi nunca es un rol
// válido de PostgreSQL (a diferencia de Homebrew en Mac, donde SÍ lo
// es) — psql se queda pidiendo una contraseña que nunca va a
// funcionar. Mismo problema y misma solución que ya tienen
// scripts/prueba-de-carga.ts y test/helpers.ts: probar la conexión tal
// cual primero, y si falla, forzar PGUSER=postgres antes de rendirse.
async function resolverEntornoPostgres(psql) {
  const intentos = [
    { ...process.env, PGCONNECT_TIMEOUT: "5" },
    { ...process.env, PGUSER: "postgres", PGCONNECT_TIMEOUT: "5" },
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
      "Si PostgreSQL pide contraseña (la que se puso al instalarlo), defínela antes de correr esto, por ejemplo:\n" +
      '  set PGPASSWORD=tu-contraseña-de-postgres && npm run demo   (cmd de Windows)\n' +
      '  $env:PGPASSWORD="tu-contraseña-de-postgres"; npm run demo  (PowerShell)\n' +
      "Si el rol de PostgreSQL no se llama \"postgres\" en tu instalación, define también PGUSER."
  );
}

async function main() {
  if (!existsSync(RUTA_DATOS_DEMO)) {
    console.error(`No se encontró ${RUTA_DATOS_DEMO} — ¿se corrió esto desde servidor/api?`); // eslint-disable-line no-console
    process.exit(1);
  }
  const psql = await encontrarPsql();
  if (!psql) {
    console.error( // eslint-disable-line no-console
      "No se encontró psql (viene con PostgreSQL). Si está instalado en una " +
        "ruta distinta a la normal, agrega su carpeta bin al PATH e intenta de nuevo."
    );
    process.exit(1);
  }
  let env;
  try {
    env = await resolverEntornoPostgres(psql);
  } catch (error) {
    console.error(error.message); // eslint-disable-line no-console
    process.exit(1);
  }
  try {
    // "-v ON_ERROR_STOP=1": sin esto, psql imprime un error de SQL (por
    // ejemplo, "regístrate primero en la app") en stderr pero SIGUE, y
    // termina con código de salida 0 como si nada hubiera pasado —
    // encontrado corriendo esto mismo contra una base sin admin
    // todavía: el script decía "Listo" a pesar del error real de
    // arriba.
    const { stdout, stderr } = await execFileAsync(psql, ["-v", "ON_ERROR_STOP=1", "-d", NOMBRE_BD, "-f", RUTA_DATOS_DEMO], { env });
    if (stdout.trim()) console.log(stdout.trim()); // eslint-disable-line no-console
    if (stderr.trim()) console.error(stderr.trim()); // eslint-disable-line no-console
    console.log(`\nListo — datos de ejemplo cargados en "${NOMBRE_BD}". Recarga la app para verlos.`); // eslint-disable-line no-console
  } catch (error) {
    // El mensaje de la propia base (por ejemplo "regístrate primero en
    // la app") ya viene claro en error.stderr — no hace falta
    // envolverlo en otro genérico.
    console.error(error.stderr?.trim() || error.message); // eslint-disable-line no-console
    process.exit(1);
  }
}

main();
