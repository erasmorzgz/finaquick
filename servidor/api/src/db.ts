import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sin fijar esto, "pg" usa 10 conexiones simultáneas como máximo. Se
  // sube aquí a 20 y se deja configurable (DB_POOL_MAX en .env) como
  // margen de sobra para el servidor de la institución — PostgreSQL
  // admite bastantes más sin problema (100 por default). En las
  // pruebas de carga de este proyecto (ver PRUEBA_DE_CARGA.md), subir
  // este número no fue lo que más ayudó: en una sola máquina de
  // desarrollo, Node y PostgreSQL compiten por el mismo procesador, así
  // que el techo real dependerá del hardware del servidor donde
  // termine corriendo esto, no solo de este valor.
  max: Number(process.env.DB_POOL_MAX) || 20,
  // Sin estos tres, una sola consulta que se quede pegada (una tabla
  // bloqueada, una consulta mal escrita en el futuro, PostgreSQL sin
  // responder) podía dejar viva esa conexión — y, con ella, esa
  // posición del pool — indefinidamente, hasta agotar las conexiones
  // disponibles una por una sin que nada lo notara. Los tres son
  // configurables (mismo patrón que DB_POOL_MAX) por si el hardware o
  // los reportes reales de una instalación concreta necesitan más
  // margen — estos valores son un punto de partida razonable, no una
  // medición de la carga real de ninguna institución en particular.
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 10_000,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30_000,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 30_000,
});

/**
 * Corre `fn` dentro de una transacción con la variable de sesión
 * `app.usuario_actual` puesta al id del usuario autenticado — las
 * políticas de seguridad por fila (RLS) del esquema la leen con la
 * función usuario_actual(), definida en el propio esquema. Sin usuario
 * autenticado (rutas públicas como login/registro) se pasa null y las
 * políticas simplemente no dejan ver nada protegido, como debe ser.
 */
export async function conSesionDe<T>(
  usuarioId: string | null,
  fn: (cliente: pg.PoolClient) => Promise<T>
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    await cliente.query("select set_config('app.usuario_actual', $1, true)", [usuarioId ?? ""]);
    const resultado = await fn(cliente);
    await cliente.query("commit");
    return resultado;
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  } finally {
    cliente.release();
  }
}
