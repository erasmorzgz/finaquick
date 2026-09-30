import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Los roles pertenecen al servidor completo, no a una sola base de datos.
export function crearEsquemaPruebas(origen: string, alcance: "suite" | "carga") {
  const prefijo = `finaquick_test_${alcance}_${randomBytes(6).toString("hex")}`;
  const rolApp = `${prefijo}_app`;
  const rolRespaldo = `${prefijo}_respaldo`;
  const carpeta = mkdtempSync(join(tmpdir(), "finaquick-pruebas-"));
  const ruta = join(carpeta, "esquema.sql");
  const sql = readFileSync(origen, "utf8").replace(/\bfinaquick_app\b/g, rolApp).replace(/\bfinaquick_respaldo\b/g, rolRespaldo);
  writeFileSync(ruta, sql, { mode: 0o600 });
  return { ruta, rolApp, rolRespaldo, limpiar: () => rmSync(carpeta, { recursive: true, force: true }) };
}

export function urlDePruebas(env: NodeJS.ProcessEnv, rol: string, password: string, base: string) {
  const url = new URL(`postgresql://localhost/${base}`);
  const host = env.PGHOST || "localhost";
  if (host.startsWith("/")) url.searchParams.set("host", host);
  else url.hostname = host;
  url.port = env.PGPORT || "5432";
  url.username = rol;
  url.password = password;
  return url.toString();
}
