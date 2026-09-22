// Prueba de carga: simula varios usuarios reales usando el sistema al
// mismo tiempo, contra el servidor y la base de datos reales (mismo
// esquema, mismas políticas de seguridad por fila) — no un mock, no
// una versión reducida. Sin dependencias nuevas: solo `fetch` nativo
// de Node y el mismo patrón de arranque de servidor que usa la suite
// de pruebas (test/helpers.ts).
//
// Uso:
//   npm run carga
//   USUARIOS=60 DURACION_SEG=30 npm run carga
//
// Para dejarla corriendo el tiempo que uno quiera, en vez de un
// número fijo de segundos, se pone un DURACION_SEG grande y se corta
// con Ctrl+C cuando ya no haga falta, por ejemplo:
//   DURACION_SEG=999999 USUARIOS=20 npm run carga
//
// Se puede detener en cualquier momento con Ctrl+C — no deja nada a
// medias: termina el tráfico en curso, apaga el servidor de prueba y
// borra la base de datos temporal antes de salir, e imprime el reporte
// de lo que sí alcanzó a medir (no espera a que se acabe DURACION_SEG
// para eso). Presionar Ctrl+C una segunda vez fuerza una salida
// inmediata, sin ese aseo, por si el primero se queda pegado.
//
// Qué mide, en dos partes:
//
// 1. Tráfico mixto sostenido — USUARIOS personas ya con sesión iniciada,
//    cada una viendo folios, el panel financiero, buscando, y generando
//    folios nuevos al mismo tiempo durante DURACION_SEG segundos. Esto
//    es el uso normal de un campus: varias personas de un mismo
//    servicio trabajando a la vez.
//
// 2. Ráfaga de inicios de sesión simultáneos — RAFAGA_LOGINS cuentas
//    reales iniciando sesión en el mismo instante (el caso real: todo
//    el personal entrando a la vez al empezar el turno). El hash de
//    contraseña (bcrypt, costo 12) es intencionalmente lento — es lo
//    que hace que adivinar contraseñas por fuerza bruta sea
//    impráctico — así que esta parte mide específicamente cuánto
//    cuesta esa protección cuando mucha gente entra al mismo tiempo,
//    no un error.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const USUARIOS = Number(process.env.USUARIOS) || 30;
const DURACION_SEG = Number(process.env.DURACION_SEG) || 20;
const RAFAGA_LOGINS = Number(process.env.RAFAGA_LOGINS) || 25;

const DB_CARGA = "finaquick_prueba_de_carga";
const PUERTO_CARGA = 4098;
const URL_BASE = `http://localhost:${PUERTO_CARGA}/api`;
const CONTRASENA_APP = "prueba_de_carga_pw_2026";
const PASSWORD_USUARIOS = "ClaveDePrueba123!";

// psql/dropdb/createdb viven en la misma carpeta "bin" de PostgreSQL.
// Si esa carpeta no está en el PATH de la terminal donde se corre esto
// (típico en Windows si no se abrió antes vía el instalador, que sí
// ajusta el PATH solo para su propia ventana) — mismo problema y misma
// solución que ya tiene scripts/respaldar-bd.js para pg_dump: buscar
// en las rutas conocidas de instalación, sin fijar una versión exacta.
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

// Cómo conectarse a PostgreSQL para dropdb/createdb/psql — se resuelve
// una sola vez, probando en el mismo orden que ya usa "Iniciar
// Finaquick.bat" para este mismo problema exacto (ver ahí, sección de
// preparar la base de datos): (1) tal cual, sin tocar nada — así es
// como ya funciona en Mac con Homebrew, donde el usuario del sistema
// operativo ES el superusuario de PostgreSQL; (2) forzando PGUSER=
// postgres, típico en Windows, donde el usuario de PostgreSQL nunca es
// el de Windows que abrió la terminal. Si ninguna de las dos conecta,
// probablemente hace falta PGPASSWORD — este script no la pide de
// forma interactiva (a diferencia del instalador), así que solo puede
// darlo por env var.
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
      '  set PGPASSWORD=tu-contraseña-de-postgres && npm run carga   (cmd de Windows)\n' +
      '  $env:PGPASSWORD="tu-contraseña-de-postgres"; npm run carga  (PowerShell)\n' +
      "Si el rol de PostgreSQL no se llama \"postgres\" en tu instalación, define también PGUSER."
  );
}

