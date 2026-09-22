// Genera un respaldo completo de la base de datos (pg_dump) — todo:
// usuarios, folios, organizaciones, todo — en un solo archivo que se
// puede restaurar completo si algo le pasa al servidor.
//
// Uso manual:      npm run respaldar   (desde servidor/api)
// Uso programado:  ver LOCAL_SETUP.md, sección de respaldos — se deja
//                   corriendo solo, todos los días, sin que nadie
//                   tenga que acordarse de hacerlo a mano.
//
// Guarda varios respaldos con fecha (no solo el último) por si el
// problema se detecta tarde, y borra los más viejos que ya pasaron
// del límite (RESPALDOS_A_CONSERVAR) para no llenar el disco poco a
// poco para siempre.
import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CARPETA_RESPALDOS = join(__dirname, "..", "respaldos");
const CARPETA_LOGS = join(__dirname, "..", "logs");
const RESPALDOS_A_CONSERVAR = 14; // ~2 semanas si se corre uno por día

// pg_dump falla trayendo la CONEXIÓN COMPLETA en su propio mensaje de
// error (Node arma "Command failed: pg_dump postgresql://usuario:LA-
// CONTRASEÑA-REAL@host/bd ..." con la línea de comando entera) —
// confirmado probándolo aparte. Sin esto, cualquier falla de pg_dump
// (contraseña rotada, red caída, disco lleno, lo que sea) habría
// dejado la contraseña real de la base de datos en texto plano,
// escrita en un archivo de log que se guarda 30 días. Se quita antes
// de que el mensaje llegue a consola o al archivo — nunca después.
function ocultarContrasenas(texto) {
  // Greedy a propósito: si la contraseña misma trae una "@" (alguien
  // la puso a mano, no las que este proyecto genera solas — esas son
  // hex puro, nunca llevan "@"), esto igual encuentra la "@" real que
  // separa la contraseña del host, no la primera que aparece.
  return String(texto).replace(/(:\/\/[^:@/\s]+:)[^/\s]+@/g, "$1[oculto]@");
}

// Un logger propio y chiquito en vez de importar el del servidor
// (src/registro.ts) — ese solo existe compilado en dist/ después de
// "npm run build", y este script corre directo con node, sin
// necesitar compilar nada primero. Escribe al MISMO archivo de log
// que usa el servidor, para que todo quede en un solo lugar sin
// importar quién lo escribió.
function registrar(nivel, mensajeCrudo) {
  const mensaje = ocultarContrasenas(mensajeCrudo);
  const linea = `[${new Date().toISOString()}] [${nivel}] [respaldo] ${mensaje}\n`;
  if (nivel === "ERROR") console.error(mensaje); // eslint-disable-line no-console
  else console.log(mensaje); // eslint-disable-line no-console
  try {
    if (!existsSync(CARPETA_LOGS)) mkdirSync(CARPETA_LOGS, { recursive: true });
    appendFileSync(join(CARPETA_LOGS, `finaquick_${new Date().toISOString().slice(0, 10)}.log`), linea);
  } catch {
    // igual que en el servidor: si ni el log se puede escribir, no
    // tiene sentido tronar por eso — ya se mostró en consola arriba.
  }
}

// pg_dump vive en la misma carpeta que psql/createdb — si no está en
// el PATH normal (típico con Homebrew en Mac si no se abrió antes
// vía el launcher, que sí ajusta el PATH), se busca en las mismas
// rutas conocidas que ya usan los launchers, sin una lista fija de
// versiones — para no repetir el problema que ya tuvimos con
// versiones nuevas de PostgreSQL no reconocidas.
function candidatosPgDump() {
  const candidatos = ["pg_dump"];
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      for (const version of readdirSync(base)) {
        candidatos.push(join(base, version, "bin", "pg_dump.exe"));
      }
    }
  } else {
    for (const prefijo of ["/opt/homebrew/opt", "/usr/local/opt"]) {
      if (!existsSync(prefijo)) continue;
      for (const carpeta of readdirSync(prefijo)) {
        if (carpeta.startsWith("postgresql")) candidatos.push(join(prefijo, carpeta, "bin", "pg_dump"));
      }
    }
  }
  return candidatos;
}

async function encontrarPgDump() {
  for (const candidato of candidatosPgDump()) {
    try {
      await execFileAsync(candidato, ["--version"]);
      return candidato;
    } catch {
      // no es este — se prueba el siguiente
    }
  }
  return null;
}

function nombreArchivo() {
  const ahora = new Date();
  const parte = (n) => String(n).padStart(2, "0");
  const fecha = `${ahora.getFullYear()}-${parte(ahora.getMonth() + 1)}-${parte(ahora.getDate())}`;
  const hora = `${parte(ahora.getHours())}-${parte(ahora.getMinutes())}-${parte(ahora.getSeconds())}`;
  return `finaquick_${fecha}_${hora}.sql`;
}

function borrarRespaldosViejos() {
  const archivos = readdirSync(CARPETA_RESPALDOS)
    .filter((f) => f.startsWith("finaquick_") && f.endsWith(".sql"))
    .map((f) => ({ nombre: f, ruta: join(CARPETA_RESPALDOS, f), tiempo: statSync(join(CARPETA_RESPALDOS, f)).mtimeMs }))
    .sort((a, b) => b.tiempo - a.tiempo); // más reciente primero

  for (const viejo of archivos.slice(RESPALDOS_A_CONSERVAR)) {
    unlinkSync(viejo.ruta);
    registrar("INFO", `Respaldo viejo eliminado (ya había ${RESPALDOS_A_CONSERVAR} más recientes): ${viejo.nombre}`);
  }
}

async function main() {
  // A propósito NO usa DATABASE_URL (el rol normal de la app,
  // finaquick_app) — ese rol tiene RLS de por medio y no puede ver
  // todo (ni siquiera un administrador ve los archivos enviados de
  // otras personas, por diseño) — un respaldo con RLS de por medio
  // quedaría incompleto sin que nadie se diera cuenta hasta el día
  // que hiciera falta restaurarlo. finaquick_respaldo tiene BYPASSRLS
  // — ve todo, y solo para esto (ver servidor/esquema_local.sql).
  if (!process.env.DATABASE_URL_RESPALDO) {
    registrar(
      "ERROR",
      "Falta DATABASE_URL_RESPALDO en servidor/api/.env — copia .env.example y complétalo " +
        "(o vuelve a correr el launcher, que lo genera solo)."
    );
    process.exit(1);
  }

  const pgDump = await encontrarPgDump();
  if (!pgDump) {
    registrar(
      "ERROR",
      "No se encontró pg_dump (viene con PostgreSQL, junto a psql). " +
        "Si PostgreSQL está instalado en una ruta distinta a la normal, agrega su carpeta bin al PATH e intenta de nuevo."
    );
    process.exit(1);
  }

  if (!existsSync(CARPETA_RESPALDOS)) mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  const ruta = join(CARPETA_RESPALDOS, nombreArchivo());

  try {
    // --clean: el archivo generado incluye "drop table/función..." antes
    // de cada "create", para que restaurarlo sobre una base ya usada
    // reemplace todo en vez de tronar por "ya existe".
    await execFileAsync(pgDump, [process.env.DATABASE_URL_RESPALDO, "--clean", "--if-exists", "-f", ruta]);
    registrar("INFO", `Respaldo creado: ${ruta}`);
    borrarRespaldosViejos();
  } catch (error) {
    registrar("ERROR", `No se pudo generar el respaldo: ${error.message}`);
    process.exit(1);
  }
}

main();
