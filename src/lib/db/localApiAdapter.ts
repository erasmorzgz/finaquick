// Adaptador para el servidor propio (servidor/api) — habla con un backend
// de Node.js + PostgreSQL directo por HTTP, sin ninguna librería ni
// servicio de terceros. Qué adaptador se usa es cuestión de qué exporta
// src/lib/db/index.ts — el resto de la app no se entera.
import type {
  ArchivoEnviado,
  CategoriaServicio,
  EstadoRequisicion,
  EventoAuditoria,
  FormaPago,
  Invitacion,
  MonthlyRevenuePoint,
  NuevaRequisicion,
  NuevoTicket,
  Organization,
  Procedimiento,
  Requiere2FA,
  Requisicion,
  Role,
  ServiceComparisonRow,
  ServiceConfig,
  ServiceRevenueBreakdown,
  Ticket,
  UserProfile,
} from "./types";
import type { Consulta } from "../smartSearch";

export const URL_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Sigue siendo un Error normal (todo el código existente que hace
// `err instanceof Error ? err.message : ...` sigue funcionando igual)
// — pero conserva el status HTTP, para el puñado de llamadores que sí
// necesitan distinguir un rechazo del servidor (4xx: la petición está
// mal, repetirla igual no serviría) de una falla del propio servidor o
// de algo entre medio (5xx: un proxy, un balanceador, un timeout —
// pudo haber pasado cualquier cosa, incluido que la operación sí se
// aplicara y solo la respuesta se perdiera). Ver resultadoDesconocido()
// en NewTicket.tsx, el primer lugar que de verdad usa esta distinción.
export class ErrorApi extends Error {
  status: number;
  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
  }
}

// La sesión vive en una cookie httpOnly que pone el servidor — este
// archivo nunca la lee ni la guarda (JavaScript no puede, a propósito;
// así un XSS no puede robarla). "credentials: include" es lo único que
// hace falta para que el navegador la mande sola en cada petición.
async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}${ruta}`, {
    ...opciones,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opciones.headers ?? {}),
    },
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorApi(cuerpo.error ?? "Ocurrió un error inesperado.", res.status);
  return cuerpo as T;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---------- Auth ----------
export async function registrar(nombre: string, correo: string, password: string, token: string, trampa?: string): Promise<UserProfile> {
  const { perfil } = await pedir<{ perfil: UserProfile }>("/auth/registrar", {
    method: "POST",
    body: JSON.stringify({ nombre, correo: correo.trim(), password, token: token.trim(), trampa }),
  });
  return perfil;
}

// Con 2FA activo, la contraseña correcta no basta todavía — el
// servidor regresa requiere2FA + un token temporal en vez del perfil,
// y hace falta completar2FA() con el código antes de tener sesión de
// verdad. Sin 2FA, esto se comporta exactamente igual que antes.
export async function iniciarSesion(correo: string, password: string, trampa?: string): Promise<UserProfile | Requiere2FA> {
  const cuerpo = await pedir<{ perfil: UserProfile } | Requiere2FA>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ correo: correo.trim(), password, trampa }),
  });
  return "requiere2FA" in cuerpo ? cuerpo : cuerpo.perfil;
}

export async function completar2FA(tokenPre: string, codigo: string): Promise<UserProfile> {
  const { perfil } = await pedir<{ perfil: UserProfile }>("/auth/login/2fa", {
    method: "POST",
    body: JSON.stringify({ tokenPre, codigo }),
  });
  return perfil;
}

// Una cuenta con contraseña propia manda "password"; una cuenta solo
// de Microsoft (sin contraseña que escribir) manda "reauthToken" en su
// lugar — ver Tarjeta2FA en Profile.tsx y el flujo de reautenticación
// en servidor/api/src/microsoft.ts (?intent=2fa).
export async function iniciarConfiguracion2FA(
  credencial: { password: string } | { reauthToken: string }
): Promise<{ secretoManual: string; qr: string }> {
  return pedir("/auth/2fa/iniciar", { method: "POST", body: JSON.stringify(credencial) });
}

export async function confirmar2FA(codigo: string): Promise<void> {
  await pedir("/auth/2fa/confirmar", { method: "POST", body: JSON.stringify({ codigo }) });
}

export async function desactivar2FA(password: string): Promise<void> {
  await pedir("/auth/2fa/desactivar", { method: "POST", body: JSON.stringify({ password }) });
}

export async function cerrarSesion(): Promise<void> {
  // La cookie es httpOnly — no hay nada que borrar del lado del
  // navegador con JS, hay que pedírselo al servidor.
  await pedir("/auth/logout", { method: "POST" }).catch(() => {});
}

export async function cambiarPassword(_correo: string, actual: string, nueva: string): Promise<void> {
  await pedir("/auth/cambiar-password", { method: "POST", body: JSON.stringify({ actual, nueva }) });
}

// Estas tres solo hacen algo de verdad si el servidor tiene el envío
// de correo configurado — si no, pedirRestablecerPassword() regresa un
// mensaje claro pidiendo que un administrador lo haga (ver rutas.ts).
export async function pedirRestablecerPassword(correo: string): Promise<{ mensaje: string }> {
  return pedir("/auth/olvide-password", { method: "POST", body: JSON.stringify({ correo }) });
}

export async function restablecerPasswordConToken(token: string, password: string): Promise<void> {
  await pedir("/auth/restablecer-password-con-token", { method: "POST", body: JSON.stringify({ token, password }) });
}

export async function confirmarCorreo(token: string): Promise<void> {
  await pedir(`/auth/confirmar-correo?token=${encodeURIComponent(token)}`);
}

export async function sesionActual(): Promise<UserProfile | null> {
  try {
    const { perfil } = await pedir<{ perfil: UserProfile | null }>("/auth/sesion");
    return perfil;
  } catch {
    return null;
  }
}

export async function restablecerPasswordUsuario(id: string): Promise<{ passwordTemporal: string }> {
  return pedir(`/usuarios/${id}/restablecer-password`, { method: "POST" });
}

// ---------- Usuarios ----------
export async function listarUsuarios(): Promise<UserProfile[]> {
  return pedir("/usuarios");
}

export async function actualizarPerfil(id: string, cambios: Partial<UserProfile>): Promise<UserProfile> {
  return pedir(`/usuarios/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
}

