// Interpreta preguntas en español casual ("cortes de caja del 15 de
// septiembre", "folios de Ana García", "resumen de agosto",
// "estadísticas de este año", "promedio por folio en agosto") con
// reglas normales de programación — sin conectarse a ningún modelo de
// IA. Es deliberadamente limitado: reconoce los patrones más comunes
// y, para cualquier otra cosa, cae de vuelta a una búsqueda de
// folio/nombre normal (la misma que ya usa "Buscar folio") en vez de
// fallar.

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

function formatoFecha(d: Date): string {
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

function formatoMes(d: Date): string {
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}`;
}

/** Busca una fecha explícita en el texto — "hoy", "ayer", "15 de
 * septiembre", "15/09" o "15-09-2026". Si el texto no trae año, asume
 * el actual; si esa fecha con el año actual ya pasó por más de medio
 * año, asume que se refería al año anterior (para no interpretar "3 de
 * enero" en diciembre como una fecha once meses en el futuro). */
function extraerFecha(texto: string, ahora: Date): string | null {
  if (/\bhoy\b/.test(texto)) return formatoFecha(ahora);
  if (/\bayer\b/.test(texto)) {
    const d = new Date(ahora);
    d.setDate(d.getDate() - 1);
    return formatoFecha(d);
  }

  const conMes = texto.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?\b/);
  if (conMes) {
    const dia = Number(conMes[1]);
    const mesIdx = MESES.indexOf(conMes[2]);
    if (mesIdx !== -1 && dia >= 1 && dia <= 31) {
      const anio = conMes[3] ? Number(conMes[3]) : ahora.getFullYear();
      return formatoFecha(new Date(anio, mesIdx, dia));
    }
  }

  const numerica = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numerica) {
    const dia = Number(numerica[1]);
    const mes = Number(numerica[2]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      let anio = numerica[3] ? Number(numerica[3]) : ahora.getFullYear();
      if (anio < 100) anio += 2000;
      return formatoFecha(new Date(anio, mes - 1, dia));
    }
  }

  return null;
}

/** Igual que extraerFecha, pero para un MES completo (para "resumen de
 * agosto") — nombre de mes solo, "este mes", "mes pasado". */
function extraerMes(texto: string, ahora: Date): string | null {
  if (/\beste\s+mes\b/.test(texto)) return formatoMes(ahora);
  if (/\bmes\s+pasado\b/.test(texto)) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    return formatoMes(d);
  }
  for (const mes of MESES) {
    if (new RegExp(`\\b${mes}\\b`).test(texto)) {
      const conAnioMatch = texto.match(new RegExp(`\\b${mes}\\s+(?:de|del)\\s+(\\d{4})\\b`));
      const anio = conAnioMatch ? Number(conAnioMatch[1]) : ahora.getFullYear();
      return `${anio}-${dosDigitos(MESES.indexOf(mes) + 1)}`;
    }
  }
  return null;
}

export type MetricaEstadistica = "total" | "top_procedimientos" | "promedio_ticket" | "formas_pago";

export type MetricaLibre = "total" | "conteo" | "promedio" | "maximo" | "minimo";
export type AgruparPor = "dia" | "categoria" | "formaPago" | "procedimiento";

export type Consulta =
  | { tipo: "corte"; fecha: string } // YYYY-MM-DD
  | { tipo: "resumen"; mes: string } // YYYY-MM
  | { tipo: "estadistica"; metrica: MetricaEstadistica; desde: string; hasta: string } // YYYY-MM-DD ambos
  | { tipo: "grafica"; meses: number; proyectar: boolean }
  | { tipo: "comparacion"; mesA: string; mesB: string } // YYYY-MM ambos; mesA es el más reciente
  | { tipo: "creditos" }
  | { tipo: "persona"; nombre: string }
  // El comodín: filtra y agrupa los folios pagados de un rango a
  // gusto, para cualquier pregunta que no calce exacto en las de
  // arriba ("mi mejor día de agosto", "cuánto se cobró en efectivo en
  // Odontología este año"). Sin IA, solo se reconocen unos cuantos
  // patrones de agrupación (ver interpretarConsulta); con IA, Gemini
  // puede combinar cualquier filtro con cualquier agrupación.
  | {
      tipo: "libre";
      desde: string; // YYYY-MM-DD
      hasta: string;
      metrica: MetricaLibre;
      agruparPor?: AgruparPor;
      nombre?: string;
      formaPago?: string;
      categoria?: string;
    }
  | { tipo: "busqueda"; texto: string };

/** Rango de fechas para "estadistica" — un mes si se menciona uno
 * ("estadísticas de agosto"), el año completo si se dice "este año" o
 * un año suelto, y si no se menciona nada, el mes en curso completo
 * (no solo lo que va del mes, para no sesgar el promedio contra días
 * que todavía no pasan). */
function extraerRango(texto: string, ahora: Date): { desde: string; hasta: string } {
  if (/\beste\s+a[nñ]o\b/.test(texto)) {
    return { desde: `${ahora.getFullYear()}-01-01`, hasta: formatoFecha(ahora) };
  }
  const soloAnio = texto.match(/\b(20\d{2})\b/);
  const mes = extraerMes(texto, ahora);
  if (mes) {
    const [anio, mesNum] = mes.split("-").map(Number);
    const ultimoDia = new Date(anio, mesNum, 0).getDate();
    return { desde: `${mes}-01`, hasta: `${mes}-${dosDigitos(ultimoDia)}` };
  }
  if (soloAnio) {
    return { desde: `${soloAnio[1]}-01-01`, hasta: `${soloAnio[1]}-12-31` };
  }
  const inicioMes = formatoMes(ahora);
  const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
  return { desde: `${inicioMes}-01`, hasta: `${inicioMes}-${dosDigitos(ultimoDia)}` };
}

/** Cuántos meses de historial pedir para una gráfica — "últimos 3
 * meses" da 3; sin número explícito, 6 (un semestre completo, ni tan
 * poco que no se note una tendencia ni tantos que la gráfica se sature
 * en un chat angosto). */
function extraerMesesGrafica(texto: string): number {
  const conNumero = texto.match(/\bultimos?\s+(\d{1,2})\s+meses\b/);
  if (conNumero) {
    const n = Number(conNumero[1]);
    if (n >= 1 && n <= 24) return n;
  }
  return 6;
}

/** Mes actual vs. el anterior — el caso de comparación con mucho el más
 * pedido ("cómo voy este mes comparado con el anterior"). Comparar
 * contra un mes específico distinto se puede seguir pidiendo como dos
 * preguntas de "resumen" por separado. */
function extraerComparacion(ahora: Date): { mesA: string; mesB: string } {
  const mesA = formatoMes(ahora);
  const anterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  return { mesA, mesB: formatoMes(anterior) };
}

/** El mismo criterio que ya usa la búsqueda por folio/nombre ("folios
 * de Ana García" -> "Ana García") — se reutiliza aquí para "persona",
 * que a diferencia de una búsqueda normal regresa un total agregado en
 * vez de una lista de folios. */
function extraerNombrePersona(textoOriginal: string): string {
  const conDe = textoOriginal.match(/(?:cuanto\s+ha\s+(?:pagado|gastado|debe)\s+|cuanto\s+debe\s+|de\s+)(.+)/i);
  return (conDe ? conDe[1] : textoOriginal).trim();
}

function extraerMetrica(texto: string): MetricaEstadistica {
  if (/\bpromedio\b/.test(texto)) return "promedio_ticket";
  if (/\bforma(s)?\s+de\s+pago\b/.test(texto)) return "formas_pago";
  if (/\bprocedimiento(s)?\b/.test(texto)) return "top_procedimientos";
  return "total";
}

const SALUDOS = ["hola", "hey", "hi", "hello", "buenas", "buenos dias", "buenas tardes", "buenas noches", "buen dia", "que tal", "saludos"];

/** Un saludo, y solo un saludo — sin relación a ningún dato — se revisa
 * ANTES que cualquier patrón de datos, para que Quick conteste como un
 * chat de verdad ("¡Hola!") en vez de caer al modo de búsqueda y no
 * encontrar nada (encontrado con quien usa el sistema probando
 * exactamente esto: "hola" caía a {tipo: "busqueda"} y mostraba "Sin
 * resultados", que se siente como una caja de búsqueda rota, no como
 * un chat). A propósito solo hace match EXACTO contra la lista, nunca
 * como prefijo — "hola, cuánto cobré ayer" sigue su camino normal como
 * pregunta real, no se queda atorado en el saludo. */
export function esSaludo(textoOriginal: string): boolean {
  const texto = sinAcentos(textoOriginal.trim().toLowerCase()).replace(/[¡!¿?.,]/g, "");
  return SALUDOS.includes(texto);
}

export function interpretarConsulta(textoOriginal: string, ahora: Date = new Date()): Consulta {
  const texto = sinAcentos(textoOriginal.toLowerCase().trim());

  const esCorte = /\bcorte(s)?\s+de\s+caja\b|\bcierre(s)?\s+de\s+caja\b/.test(texto);
  if (esCorte) {
    return { tipo: "corte", fecha: extraerFecha(texto, ahora) ?? formatoFecha(ahora) };
  }

  // "resumen" es un caso particular (y más simple) de estadística: un
  // solo mes, con el total y el top de procedimientos ya juntos — se
  // revisa primero porque su forma de pedirlo es más común que las
  // demás estadísticas.
  const esResumen = /\bresumen\b/.test(texto);
  if (esResumen) {
    return { tipo: "resumen", mes: extraerMes(texto, ahora) ?? formatoMes(ahora) };
  }

  const esEstadistica = /\bestadisticas?\b|\bpromedio\b|\bforma(s)?\s+de\s+pago\b/.test(texto);
  if (esEstadistica) {
    const { desde, hasta } = extraerRango(texto, ahora);
    return { tipo: "estadistica", metrica: extraerMetrica(texto), desde, hasta };
  }

  // "gráfica de mis ingresos", "cómo van los ingresos", "tendencia de
  // este año", "proyección para diciembre" — se revisa antes de la
  // búsqueda de folio/nombre porque ninguna de esas palabras tiene
  // sentido como nombre de persona. "proyectar" se activa con
  // palabras que de verdad piden una estimación a futuro, no solo ver
  // los números que ya pasaron.
  const esGrafica = /\bgraf(i|í)cas?\b|\btendencia\b|\bcomo\s+van\b/.test(texto);
  const esProyeccion = /\bproyecci[oó]n\b|\bproyectar\b|\bestimad[oa]\b|\ba\s+futuro\b|\bva\s+a\s+estar\b/.test(texto);
  if (esGrafica || esProyeccion) {
    return { tipo: "grafica", meses: extraerMesesGrafica(texto), proyectar: esProyeccion };
  }

  // "compara este mes con el anterior", "cómo voy respecto al mes
  // pasado", "cuánto crecí" — se revisa antes de "creditos"/"persona"
  // porque "comparado", "respecto" y "crecimiento" no tienen sentido
  // como nombre de persona ni como pregunta de créditos.
  const esComparacion = /\bcompara(r|d[oa]|ci[oó]n)?\b|\brespecto\s+al?\s+mes\s+pasado\b|\bcrec(i| imiento)\b|\bmejor[oó]|\bempeor[oó]/.test(texto);
  if (esComparacion) {
    return { tipo: "comparacion", ...extraerComparacion(ahora) };
  }

  // "créditos pendientes", "quién me debe", "cuánto me deben", "por
  // cobrar" — un resumen agregado, no la lista completa (esa ya existe
  // en la pantalla de Créditos).
  const esCreditos = /\bcreditos?\s+pendientes?\b|\bquien(es)?\s+me\s+debe\b|\bcuanto\s+me\s+deben\b|\bpor\s+cobrar\b/.test(texto);
  if (esCreditos) {
    return { tipo: "creditos" };
  }

  // "cuánto ha pagado Ana García", "cuánto debe Juan Pérez" — un total
  // agregado para esa persona, a diferencia de "busqueda" (que regresa
  // la lista de folios). Se revisa antes de "busqueda" porque comparte
  // la palabra "de", pero aquí SÍ importa que venga con intención de
  // sumar algo, no solo de encontrar un folio.
  const esPersona = /\bcuanto\s+(ha\s+)?(pagado|gastado|debe)\b/.test(texto);
  if (esPersona) {
    return { tipo: "persona", nombre: extraerNombrePersona(textoOriginal) };
  }

  // "mi mejor día de agosto", "el peor día de este mes", "por
  // categoría" — sin IA solo se reconocen estos dos agrupamientos (los
  // demás, como "por forma de pago" o "por procedimiento", ya los
  // cubre "estadistica" arriba); con IA, Gemini entiende muchas más
  // combinaciones de filtro y agrupación (ver asistente.ts).
  const esPorDia = /\bmejor\s+dia\b|\bpeor\s+dia\b|\bpor\s+dia\b/.test(texto);
  const esPorCategoria = /\bpor\s+categoria\b/.test(texto);
  if (esPorDia || esPorCategoria) {
    const { desde, hasta } = extraerRango(texto, ahora);
    const metrica: MetricaLibre = /\bpeor\b/.test(texto) ? "minimo" : /\bmejor\b/.test(texto) ? "maximo" : "total";
    return { tipo: "libre", desde, hasta, metrica, agruparPor: esPorDia ? "dia" : "categoria" };
  }

  // "folios de Ana García", "los de Ana García", o de plano solo
  // "Ana García" — en todos los casos se busca ese texto como nombre o
  // folio, igual que la búsqueda global ya existente.
  const conDe = textoOriginal.match(/(?:folios?\s+de\s+|de\s+)(.+)/i);
  const texto2 = (conDe ? conDe[1] : textoOriginal).trim();
  return { tipo: "busqueda", texto: texto2 || textoOriginal.trim() };
}
