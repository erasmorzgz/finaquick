// Búsqueda en lenguaje natural para Quick (el ícono junto a la
// campana) — opcional, apagado por default. Sin GEMINI_API_KEY en
// servidor/api/.env, iaConfigurada queda en false y el navegador usa
// solo su búsqueda por patrones normales (src/lib/smartSearch.ts) —
// esta función nunca es la única forma de buscar algo, solo hace que
// entienda frases más variadas cuando está disponible.
//
// Importante sobre qué SÍ y qué NO hace el modelo aquí: solo clasifica
// la pregunta en una de nueve formas fijas — nunca ve datos reales de
// folios ni de personas, y nunca genera SQL ni nada que se ejecute
// directo. Su respuesta se valida contra una forma exacta antes de
// usarse en cualquier otra cosa; si no calza, se descarta como si no
// hubiera contestado nada. La consulta real a los datos la sigue
// haciendo el mismo código de siempre (el mismo que ya usa la
// búsqueda sin IA), con las mismas políticas de seguridad por fila de
// siempre — el modelo nunca tiene acceso a la base de datos. La
// gráfica tampoco es una excepción: el modelo solo decide cuántos
// meses mostrar y si además piden una proyección — el número de la
// proyección lo calcula después el código, con los datos reales,
// nunca el modelo.
//
// "libre" es la novena forma, y la que le da a Quick su libertad para
// preguntas que no calzan en ninguna de las otras ocho ("mi mejor día
// de agosto", "cuánto se cobró en efectivo en Odontología este año") —
// pero sigue siendo una clasificación de campos fijos y validados
// (rango de fechas, una métrica de una lista cerrada, una agrupación
// de una lista cerrada, y hasta tres filtros de texto acotados), nunca
// una consulta libre de verdad ni SQL. El modelo decide QUÉ filtrar y
// CÓMO agrupar; el cálculo real (sumar, contar, promediar, encontrar
// el máximo/mínimo) lo sigue haciendo este mismo código, con los
// tickets ya cargados del navegador.
//
// Además de clasificar, este archivo puede REDACTAR la respuesta ya
// calculada (narrarResultado) para que se sienta como un chat real en
// vez de una frase fija — pero ahí también hay un límite duro: solo se
// le manda un resumen YA AGREGADO (totales, conteos, nombres de
// PROCEDIMIENTOS del catálogo), nunca una lista de folios ni nombres
// de personas. Por eso "busqueda" (que sí trae nombres reales) nunca
// pasa por narración — se queda con su tarjeta de resultados de
// siempre.
const { GEMINI_API_KEY, GEMINI_MODELO } = process.env;

export const iaConfigurada = Boolean(GEMINI_API_KEY);

const METRICAS_VALIDAS = ["total", "top_procedimientos", "promedio_ticket", "formas_pago"] as const;
type MetricaEstadistica = (typeof METRICAS_VALIDAS)[number];

const METRICAS_LIBRES_VALIDAS = ["total", "conteo", "promedio", "maximo", "minimo"] as const;
type MetricaLibre = (typeof METRICAS_LIBRES_VALIDAS)[number];
const AGRUPACIONES_VALIDAS = ["dia", "categoria", "formaPago", "procedimiento"] as const;
type AgruparPor = (typeof AGRUPACIONES_VALIDAS)[number];
const FORMAS_PAGO_VALIDAS = ["Efectivo", "Tarjeta de débito", "Tarjeta de crédito"] as const;

export type ConsultaIA =
  | { tipo: "corte"; fecha: string }
  | { tipo: "resumen"; mes: string }
  | { tipo: "estadistica"; metrica: MetricaEstadistica; desde: string; hasta: string }
  | { tipo: "grafica"; meses: number; proyectar: boolean }
  | { tipo: "comparacion"; mesA: string; mesB: string }
  | { tipo: "creditos" }
  | { tipo: "persona"; nombre: string }
  | {
      tipo: "libre";
      desde: string;
      hasta: string;
      metrica: MetricaLibre;
      agruparPor?: AgruparPor;
      nombre?: string;
      formaPago?: string;
      categoria?: string;
    }
  | { tipo: "busqueda"; texto: string };

function formatoFechaHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// El modelo SOLO puede devolver una de estas nueve formas fijas —
// nunca texto libre, nunca código, nunca nada sobre cómo funciona el
// programa. Aunque alguien le pregunte algo de código o del
// funcionamiento de Finaquick, lo único que puede "hacer" con eso es
// meterlo como texto de búsqueda (tipo "busqueda"), que regresa "sin
// resultados" — no tiene forma de contestar nada fuera de estas nueve
// categorías de datos.
const INSTRUCCION = (hoy: string) =>
  `Hoy es ${hoy}. Clasifica la siguiente pregunta de alguien usando un sistema de folios/facturación, ` +
  `y responde ÚNICAMENTE con un objeto JSON, sin texto antes ni después, en una de estas nueve formas exactas:\n` +
  `- Cobros/pagos/cortes de caja de un día: {"tipo":"corte","fecha":"YYYY-MM-DD"}\n` +
  `- Resumen/total de UN mes completo: {"tipo":"resumen","mes":"YYYY-MM"}\n` +
  `- Promedio por folio, desglose por forma de pago, o procedimientos más frecuentes de un rango: ` +
  `{"tipo":"estadistica","metrica":"total"|"top_procedimientos"|"promedio_ticket"|"formas_pago","desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD"}. ` +
  `Si no se menciona un rango, usa el mes en curso completo.\n` +
  `- Gráfica/tendencia de ingresos por mes, con o sin proyección a futuro ("cómo van mis ingresos", "gráfica de este año", ` +
  `"proyección para diciembre", "cómo va a estar el próximo mes"): {"tipo":"grafica","meses":<entero 1-24, default 6>,"proyectar":<true si de verdad piden una estimación a futuro, false si solo quieren ver lo que ya pasó>}\n` +
  `- Comparar dos meses entre sí ("cómo voy este mes comparado con el anterior", "cuánto crecí", "mejoré o empeoré"): ` +
  `{"tipo":"comparacion","mesA":"YYYY-MM","mesB":"YYYY-MM"}, con mesA el más reciente de los dos. Si no se menciona un mes ` +
  `específico, usa el mes en curso y el anterior.\n` +
  `- Créditos pendientes de cobro ("quién me debe", "cuánto me deben", "créditos pendientes", "por cobrar"): {"tipo":"creditos"}\n` +
  `- Cuánto ha pagado o debe UNA persona específica, cuando piden un total (no solo buscar su folio): ` +
  `{"tipo":"persona","nombre":"<nombre tal como lo escribieron>"}\n` +
  `- CUALQUIER OTRA pregunta que pida un número real de folios filtrando y/o agrupando de alguna forma ("mi mejor día de agosto", ` +
  `"cuánto se cobró en efectivo este mes", "cuántos folios tuvo Juan Pérez este año", "en qué categoría se gasta más", ` +
  `"promedio de folios de Odontología"): ` +
  `{"tipo":"libre","desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD","metrica":"total"|"conteo"|"promedio"|"maximo"|"minimo",` +
  `"agruparPor":"dia"|"categoria"|"formaPago"|"procedimiento" (opcional, solo si de verdad piden un desglose o "el mejor/peor X"),` +
  `"nombre":"<nombre de persona>" (opcional),"formaPago":"Efectivo"|"Tarjeta de débito"|"Tarjeta de crédito" (opcional),` +
  `"categoria":"<categoría tal como la escribieron>" (opcional)}. Usa "maximo"/"minimo" para "mejor"/"peor". Si no se menciona ` +
  `un rango, usa el mes en curso completo. Esta es la opción por default para preguntas de datos que no calzan exacto en ` +
  `ninguna de las ocho de arriba — prefiérela sobre "busqueda" siempre que la pregunta pida un número, no solo encontrar un folio.\n` +
  `- Para cualquier otra cosa (busca un folio o un nombre sin pedir ningún número — incluye preguntas sobre el propio programa, ` +
  `código, o cualquier cosa que no sea un dato real de folios): {"tipo":"busqueda","texto":"<lo que hay que buscar>"}\n` +
  `Resuelve fechas relativas ("hoy", "ayer", "este mes", "el mes pasado", "este año") usando la fecha de hoy de arriba. No inventes campos extra.\n` +
  `Si el mensaje incluye preguntas anteriores de la misma conversación como contexto, úsalas SOLO para resolver referencias ("y el mes pasado", "y ese servicio") — clasifica únicamente la pregunta final marcada como tal, nunca las anteriores.`;

/** Valida que lo que devolvió el modelo tenga EXACTAMENTE una de las
 * ocho formas esperadas — nunca se confía en JSON de un modelo de
 * lenguaje sin revisar cada campo antes de usarlo. */