export async function cambiarRol(id: string, rol: Role): Promise<void> {
  await pedir(`/usuarios/${id}/rol`, { method: "POST", body: JSON.stringify({ rol }) });
}

// ---------- Invitaciones ----------
export async function crearInvitacion(correo: string, orgId: string, rol: Role, servicioIds: string[], _creadaPor: string): Promise<Invitacion> {
  return pedir("/invitaciones", { method: "POST", body: JSON.stringify({ correo, orgId, rol, servicioIds }) });
}

export async function listarInvitaciones(orgId: string): Promise<Invitacion[]> {
  return pedir(`/invitaciones${qs({ orgId })}`);
}

export async function eliminarInvitacion(id: string): Promise<void> {
  await pedir(`/invitaciones/${id}`, { method: "DELETE" });
}

// ---------- Servicios ----------
export async function listarServicios(orgId: string): Promise<ServiceConfig[]> {
  return pedir(`/servicios${qs({ orgId })}`);
}

export async function actualizarServicio(id: string, cambios: Partial<ServiceConfig>): Promise<ServiceConfig> {
  return pedir(`/servicios/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
}

export async function crearServicio(nombre: string, icono: string, orgId: string): Promise<ServiceConfig> {
  return pedir("/servicios", { method: "POST", body: JSON.stringify({ nombre, icono, orgId }) });
}

export async function eliminarServicio(id: string): Promise<void> {
  await pedir(`/servicios/${id}`, { method: "DELETE" });
}

export async function listarCategorias(servicioId: string): Promise<CategoriaServicio[]> {
  return pedir(`/categorias${qs({ servicioId })}`);
}

export async function crearCategoria(nombre: string, servicioId: string): Promise<CategoriaServicio> {
  return pedir("/categorias", { method: "POST", body: JSON.stringify({ nombre, servicioId }) });
}

export async function eliminarCategoria(id: string): Promise<void> {
  await pedir(`/categorias/${id}`, { method: "DELETE" });
}

export async function listarProcedimientos(servicioId: string): Promise<Procedimiento[]> {
  return pedir(`/procedimientos${qs({ servicioId })}`);
}

export async function guardarProcedimiento(proc: Procedimiento): Promise<void> {
  await pedir("/procedimientos", { method: "PUT", body: JSON.stringify(proc) });
}

export async function eliminarProcedimiento(id: string): Promise<void> {
  await pedir(`/procedimientos/${id}`, { method: "DELETE" });
}

// ---------- Folios ----------
export async function listarTickets(servicioId: string): Promise<Ticket[]> {
  return pedir(`/tickets${qs({ servicioId })}`);
}

export async function siguienteNumeroProyecto(servicioId: string): Promise<string> {
  const { numero } = await pedir<{ numero: string }>(`/tickets/siguiente-numero${qs({ servicioId })}`);
  return numero;
}

/** Regresa el folio ya creado por el servidor (con su número de folio
 * y, para "Externo", su número de proyecto, ambos asignados ahí — el
 * navegador ya no los propone, solo los pide). */
export async function crearTicket(ticket: NuevoTicket): Promise<Ticket> {
  return pedir("/tickets", { method: "POST", body: JSON.stringify(ticket) });
}

// Por el id del ticket, no por su folio — el id es la llave primaria y
// nunca puede señalar a más de un folio a la vez, a diferencia de
// folio antes de que tuviera su propia restricción de unicidad.
export async function registrarPago(ticketId: string, formaPago: FormaPago): Promise<void> {
  await pedir(`/tickets/${encodeURIComponent(ticketId)}/pago`, { method: "POST", body: JSON.stringify({ formaPago }) });
}

// Para saldar varios folios de una sola cuenta a la vez (Credits.tsx) —
// todo o nada: si uno solo del grupo ya no está disponible para pagar,
// el servidor no aplica ninguno (ver POST /tickets/pago-lote). Antes,
// pagar un folio a la vez en un ciclo dejaba, si alguno a la mitad
// fallaba, algunos ya pagados y otros no, sin nada que lo deshiciera.
export async function registrarPagoLote(ticketIds: string[], formaPago: FormaPago): Promise<Ticket[]> {
  return pedir("/tickets/pago-lote", { method: "POST", body: JSON.stringify({ ticketIds, formaPago }) });
}

// ---------- Finanzas ----------
export async function ingresosMensuales(orgId: string, servicioId?: string): Promise<MonthlyRevenuePoint[]> {
  return pedir(`/finanzas/ingresos-mensuales${qs({ orgId, servicioId })}`);
}

export async function ingresosPorServicio(orgId: string, mes?: string): Promise<ServiceRevenueBreakdown[]> {
  return pedir(`/finanzas/ingresos-por-servicio${qs({ orgId, mes })}`);
}

export async function comparativoMensualPorServicio(orgId: string): Promise<ServiceComparisonRow[]> {
  return pedir(`/finanzas/comparativo${qs({ orgId })}`);
}

export async function totalPendienteCreditos(orgId: string, servicioId?: string): Promise<number> {
  const { total } = await pedir<{ total: number }>(`/finanzas/pendiente-creditos${qs({ orgId, servicioId })}`);
  return total;
}

// ---------- Organizaciones ----------
export async function listarOrganizaciones(_userId: string): Promise<Organization[]> {
  return pedir("/organizaciones");
}

export async function listarTodasLasOrganizaciones(): Promise<Organization[]> {
  return pedir("/organizaciones");
}

export async function obtenerOrganizacion(id: string): Promise<Organization | null> {
  const todas = await listarTodasLasOrganizaciones();
  return todas.find((o) => o.id === id) ?? null;
}

export async function actualizarOrganizacion(id: string, cambios: Partial<Organization>): Promise<Organization> {
  return pedir(`/organizaciones/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
}

export async function crearOrganizacion(nombre: string, _creadorUserId: string): Promise<Organization> {
  return pedir("/organizaciones", { method: "POST", body: JSON.stringify({ nombre }) });
}

export async function eliminarOrganizacion(id: string): Promise<void> {
  await pedir(`/organizaciones/${id}`, { method: "DELETE" });
}

// "Organización actual" es una preferencia de este navegador — no del
// servidor, ni de la cuenta — para recordar en qué organización se
// quedó viendo cada quien entre una visita y otra.
const CLAVE_ORG_ACTUAL = "asp_org_actual_v1";
export async function obtenerOrgActualId(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(CLAVE_ORG_ACTUAL);
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}
export async function establecerOrgActualId(id: string): Promise<void> {
  localStorage.setItem(CLAVE_ORG_ACTUAL, JSON.stringify(id));
}

// ---------- Archivos entre usuarios ----------
export async function enviarArchivo(archivo: Omit<ArchivoEnviado, "id" | "fecha" | "leido">): Promise<ArchivoEnviado> {
  return pedir("/archivos", { method: "POST", body: JSON.stringify(archivo) });
}

// Sin "contenido" — ver el comentario en ArchivoEnviado (types.ts) y en
// GET /archivos/recibidos del servidor.
export async function listarArchivosRecibidos(_userId: string): Promise<ArchivoEnviado[]> {
  return pedir("/archivos/recibidos");
}

export async function marcarArchivoLeido(id: string): Promise<void> {
  await pedir(`/archivos/${id}/leido`, { method: "POST" });
}

/** Pide el contenido completo de un archivo ya recibido — aparte del
 * listado, y solo en el momento en que alguien decide de verdad
 * descargarlo. */
export async function obtenerContenidoArchivo(id: string): Promise<string> {
  const { contenido } = await pedir<{ contenido: string }>(`/archivos/${id}/contenido`);
  return contenido;
}

// ---------- Bitácora de auditoría ----------
export async function registrarEvento(orgId: string, actorId: string, actorNombre: string, accion: string, detalle: string): Promise<void> {
  await pedir("/eventos", { method: "POST", body: JSON.stringify({ orgId, actorId, actorNombre, accion, detalle }) });
}

// "antesDe" (un ISO de un evento ya mostrado) es un cursor para pedir
// la siguiente tanda de eventos más viejos — no un número de página,
// que se desincroniza si mientras tanto se insertaron eventos nuevos.
// Opcional, para no romper otros llamadores que solo quieren la
// primera tanda (la más reciente).
export async function listarEventos(orgId: string, opciones?: { limit?: number; antesDe?: string }): Promise<EventoAuditoria[]> {
  return pedir(`/eventos${qs({ orgId, limit: opciones?.limit?.toString(), antesDe: opciones?.antesDe })}`);
}

// ---------- Búsqueda de folios entre servicios ----------
export async function buscarFolioGlobal(orgId: string, query: string): Promise<(Ticket & { servicioNombre: string })[]> {
  const q = query.trim();
  if (!q) return [];
  return pedir(`/buscar-folio${qs({ orgId, q })}`);
}

// ---------- Búsqueda en lenguaje natural (opcional, ver asistente.ts) ----------
// No usa pedir(): un 204 (sin IA configurada, o el proveedor falló) no
// trae cuerpo JSON — pedir() lo confundiría con {} en vez de "no hay
// respuesta". Nunca lanza: cualquier problema de red también cae en
// null, para que quien llama use la búsqueda por patrones sin más.
export async function interpretarConsultaIA(texto: string, historial: string[] = []): Promise<Consulta | null> {
  try {
    const res = await fetch(`${URL_BASE}/asistente/interpretar`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto, historial }),
    });
    if (res.status === 204 || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Redacta en prosa un resultado que ya se calculó del lado del
// navegador — `resumen` debe ser un objeto chico de valores simples
// (totales, conteos, nombres de procedimientos), nunca una lista de
// folios ni de nombres de personas (ver narrarResultado en
// servidor/api/src/asistente.ts). Igual que interpretarConsultaIA,
// nunca lanza: sin IA configurada, o si Gemini falla, regresa null y
// quien llama se queda con la frase fija de siempre.
export async function narrarResultado(tipo: string, resumen: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${URL_BASE}/asistente/narrar`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, resumen }),
    });
    if (res.status === 204 || !res.ok) return null;
    const data = await res.json();
    return typeof data?.texto === "string" ? data.texto : null;
  } catch {
    return null;
  }
}

// Chat libre: Gemini contesta directamente con un resumen ya agregado
// de la cuenta (nunca folios ni nombres de personas, salvo la de
// `digesto.personaMencionada` si la propia pregunta la nombró) — ver
// responderChatLibre en servidor/api/src/asistente.ts. Mismo
// contrato de siempre: nunca lanza, sin IA (o si Gemini falla)
// regresa null y quien llama cae de vuelta al flujo de clasificación.
export async function chatLibre(texto: string, historial: string[], digesto: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${URL_BASE}/asistente/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto, historial, digesto }),
    });
    if (res.status === 204 || !res.ok) return null;
    const data = await res.json();
    return typeof data?.texto === "string" ? data.texto : null;
  } catch {
    return null;
  }
}

// ---------- Requisiciones (solicitud interna de compra/material) ----------
export async function listarRequisiciones(servicioId: string): Promise<Requisicion[]> {
  return pedir(`/requisiciones${qs({ servicioId })}`);
}

export async function crearRequisicion(requisicion: NuevaRequisicion): Promise<Requisicion> {
  return pedir("/requisiciones", { method: "POST", body: JSON.stringify(requisicion) });
}

// conFirma: true estampa la firma YA guardada de quien resuelve (se
// lee del lado del servidor, de su propio perfil) — nunca se manda
// ninguna imagen de firma en esta llamada.
export async function resolverRequisicion(
  id: string,
  estado: Extract<EstadoRequisicion, "aprobada" | "rechazada">,
  opciones?: { conFirma?: boolean; motivoRechazo?: string }
): Promise<Requisicion> {
  return pedir(`/requisiciones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ estado, conFirma: opciones?.conFirma, motivoRechazo: opciones?.motivoRechazo }),
  });
}