async function psql(args: string[]): Promise<string> {
  const ruta = await encontrarHerramienta("psql");
  const { stdout } = await execFileAsync(ruta, ["-q", ...args], { env: await resolverEntornoPostgres() });
  return stdout;
}

async function prepararBaseDeDatos(): Promise<void> {
  const env = await resolverEntornoPostgres();
  await execFileAsync(await encontrarHerramienta("dropdb"), ["--if-exists", DB_CARGA], { env });
  await execFileAsync(await encontrarHerramienta("createdb"), [DB_CARGA], { env });
  await psql(["-d", DB_CARGA, "-f", "../esquema_local.sql"]);
  await psql(["-d", DB_CARGA, "-c", `alter role finaquick_app password '${CONTRASENA_APP}';`]);
}

async function borrarBaseDeDatos(): Promise<void> {
  await execFileAsync(await encontrarHerramienta("dropdb"), ["--if-exists", DB_CARGA], { env: await resolverEntornoPostgres() }).catch(() => {});
}

async function consultar(sql: string): Promise<string> {
  return psql(["-d", DB_CARGA, "-t", "-c", sql]);
}

let procesoServidor: ChildProcess | null = null;

async function iniciarServidor(): Promise<void> {
  // node + la ruta real de tsx, no "npx tsx" — en Windows, spawn() sin
  // shell no resuelve "npx" (es un .cmd, no un .exe; Windows solo lo
  // encuentra pasando por cmd.exe) y truena con "spawn npx ENOENT".
  // Encontrado igual que los otros dos: corriendo esto de verdad en
  // Windows. require.resolve encuentra la ruta real sin depender del
  // PATH ni de una extensión de archivo distinta según el sistema
  // operativo.
  procesoServidor = spawn(process.execPath, [require.resolve("tsx/cli"), "src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://finaquick_app:${CONTRASENA_APP}@localhost:5432/${DB_CARGA}`,
      DATABASE_URL_RESPALDO: `postgresql://finaquick_app:${CONTRASENA_APP}@localhost:5432/${DB_CARGA}`,
      JWT_SECRET: "llave-de-prueba-de-carga-no-usar-en-produccion-nunca",
      PORT: String(PUERTO_CARGA),
      ORIGEN_PERMITIDO: "http://localhost:5173",
      FRONTEND_URL: "http://localhost:5173",
    },
    stdio: "pipe",
  });
  procesoServidor.stderr?.on("data", () => {});
  for (let intento = 0; intento < 40; intento++) {
    try {
      const res = await fetch(`${URL_BASE}/salud`);
      if (res.ok) return;
    } catch {
      // todavía no abre el puerto
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("El servidor de la prueba de carga no respondió a tiempo.");
}

function detenerServidor(): void {
  procesoServidor?.kill();
  procesoServidor = null;
}

// Ctrl+C corta el tráfico en curso en vez de dejar la base de datos
// temporal y el servidor de prueba a medio arrancar/tirar — sin esto,
// interrumpir la prueba a mano dejaba basura que había que limpiar por
// separado (dropdb a mano, matar el proceso de Node huérfano). Un
// segundo Ctrl+C sí mata todo de inmediato, sin este aseo, por si el
// primero se queda pegado esperando algo.
let detenerAhora = false;
let segundoCtrlC = false;
process.on("SIGINT", () => {
  if (segundoCtrlC) {
    console.log("\nSegundo Ctrl+C — saliendo de inmediato, sin limpiar.");
    process.exit(130);
  }
  segundoCtrlC = true;
  detenerAhora = true;
  console.log("\nCtrl+C recibido — terminando el tráfico en curso y limpiando (Ctrl+C otra vez para salir de golpe)...");
});

function crearCliente() {
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
  return { pedir, pedirJson };
}

// ---- Medición ----

interface Medicion {
  etiqueta: string;
  ms: number;
  status: number;
}

const mediciones: Medicion[] = [];

async function medir<T>(etiqueta: string, fn: () => Promise<{ status: number; cuerpo: T }>): Promise<T> {
  const inicio = performance.now();
  const { status, cuerpo } = await fn();
  mediciones.push({ etiqueta, ms: performance.now() - inicio, status });
  return cuerpo;
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = Math.min(orden.length - 1, Math.floor((p / 100) * orden.length));
  return orden[idx];
}

function reportar(titulo: string, datos: Medicion[], duracionSeg: number): void {
  console.log(`\n=== ${titulo} ===`);
  const porEtiqueta = new Map<string, Medicion[]>();
  for (const m of datos) {
    if (!porEtiqueta.has(m.etiqueta)) porEtiqueta.set(m.etiqueta, []);
    porEtiqueta.get(m.etiqueta)!.push(m);
  }
  const total = datos.length;
  const errores = datos.filter((m) => m.status >= 400).length;
  console.log(`Peticiones totales: ${total}  |  Errores (4xx/5xx): ${errores}  |  Rendimiento: ${(total / duracionSeg).toFixed(1)} peticiones/seg`);
  console.log("");
  console.log("Ruta".padEnd(32) + "n".padStart(6) + "p50".padStart(8) + "p95".padStart(8) + "p99".padStart(8) + "max".padStart(8) + "errores".padStart(10));
  for (const [etiqueta, ms] of porEtiqueta) {
    const tiempos = ms.map((m) => m.ms);
    const err = ms.filter((m) => m.status >= 400).length;
    console.log(
      etiqueta.padEnd(32) +
      String(ms.length).padStart(6) +
      `${percentil(tiempos, 50).toFixed(0)}ms`.padStart(8) +
      `${percentil(tiempos, 95).toFixed(0)}ms`.padStart(8) +
      `${percentil(tiempos, 99).toFixed(0)}ms`.padStart(8) +
      `${Math.max(...tiempos).toFixed(0)}ms`.padStart(8) +
      String(err).padStart(10)
    );
  }
}

// ---- Preparación de datos ----

async function main() {
  console.log(`Preparando base de datos de prueba (${DB_CARGA})...`);
  await prepararBaseDeDatos();
  console.log("Arrancando el servidor real contra esa base...");
  await iniciarServidor();

  console.log("Creando la organización, el servicio y las cuentas de prueba...");
  const orgSalida = await consultar(`insert into organizations (nombre, color_primario) values ('Campus Prueba de Carga', '#3a3a3a') returning id`);
  const orgId = orgSalida.trim();

  // Todas las cuentas se dan de alta como administradoras: por diseño,
  // un administrador pertenece a toda la organización automáticamente
  // (ver AdminSettings.tsx), lo que evita tener que armar además la
  // membresía a servicios individuales solo para esta prueba —el punto
  // aquí es medir carga sobre el servidor y la base de datos, no
  // volver a probar las reglas de permisos (eso ya lo cubre `npm test`).
  //
  // Las cuentas se crean llamando registrar_usuario() directo por SQL
  // (lo mismo que hace /auth/registrar por dentro), no por HTTP: en la
  // vida real, dar de alta varias decenas de cuentas de golpe es cosa
  // de sistemas dando de alta a todo un equipo nuevo, no algo que deba
  // competir con el límite de intentos por IP pensado para el tráfico
  // normal de login del día a día (ver limitadorRegistro en
  // src/index.ts) — sin este rodeo, esta misma prueba de carga sería
  // quien se autobloqueara.
  const hashCompartido = await bcrypt.hash(PASSWORD_USUARIOS, 12);
  const TOKEN_CARGA = "token-de-prueba-de-carga";
  async function altaDirecta(correo: string, nombre: string, rol: "admin" | "personal" = "admin"): Promise<void> {
    await consultar(
      `insert into invitaciones (correo, org_id, rol, token) values ('${correo}', '${orgId}', '${rol}', '${TOKEN_CARGA}')`
    );
    await consultar(`select registrar_usuario('${nombre}', '${correo}', '${hashCompartido}', '${TOKEN_CARGA}')`);
  }

  await altaDirecta("admin@carga.test", "Admin de prueba");
  const admin = crearCliente();
  const loginAdmin = await admin.pedirJson<{ perfil?: unknown }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ correo: "admin@carga.test", password: PASSWORD_USUARIOS }),
  });
  if (loginAdmin.status !== 200) throw new Error(`No se pudo iniciar sesión como admin de prueba: ${JSON.stringify(loginAdmin.cuerpo)}`);

  const servicio = await medir("setup:crear-servicio", () =>
    admin.pedirJson<{ id: string }>("/servicios", {
      method: "POST",
      body: JSON.stringify({ nombre: "Clínica de prueba", icono: "building", orgId }),
    })
  );
  const servicioId = servicio.id;
  mediciones.length = 0; // no contar el setup en el reporte

  await admin.pedirJson("/categorias", { method: "POST", body: JSON.stringify({ nombre: "Consulta general", servicioId }) });

  // Cuentas de las personas que van a generar el tráfico.
  console.log(`Dando de alta ${USUARIOS} cuentas de prueba...`);
  const correos = Array.from({ length: USUARIOS }, (_, i) => `usuario${i}@carga.test`);
  await Promise.all(correos.map((correo) => altaDirecta(correo, correo)));

  console.log(`Iniciando sesión con las ${USUARIOS} cuentas (esto sí paga el costo real de bcrypt, a propósito)...`);
  const clientes = await Promise.all(
    correos.map(async (correo) => {
      const c = crearCliente();
      const { status, cuerpo } = await c.pedirJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ correo, password: PASSWORD_USUARIOS }),
      });
      if (status !== 200) throw new Error(`No se pudo iniciar sesión con ${correo}: ${JSON.stringify(cuerpo)}`);
      return { correo, cliente: c };
    })
  );

  // Algunos folios ya existentes, para que las lecturas y la búsqueda
  // tengan algo real que recorrer (no una tabla vacía). El folio y el
  // total los asigna siempre el servidor (ver /tickets en rutas.ts) —
  // no tiene caso mandarlos aquí, se ignorarían de todos modos.
  for (let i = 0; i < 50; i++) {
    const { status, cuerpo } = await admin.pedirJson("/tickets", {
      method: "POST",
      body: JSON.stringify({
        nombre: `Paciente de prueba ${i}`,
        tipoUsuario: "Externo",
        categoria: "Consulta general",
        estado: i % 3 === 0 ? "credito" : "pagado",
        formaPago: "Efectivo",
        servicioId,
        procedimientoIds: [],
      }),
    });
    // Sin esto, un cambio futuro en el contrato de /tickets (como el
    // que causó esto la primera vez: procedimientos -> procedimientoIds)
    // dejaba los 50 folios semilla fallando en silencio, uno por uno,
    // sin que nada lo notara — la prueba seguía "corriendo" contra una
    // tabla vacía, con números de todos modos.
    if (status !== 200) throw new Error(`No se pudo crear el folio semilla ${i}: ${JSON.stringify(cuerpo)}`);
  }

  // ---- Parte 1: tráfico mixto sostenido ----
  console.log(`\nCorriendo tráfico mixto con ${USUARIOS} usuarios durante ${DURACION_SEG} segundos (Ctrl+C para detener antes)...`);
  const inicioTrafico = performance.now();
  const finEn = inicioTrafico + DURACION_SEG * 1000;
  let contadorFolio = 1000;

  async function accionesDeUnUsuario(cliente: ReturnType<typeof crearCliente>) {
    while (performance.now() < finEn && !detenerAhora) {
      const dado = Math.random();
      if (dado < 0.40) {
        await medir("GET /tickets", () => cliente.pedirJson(`/tickets?servicioId=${servicioId}`));
      } else if (dado < 0.55) {
        await medir("GET /servicios", () => cliente.pedirJson(`/servicios?orgId=${orgId}`));
      } else if (dado < 0.65) {
        await medir("GET /categorias", () => cliente.pedirJson(`/categorias?servicioId=${servicioId}`));
      } else if (dado < 0.80) {
        await medir("GET /finanzas/ingresos-mensuales", () => cliente.pedirJson(`/finanzas/ingresos-mensuales?orgId=${orgId}`));
      } else if (dado < 0.90) {
        await medir("GET /buscar-folio", () => cliente.pedirJson(`/buscar-folio?orgId=${orgId}&q=PRY`));
      } else {
        const n = contadorFolio++;
        await medir("POST /tickets (crear folio)", () =>
          cliente.pedirJson("/tickets", {
            method: "POST",
            body: JSON.stringify({
              nombre: `Paciente ${n}`,
              tipoUsuario: "Externo",
              categoria: "Consulta general",
              estado: "pagado",
              formaPago: "Efectivo",
              servicioId,
              procedimientoIds: [],
            }),
          })
        );
      }
    }
  }

  await Promise.all(clientes.map(({ cliente }) => accionesDeUnUsuario(cliente)));
  // Duración real, no la nominal — si se detuvo antes con Ctrl+C, las
  // peticiones/segundo deben calcularse contra lo que en verdad corrió.
  const duracionRealSeg = (performance.now() - inicioTrafico) / 1000;
  reportar(`Tráfico mixto sostenido — ${USUARIOS} usuarios simultáneos`, mediciones, duracionRealSeg);

  if (detenerAhora) {
    console.log("\nDetenido con Ctrl+C — se omite la ráfaga de logins, se limpia y se sale.");
    detenerServidor();
    await borrarBaseDeDatos();
    console.log("Listo. Base de datos de prueba eliminada.");
    return;
  }

  // ---- Parte 2: ráfaga de logins simultáneos ----
  const mismasCuentas = correos.slice(0, Math.min(RAFAGA_LOGINS, correos.length));
  console.log(`\nCorriendo una ráfaga de ${mismasCuentas.length} inicios de sesión en el mismo instante...`);
  const medicionesLogin: Medicion[] = [];
  const inicioRafaga = performance.now();
  await Promise.all(
    mismasCuentas.map(async (correo) => {
      const c = crearCliente();
      const t0 = performance.now();
      const res = await c.pedirJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ correo, password: PASSWORD_USUARIOS }),
      });
      medicionesLogin.push({ etiqueta: "POST /auth/login", ms: performance.now() - t0, status: res.status });
    })
  );
  const duracionRafagaSeg = (performance.now() - inicioRafaga) / 1000;
  reportar(`Ráfaga de ${mismasCuentas.length} inicios de sesión simultáneos`, medicionesLogin, duracionRafagaSeg);
  console.log(
    `\n(La contraseña se verifica con bcrypt a costo 12 — deliberadamente lento para\n` +
    ` resistir fuerza bruta. Es normal que el login tarde más que una simple\n` +
    ` lectura, y que ese costo crezca si mucha gente entra en el mismo instante.)`
  );

  detenerServidor();
  await borrarBaseDeDatos();
  console.log("\nListo. Base de datos de prueba eliminada.");
}

main().catch(async (error) => {
  console.error("\nLa prueba de carga falló:", error);
  detenerServidor();
  await borrarBaseDeDatos().catch(() => {});
  process.exit(1);
});