function validar(json: unknown): ConsultaIA | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.tipo === "corte" && typeof o.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) {
    return { tipo: "corte", fecha: o.fecha };
  }
  if (o.tipo === "resumen" && typeof o.mes === "string" && /^\d{4}-\d{2}$/.test(o.mes)) {
    return { tipo: "resumen", mes: o.mes };
  }
  if (
    o.tipo === "estadistica" &&
    typeof o.metrica === "string" &&
    (METRICAS_VALIDAS as readonly string[]).includes(o.metrica) &&
    typeof o.desde === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.desde) &&
    typeof o.hasta === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.hasta)
  ) {
    return { tipo: "estadistica", metrica: o.metrica as MetricaEstadistica, desde: o.desde, hasta: o.hasta };
  }
  if (
    o.tipo === "grafica" &&
    typeof o.meses === "number" &&
    Number.isInteger(o.meses) &&
    o.meses >= 1 &&
    o.meses <= 24 &&
    typeof o.proyectar === "boolean"
  ) {
    return { tipo: "grafica", meses: o.meses, proyectar: o.proyectar };
  }
  if (
    o.tipo === "comparacion" &&
    typeof o.mesA === "string" &&
    /^\d{4}-\d{2}$/.test(o.mesA) &&
    typeof o.mesB === "string" &&
    /^\d{4}-\d{2}$/.test(o.mesB)
  ) {
    return { tipo: "comparacion", mesA: o.mesA, mesB: o.mesB };
  }
  if (o.tipo === "creditos") {
    return { tipo: "creditos" };
  }
  if (o.tipo === "persona" && typeof o.nombre === "string" && o.nombre.trim().length > 0 && o.nombre.length <= 200) {
    return { tipo: "persona", nombre: o.nombre.trim() };
  }
  if (
    o.tipo === "libre" &&
    typeof o.desde === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.desde) &&
    typeof o.hasta === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.hasta) &&
    typeof o.metrica === "string" &&
    (METRICAS_LIBRES_VALIDAS as readonly string[]).includes(o.metrica) &&
    (o.agruparPor === undefined || (typeof o.agruparPor === "string" && (AGRUPACIONES_VALIDAS as readonly string[]).includes(o.agruparPor))) &&
    (o.nombre === undefined || (typeof o.nombre === "string" && o.nombre.trim().length > 0 && o.nombre.length <= 200)) &&
    (o.formaPago === undefined || (typeof o.formaPago === "string" && (FORMAS_PAGO_VALIDAS as readonly string[]).includes(o.formaPago))) &&
    (o.categoria === undefined || (typeof o.categoria === "string" && o.categoria.trim().length > 0 && o.categoria.length <= 200))
  ) {
    return {
      tipo: "libre",
      desde: o.desde,
      hasta: o.hasta,
      metrica: o.metrica as MetricaLibre,
      agruparPor: o.agruparPor as AgruparPor | undefined,
      nombre: (o.nombre as string | undefined)?.trim(),
      formaPago: o.formaPago as string | undefined,
      categoria: (o.categoria as string | undefined)?.trim(),
    };
  }
  if (o.tipo === "busqueda" && typeof o.texto === "string" && o.texto.trim().length > 0 && o.texto.length <= 200) {
    return { tipo: "busqueda", texto: o.texto.trim() };
  }
  return null;
}

/** Antepone las preguntas anteriores de esta conversación (si las hay)
 * como contexto de solo-lectura, y marca cuál es la que de verdad hay
 * que clasificar — así una pregunta como "¿y el mes pasado?" se puede
 * resolver sin que quien pregunta tenga que repetir todo cada vez. El
 * modelo nunca "conversa": sigue devolviendo una sola clasificación de
 * la pregunta final, nunca una respuesta sobre el historial en sí. */
function componerConHistorial(texto: string, historial: string[]): string {
  if (historial.length === 0) return texto;
  const lineas = historial.map((h, i) => `${i + 1}. "${h}"`).join("\n");
  return `Preguntas anteriores de esta misma conversación (solo contexto, no las clasifiques):\n${lineas}\n\nPregunta a clasificar: "${texto}"`;
}

/** Saca el primer bloque {...} de un texto — algunos modelos, a pesar
 * de que se les pide JSON puro, igual lo rodean de explicación. */
