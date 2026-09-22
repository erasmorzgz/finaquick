// Registro de eventos del servidor (logging) — sin esto, un error solo
// vive en la terminal mientras esa ventana esté abierta; en cuanto se
// cierra (o el servidor corre como servicio, sin ventana visible), se
// pierde para siempre y nadie puede saber qué pasó después de que algo
// falló. Escribe a un archivo por día (además de seguir mostrándolo en
// consola, igual que antes) y borra los archivos más viejos que el
// límite, para no llenar el disco poco a poco para siempre — mismo
// patrón que respaldar-bd.js con los respaldos.
import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARPETA_LOGS = join(__dirname, "..", "logs");
const DIAS_A_CONSERVAR = 30;

function archivoDeHoy(): string {
  const hoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(CARPETA_LOGS, `finaquick_${hoy}.log`);
}

// Red de seguridad: si algún error alguna vez trae una cadena de
// conexión de por medio (postgresql://usuario:contraseña@host/bd —
// confirmado que pasa de verdad con pg_dump, ver scripts/respaldar-bd.js),
// la contraseña nunca debe llegar ni a la consola ni al archivo. Se
// aplica siempre, aunque hoy ningún camino conocido del servidor en sí
// lo necesite — más vale que quede aquí desde ahora que confiar en
// que nadie lo vuelva a introducir sin darse cuenta.
function ocultarContrasenas(texto: string): string {
  // Greedy a propósito: si la contraseña misma trae una "@" (alguien
  // la puso a mano, no las que este proyecto genera solas — esas son
  // hex puro, nunca llevan "@"), esto igual encuentra la "@" real que
  // separa la contraseña del host, no la primera que aparece.
  return texto.replace(/(:\/\/[^:@/\s]+:)[^/\s]+@/g, "$1[oculto]@");
}

function escribir(nivel: "INFO" | "ERROR", mensaje: string, detalle?: unknown) {
  const detalleTexto = detalle !== undefined ? (detalle instanceof Error ? detalle.stack ?? detalle.message : String(detalle)) : undefined;
  const completo = ocultarContrasenas(mensaje + (detalleTexto !== undefined ? " — " + detalleTexto : ""));
  const linea = `[${new Date().toISOString()}] [${nivel}] ${completo}\n`;

  // La consola sigue mostrando lo mismo que antes (útil corriendo
  // "npm run dev" a mano) — el archivo es lo que sobrevive después.
  // Un solo string ya redactado, no dos argumentos separados — así la
  // consola nunca muestra el detalle "crudo" sin pasar por el filtro.
  if (nivel === "ERROR") console.error(completo); // eslint-disable-line no-console
  else console.log(completo); // eslint-disable-line no-console

  try {
    if (!existsSync(CARPETA_LOGS)) mkdirSync(CARPETA_LOGS, { recursive: true });
    appendFileSync(archivoDeHoy(), linea);
  } catch {
    // Si ni siquiera se puede escribir el log (disco lleno, permisos),
    // no tiene sentido tronar el servidor por eso — ya se mostró en
    // consola arriba, que es lo mínimo indispensable.
  }
}

export function info(mensaje: string) {
  escribir("INFO", mensaje);
}

export function error(mensaje: string, detalle?: unknown) {
  escribir("ERROR", mensaje, detalle);
}

/** Borra archivos de log más viejos que DIAS_A_CONSERVAR — se llama
 * una vez al arrancar el servidor, no en cada línea escrita. */
export function limpiarLogsViejos() {
  try {
    if (!existsSync(CARPETA_LOGS)) return;
    const limite = Date.now() - DIAS_A_CONSERVAR * 24 * 60 * 60 * 1000;
    for (const archivo of readdirSync(CARPETA_LOGS)) {
      if (!archivo.startsWith("finaquick_") || !archivo.endsWith(".log")) continue;
      const fecha = archivo.slice("finaquick_".length, -".log".length);
      if (new Date(fecha).getTime() < limite) unlinkSync(join(CARPETA_LOGS, archivo));
    }
  } catch {
    // No es crítico — si falla, simplemente se acumulan unos días de
    // más, no rompe nada del funcionamiento del servidor.
  }
}