function extraerJson(texto: string): unknown {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin === -1 || fin < inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

// Google AI Studio (Gemini) — nivel gratis sin tarjeta para uso ligero
// como este (revisar condiciones vigentes en ai.google.dev). La clave
// va en la URL (así lo pide Google, no por elección de este archivo),
// nunca en un encabezado.
const API_GEMINI = "https://generativelanguage.googleapis.com/v1beta";

// Sin GEMINI_MODELO, el modelo se elige solo: se le pregunta a Google
// qué modelos tiene disponibles ESTA clave y se toma el Flash estable
// más reciente. Fijar un nombre en el código ya falló dos veces —
// Google retira o restringe familias enteras (2.0 apagada, 2.5 solo
// para cuentas que ya la usaban), y una clave nueva recibía 404.
const MODELO_RESPALDO = "gemini-flash-latest";
let modeloDescubierto: string | null = null;
// Modelos que ya respondieron 404 con esta clave — se saltan al volver
// a elegir, para no insistir con el mismo pregunta tras pregunta.
const modelosRechazados = new Set<string>();

const PATRON_FLASH_ESTABLE = /^models\/gemini-(\d+)(?:\.(\d+))?-flash(-lite)?$/;

/** El Flash estable más reciente de la lista que regresa Google
 * (ListModels), sin preview, TTS, imagen ni los ya rechazados. Flash
 * completo antes que Flash-Lite; dentro de cada uno, la versión más
 * alta, comparando mayor y menor como números (3.10 arriba de 3.9).
 * Exportada solo para probarla. */
export function elegirModeloFlash(modelos: unknown, rechazados: ReadonlySet<string> = new Set()): string | null {
  const candidatos = (Array.isArray(modelos) ? modelos : [])
    .filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m: any) => ({ nombre: String(m.name).replace(/^models\//, ""), partes: PATRON_FLASH_ESTABLE.exec(String(m.name)) }))
    .filter((c) => c.partes && !rechazados.has(c.nombre))
    .sort(
      (a, b) =>
        Number(Boolean(a.partes![3])) - Number(Boolean(b.partes![3])) ||
        Number(b.partes![1]) - Number(a.partes![1]) ||
        Number(b.partes![2] ?? 0) - Number(a.partes![2] ?? 0)
    );
  return candidatos[0]?.nombre ?? null;
}

async function descubrirModelo(): Promise<string> {
  try {
    const res = await fetch(`${API_GEMINI}/models?pageSize=1000&key=${GEMINI_API_KEY}`);
    if (!res.ok) return MODELO_RESPALDO;
    const data = (await res.json()) as any;
    return elegirModeloFlash(data?.models, modelosRechazados) ?? MODELO_RESPALDO;
  } catch {
    return MODELO_RESPALDO;
  }
}

async function modeloActual(): Promise<string> {
  if (GEMINI_MODELO) return GEMINI_MODELO;
  modeloDescubierto ??= await descubrirModelo();
  return modeloDescubierto;
}

/** Los modelos recientes "piensan" antes de contestar y ese
 * razonamiento se descuenta de maxOutputTokens — con los límites cortos
 * de este archivo se lo comía completo y la respuesta llegaba vacía. En
 * 2.5 se apaga; en 3.x no se puede apagar, solo bajar a "low". */
function configPensamiento(modelo: string): Record<string, unknown> | null {
  if (/^gemini-2\.5-flash/.test(modelo)) return { thinkingBudget: 0 };
  if (/^gemini-([3-9]|\d{2,})/.test(modelo)) return { thinkingLevel: "low" };
  return null;
}

// Resultado de la llamada más reciente a Gemini, solo para el indicador
// de estado de Quick (ver estadoIA). Sin esto, una clave inválida o un
// modelo ya retirado por Google se veían exactamente igual que "sin IA":
// todo caía a los patrones fijos sin que nadie supiera por qué.
let ultimaLlamada: { ok: true } | { ok: false; codigo: number; modelo: string } | null = null;

async function llamarGemini(
  modelo: string,
  instruccion: string,
  texto: string,
  opciones: { json: boolean; temperatura: number; maxTokens: number },
  pensamiento: Record<string, unknown> | null
): Promise<Response> {
  return fetch(`${API_GEMINI}/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: instruccion }] },
      contents: [{ parts: [{ text: texto }] }],
      generationConfig: {
        temperature: opciones.temperatura,
        // Margen para el razonamiento cuando no se puede apagar; lo que
        // de verdad acota la respuesta es la validación de longitud de
        // cada función de abajo.
        maxOutputTokens: pensamiento && "thinkingBudget" in pensamiento ? opciones.maxTokens : opciones.maxTokens + 1024,
        ...(opciones.json ? { responseMimeType: "application/json" } : {}),
        ...(pensamiento ? { thinkingConfig: pensamiento } : {}),
      },
    }),
  });
}

async function preguntarGemini(
  instruccion: string,
  texto: string,
  opciones: { json: boolean; temperatura: number; maxTokens: number }
): Promise<string | null> {
  // Hasta dos modelos por pregunta: si el elegido automáticamente ya no
  // está disponible (404), se elige otro y se reintenta en la misma
  // pregunta, sin que quien pregunta tenga que volver a escribirla.
  for (let intento = 0; intento < 2; intento++) {
    const modelo = await modeloActual();
    let res: Response;
    try {
      const pensamiento = configPensamiento(modelo);
      res = await llamarGemini(modelo, instruccion, texto, opciones, pensamiento);
      // Si un modelo no acepta el ajuste de razonamiento, se reintenta
      // una vez sin él en vez de dar la IA por caída.
      if (res.status === 400 && pensamiento) res = await llamarGemini(modelo, instruccion, texto, opciones, null);
    } catch {
      ultimaLlamada = { ok: false, codigo: 0, modelo };
      return null;
    }
    if (!res.ok) {
      ultimaLlamada = { ok: false, codigo: res.status, modelo };
      if (res.status === 404 && !GEMINI_MODELO && modelo !== MODELO_RESPALDO) {
        modelosRechazados.add(modelo);
        modeloDescubierto = null;
        continue;
      }
      return null;
    }
    ultimaLlamada = { ok: true };
    const data = (await res.json()) as any;
    const partes: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const textoRespuesta = partes
      .filter((p) => typeof p?.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("");
    return textoRespuesta || null;
  }
  return null;
}

export type EstadoIA =
  | { estado: "sin-configurar" }
  | { estado: "lista"; modelo: string; automatico: boolean }
  | { estado: "error"; modelo: string; automatico: boolean; codigo: number };

/** Para el indicador de Quick. "lista" cubre tanto "ya contestó bien"
 * como "configurada pero aún sin usarse". `codigo` es el estado HTTP con
 * el que Gemini rechazó la última llamada (0 = no se pudo conectar);
 * nunca incluye la clave ni el cuerpo de la respuesta. */
export function estadoIA(): EstadoIA {
  if (!iaConfigurada) return { estado: "sin-configurar" };
  const automatico = !GEMINI_MODELO;
  const modelo = GEMINI_MODELO || modeloDescubierto || "automático";
  if (ultimaLlamada && !ultimaLlamada.ok) return { estado: "error", modelo: ultimaLlamada.modelo, automatico, codigo: ultimaLlamada.codigo };
  return { estado: "lista", modelo, automatico };
}

/** Punto de entrada — nunca lanza: cualquier problema (sin configurar,
 * Gemini caído, respuesta rara) regresa null, y quien llama cae de
 * vuelta a la búsqueda por patrones sin IA. `historial` son preguntas
 * ANTERIORES de la misma conversación (texto plano, ya acotado por
 * quien llama) — nunca respuestas ni datos reales, solo para que el
 * modelo pueda resolver un "¿y el mes pasado?" sin que se le repita
 * todo el contexto cada vez. */
export async function interpretarConIA(texto: string, historial: string[] = []): Promise<ConsultaIA | null> {
  if (!iaConfigurada) return null;
  try {
    const compuesto = componerConHistorial(texto, historial);
    const respuesta = await preguntarGemini(INSTRUCCION(formatoFechaHoy()), compuesto, {
      json: true,
      temperatura: 0,
      maxTokens: 200,
    });
    if (!respuesta) return null;
    return validar(extraerJson(respuesta));
  } catch {
    return null;
  }
}

const INSTRUCCION_NARRAR =
  `Eres Quick, el asistente de datos de una app de folios/facturación. Te doy un resumen YA CALCULADO ` +
  `de una consulta (nunca hables de cómo se calculó, de la app, ni de código). Redacta una respuesta ` +
  `corta (1 a 3 oraciones), natural y amigable, en español de México, contándole a la persona lo que dice ` +
  `ese resumen — como un asistente conversacional de verdad, no una plantilla rígida. Usa ÚNICAMENTE los ` +
  `números y datos que te doy, nunca inventes ni agregues ninguno que no esté ahí. Sin markdown, sin listas, ` +
  `solo texto corrido. No menciones la palabra "resumen" ni cómo obtuviste los datos.`;

/** Solo deja pasar un objeto plano, chico, y de valores simples
 * (string/number/boolean, o arreglos cortos de esos mismos) — el
 * resumen ya agregado que se le muestra a la persona en pantalla
 * (totales, conteos, nombres de PROCEDIMIENTOS del catálogo), nunca
 * una lista de folios ni de nombres de personas. Cualquier otra forma
 * (objetos anidados, arreglos largos, texto largo) se rechaza — este
 * endpoint no es una forma disfrazada de mandarle texto libre a la IA. */
function validarResumenSeguro(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const claves = Object.keys(o);
  if (claves.length === 0 || claves.length > 20) return null;
  const esPrimitivoValido = (v: unknown): boolean =>
    (typeof v === "string" && v.length <= 200) || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";
  for (const clave of claves) {
    const v = o[clave];
    const valido = esPrimitivoValido(v) || (Array.isArray(v) && v.length <= 20 && v.every(esPrimitivoValido));
    if (!valido) return null;
  }
  if (JSON.stringify(o).length > 4000) return null;
  return o;
}

/** Redacta en prosa un resultado que este mismo código ya calculó —
 * nunca lanza, nunca bloquea: si algo no calza o Gemini falla, regresa
 * null y quien llama se queda con la frase fija de siempre. `tipo` es
 * solo una etiqueta para darle contexto al modelo (qué clase de dato
 * es), `resumen` ya pasó por validarResumenSeguro antes de llegar aquí
 * — ver la ruta POST /asistente/narrar. */
export async function narrarResultado(tipo: unknown, resumenCrudo: unknown): Promise<string | null> {
  if (!iaConfigurada) return null;
  if (typeof tipo !== "string" || tipo.length === 0 || tipo.length > 30) return null;
  const resumen = validarResumenSeguro(resumenCrudo);
  if (!resumen) return null;
  try {
    const contenido = `Tipo de consulta: ${tipo}\nResumen: ${JSON.stringify(resumen)}`;
    const texto = await preguntarGemini(INSTRUCCION_NARRAR, contenido, { json: false, temperatura: 0.5, maxTokens: 150 });
    if (!texto) return null;
    const limpio = texto.trim();
    if (limpio.length === 0 || limpio.length > 600) return null;
    return limpio;
  } catch {
    return null;
  }
}

// ============================================================
// Chat libre — Gemini contesta directamente, con sus propias
// palabras, en vez de que el código elija primero entre las nueve
// formas de arriba. El resumen que recibe es sobre todo agregados
// (totales por mes, por categoría, por forma de pago, créditos
// pendientes), más una lista de folios individuales recientes con
// nombre real (`foliosDetalle`, hasta 300, ver validarDigesto) para
// preguntas que de verdad necesitan el detalle — "quién no ha
// pagado", "los folios de esta semana con nombre". Pedido explícito:
// que Quick pueda ver folios y nombres cuando la pregunta lo amerite.
// El límite real no es "nunca ve un nombre" — es que nunca ve MÁS de
// lo que la propia sesión ya podía ver en el resto de la app: todo
// este resumen lo arma el navegador con los tickets que ya tenía
// cargados para el servicio actual, con el mismo acceso (RLS +
// service_access) que ya tiene esa sesión — un "personal" con acceso
// a un solo servicio jamás tiene folios de otro servicio en ese
// arreglo para empezar. Nada de esto amplía el acceso de nadie; solo
// deja que Quick use, para contestar, lo que esa persona ya podía ver
// a mano.
const INSTRUCCION_CHAT_LIBRE =
  `Eres Quick, el asistente conversacional de datos de Finaquick (un sistema de folios/facturación de una ` +
  `institución) — hablas como un chat de verdad, no como una caja de búsqueda de datos. Si te saludan ("hola", ` +
  `"buenas", "qué tal") o hacen plática casual sin pedir ningún dato, responde de forma cálida y breve, como ` +
  `saludaría cualquier asistente conversacional — no fuerces una respuesta con números si no la pidieron; ` +
  `puedes ofrecer ejemplos de en qué ayudas ("cuánto cobré ayer", "resumen de este mes"), sin ser repetitivo si ` +
  `ya se lo dijiste antes en la misma conversación. Para preguntas que sí piden un dato: te doy un resumen YA ` +
  `CALCULADO de los datos de esta cuenta — nunca inventes ni supongas ningún número que no esté en él. Contesta ` +
  `de forma natural y conversacional, en español de México, con la extensión que amerite (una frase corta, o ` +
  `varias si hace falta explicar) — puedes comparar, sumar, sacar porcentajes o razonar tú mismo a partir de los ` +
  `números que te doy. El resumen incluye: totales de hoy, ` +
  `este mes, el mes pasado y el año; la tendencia mensual general y también por categoría y por procedimiento ` +
  `específico (úsala para dar una aproximación a futuro de un procedimiento o categoría en particular — deja claro ` +
  `que es un estimado según la tendencia, no una cifra garantizada); el catálogo de procedimientos con sus precios; ` +
  `foliosDetalle, una lista de folios individuales recientes (nombre real de la persona, folio, fecha, categoría, ` +
  `total, estado y forma de pago) — úsala para cualquier pregunta que pida el detalle real, no solo un total: ` +
  `quién no ha pagado, la lista de folios de tal día o tal persona, quién pagó más, etc.; y un resumen de ` +
  `requisiciones (solicitudes internas de compra/material) del mes, con sus conceptos. foliosDetalle trae como ` +
  `máximo los 300 folios más recientes — si la pregunta pide algo de fuera de ese rango (folios muy viejos, por ` +
  `ejemplo) y no está cubierto por los agregados de arriba, dilo con claridad en vez de inventarlo. NUNCA hables ` +
  `de código, de cómo funciona el programa, ni de nada que no sea un dato real de esta cuenta; si te preguntan ` +
  `eso, contesta que solo puedes ayudar con los datos de Finaquick. Sin markdown, sin listas, texto corrido.`;

function esNumeroValido(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function esTextoCorto(v: unknown, maxLargo = 200): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLargo;
}

/** El resumen que arma el navegador para el chat libre tiene una forma
 * FIJA y conocida (a diferencia de validarResumenSeguro, que acepta
 * cualquier objeto chico de valores simples) — se valida campo por
 * campo contra esa forma exacta, nunca aceptando algo que no calce.
 * Exportada (a diferencia del resto de las validaciones de este
 * archivo) para poder probarla directo, sin pasar por
 * responderChatLibre — que corta en su primera línea sin
 * GEMINI_API_KEY configurada, así que esta es la única forma de
 * ejercitar de verdad la validación de foliosDetalle (nombres reales)
 * en un entorno de pruebas sin una clave real de Gemini. */
export function validarDigesto(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;

  const esMesTotal = (v: unknown): boolean =>
    !!v && typeof v === "object" && !Array.isArray(v) && esTextoCorto((v as any).mes, 7) && esNumeroValido((v as any).total) && esNumeroValido((v as any).folios);
  const esTotalFolios = (v: unknown): boolean =>
    !!v && typeof v === "object" && !Array.isArray(v) && esNumeroValido((v as any).total) && esNumeroValido((v as any).folios);
  const esListaMesTotal = (v: unknown, max: number): boolean =>
    Array.isArray(v) && v.length <= max && v.every((x) => x && typeof x === "object" && esTextoCorto(x.mes, 7) && esNumeroValido(x.total));
  const esListaEtiquetaTotal = (v: unknown, max: number): boolean =>
    Array.isArray(v) &&
    v.length <= max &&
    v.every((x) => x && typeof x === "object" && esNumeroValido(x.total) && (esTextoCorto(x.etiqueta) || esTextoCorto(x.nombre)));
  const esPersona = (v: unknown): boolean =>
    v === undefined ||
    (!!v &&
      typeof v === "object" &&
      esTextoCorto((v as any).nombre) &&
      esNumeroValido((v as any).totalPagado) &&
      esNumeroValido((v as any).foliosPagados) &&
      esNumeroValido((v as any).pendiente) &&
      esNumeroValido((v as any).foliosPendientes));
  const esTotalFoliosOpcional = (v: unknown): boolean => v === undefined || esTotalFolios(v);
  const esListaProcedimientoPrecio = (v: unknown, max: number): boolean =>
    v === undefined ||
    (Array.isArray(v) && v.length <= max && v.every((x) => x && typeof x === "object" && esTextoCorto(x.nombre) && esNumeroValido(x.precio)));
  // Tendencia mensual por categoría/procedimiento — la base para que el
  // modelo pueda razonar una aproximación a futuro de algo específico
  // (nunca la calcula el modelo con matemática exacta como la gráfica
  // de proyección general, solo la usa para dar un estimado en prosa).
  const esListaTendencia = (v: unknown, maxGrupos: number, maxMeses: number): boolean =>
    v === undefined ||
    (Array.isArray(v) &&
      v.length <= maxGrupos &&
      v.every(
        (x) =>
          x &&
          typeof x === "object" &&
          esTextoCorto(x.etiqueta) &&
          Array.isArray(x.meses) &&
          x.meses.length <= maxMeses &&
          x.meses.every((m: any) => m && typeof m === "object" && esTextoCorto(m.mes, 7) && esNumeroValido(m.total))
      ));
  // Folios individuales recientes, con nombre real — a diferencia del
  // resto de este resumen (solo agregados), esto sí trae datos de
  // personas. Sigue siendo estrictamente lo que la propia sesión ya
  // podía ver en el resto de la app (ver el comentario en
  // construirDigesto, SmartSearchModal.tsx) — este validador solo
  // confirma la FORMA (campos, tipos, tamaños), no vuelve a revisar
  // permisos: esa parte ya la garantizó el servidor antes de que el
  // navegador tuviera estos folios cargados. Tope de 300 filas — ni
  // aquí se acepta una lista sin límite.
  const esListaFoliosDetalle = (v: unknown, max: number): boolean =>
    v === undefined ||
    (Array.isArray(v) &&
      v.length <= max &&
      v.every(
        (x) =>
          x &&
          typeof x === "object" &&
          esTextoCorto(x.folio, 30) &&
          esTextoCorto(x.nombre, 200) &&
          esTextoCorto(x.fecha, 10) &&
          esTextoCorto(x.categoria, 100) &&
          esNumeroValido(x.total) &&
          (x.estado === "pagado" || x.estado === "credito") &&
          (x.formaPago === null || (typeof x.formaPago === "string" && (FORMAS_PAGO_VALIDAS as readonly string[]).includes(x.formaPago)))
      ));
  // Nunca solicitante/aprobador — solo conteos y el concepto (una
  // descripción de material/compra, no un dato de una persona).
  const esRequisicionesResumen = (v: unknown): boolean =>
    v === undefined ||
    (!!v &&
      typeof v === "object" &&
      esNumeroValido((v as any).pendientes) &&
      esNumeroValido((v as any).aprobadas) &&
      esNumeroValido((v as any).rechazadas) &&
      esNumeroValido((v as any).esteMes) &&
      ((v as any).conceptosEsteMes === undefined ||
        (Array.isArray((v as any).conceptosEsteMes) &&
          (v as any).conceptosEsteMes.length <= 10 &&
          (v as any).conceptosEsteMes.every((c: unknown) => esTextoCorto(c)))));

  const valido =
    esTextoCorto(o.hoy, 10) &&
    esMesTotal(o.esteMes) &&
    esMesTotal(o.mesPasado) &&
    esTotalFolios(o.esteAnio) &&
    esListaMesTotal(o.ultimos12Meses, 12) &&
    esListaEtiquetaTotal(o.porFormaPago, 5) &&
    esListaEtiquetaTotal(o.topProcedimientos, 5) &&
    esListaEtiquetaTotal(o.topCategorias, 5) &&
    esTotalFolios(o.creditosPendientes) &&
    esPersona(o.personaMencionada) &&
    esTotalFoliosOpcional(o.resumenHoy) &&
    esListaProcedimientoPrecio(o.catalogoProcedimientos, 60) &&
    esListaTendencia(o.tendenciaPorCategoria, 5, 6) &&
    esListaTendencia(o.tendenciaPorProcedimiento, 5, 6) &&
    esListaFoliosDetalle(o.foliosDetalle, 300) &&
    esRequisicionesResumen(o.requisiciones) &&
    // Subido de 12000 a 80000 al agregar foliosDetalle (hasta 300
    // filas con nombre real) — el resto de los campos ya cabía
    // sobrado en el límite viejo.
    JSON.stringify(o).length <= 80000;

  return valido ? o : null;
}

/** Punto de entrada del chat libre — nunca lanza: sin IA configurada,
 * con un resumen que no calza, o si Gemini falla, regresa null y quien
 * llama cae de vuelta al flujo de clasificación de siempre (interpretarConIA
 * + interpretarConsulta), que sigue intacto como red de seguridad. */
export async function responderChatLibre(texto: unknown, historial: unknown, digestoCrudo: unknown): Promise<string | null> {
  if (!iaConfigurada) return null;
  if (typeof texto !== "string" || texto.trim().length === 0 || texto.length > 500) return null;
  const historialValido: string[] =
    Array.isArray(historial) && historial.length <= 5 && historial.every((h) => typeof h === "string" && h.length <= 500) ? historial : [];
  const digesto = validarDigesto(digestoCrudo);
  if (!digesto) return null;
  try {
    const compuesto = componerConHistorial(texto, historialValido);
    const contenido = `Resumen de datos de esta cuenta:\n${JSON.stringify(digesto)}\n\n${compuesto}`;
    const respuesta = await preguntarGemini(INSTRUCCION_CHAT_LIBRE, contenido, { json: false, temperatura: 0.4, maxTokens: 400 });
    if (!respuesta) return null;
    const limpio = respuesta.trim();
    if (limpio.length === 0 || limpio.length > 1200) return null;
    return limpio;
  } catch {
    return null;
  }
}
