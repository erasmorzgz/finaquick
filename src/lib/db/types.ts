// Modelo de datos de la plataforma. Esta capa es independiente del backend
// que la implemente, sin que el resto de la app cambie una sola línea —
// ver src/lib/db/index.ts.

export type Role = "admin" | "finanzas" | "personal";

// Una organización ("equipo" / "workspace") dentro de Finaquick. Una misma
// cuenta puede pertenecer a varias (ej. "Anáhuac Xalapa" y "Anáhuac
// Córdoba") y cambiar entre ellas — cada una tiene su propio color de
// marca, sus propios servicios, catálogo y tickets. Nada de esto debe
// estar fijo en el código, solo aquí.
export interface Organization {
  id: string;
  nombre: string;
  colorPrimario: string; // hex; de aquí se deriva toda la escala --color-brand-*
  logoUrl?: string; // dataURL; opcional, el cliente puede no tener logo todavía
}

export interface UserProfile {
  id: string;
  nombre: string;
  correo: string;
  telefono?: string;
  fotoUrl?: string; // dataURL por ahora
  // Firma dibujada una sola vez desde Mi perfil (dataURL de un canvas,
  // mismo formato y límite que fotoUrl) — se puede estampar con un
  // clic al aprobar/rechazar una requisición, en vez de dibujarla cada
  // vez (ver Requisicion.firmaResolucion más abajo).
  firmaUrl?: string;
  bio?: string;
  rol: Role;
  orgIds: string[]; // a qué organizaciones (equipos/workspaces) pertenece esta cuenta
  servicioIds: string[]; // dentro de esas organizaciones, a qué servicios está vinculado
  // De los servicios de arriba, cuáles son "solo consulta" (ve historial y
  // actividad, pero no genera folios nuevos ahí). Ausente = acceso normal;
  // así una cuenta creada antes de que existiera esto no pierde nada.
  serviciosSoloConsulta?: string[];
  creadoEn: string;
  // Autenticación de dos factores (servidor propio) — ausente/false en
  // cuentas que no la han activado.
  totpHabilitado?: boolean;
  // true cuando un administrador le acaba de generar una contraseña
  // temporal a esta cuenta — el servidor bloquea el resto de la app
  // hasta que la cambie (ver ChangePasswordRequired.tsx).
  debeCambiarPassword?: boolean;
  // true en una cuenta que se creó por Microsoft y nunca tuvo una
  // contraseña propia — Profile.tsx lo usa para pedir reautenticación
  // con Microsoft en vez de una contraseña al iniciar la configuración
  // de 2FA (ver POST /auth/2fa/iniciar).
  soloMicrosoft?: boolean;
}

/** Lo que regresa iniciarSesion() cuando la cuenta tiene 2FA activo:
 * la contraseña ya se verificó, pero todavía falta el código — no es
 * un perfil todavía. */
export interface Requiere2FA {
  requiere2FA: true;
  tokenPre: string;
}

// Una invitación pendiente: un admin autoriza un correo a unirse a su
// organización, con el rol y los servicios que va a tener desde el
// principio. El registro abierto (cualquiera con cualquier correo) no
// tiene sentido para una herramienta que maneja dinero de una
// institución — así que registrarse ahora exige tener una invitación
// vigente para ese correo.
export interface Invitacion {
  id: string;
  correo: string;
  orgId: string;
  rol: Role;
  servicioIds: string[];
  creadaPor: string; // userId del admin que invitó
  creadaEn: string;
  // Solo viene en la respuesta de crearInvitacion() — nunca en el
  // listado. Es lo que la persona invitada necesita presentar junto
  // con su correo para registrarse; quien invita debe dárselo por un
  // canal que elija (en persona, por chat, por su propio correo
  // institucional).
  token?: string;
}

// Bitácora de acciones administrativas (quién eliminó qué, quién cambió
// el rol de quién) — no registra el uso normal del día a día (eso ya lo
// cubre Actividad), solo lo que un administrador decide y que conviene
// poder rastrear después.
export interface EventoAuditoria {
  id: string;
  orgId: string;
  actorId: string;
  actorNombre: string;
  accion: string; // ej. "Eliminó el servicio"
  detalle: string; // ej. "Nutrición y Bienestar"
  fecha: string; // ISO
}

export interface ServiceFeatureFlags {
  creditos: boolean; // permite dejar cuentas pendientes de pago
  cierreCaja: boolean; // permite generar cortes de caja
  requisiciones: boolean; // permite solicitar material/compras con aprobación
  requiereId: boolean;
  esDerechoClinica: boolean; // caso especial heredado (solo Odontología)
}

export interface ServiceConfig {
  id: string;
  orgId: string; // a qué organización pertenece — un usuario solo ve servicios de sus organizaciones
  nombre: string;
  icono: string; // clave que resuelve <ServiceIcon> a un ícono real (ver components/ui/ServiceIcon.tsx)
  color?: string;
  campoPersonaLabel: string;
  campoIdLabel: string;
  campoCategoriaLabel: string;
  cierreCajaLabel: string; // nombre "profesional" configurable, ej. "Cierre de caja"
  features: ServiceFeatureFlags;
  activo: boolean;
}

export interface CategoriaServicio {
  id: string;
  servicioId: string;
  nombre: string;
}

export interface Procedimiento {
  id: string;
  servicioId: string;
  nombre: string;
  precio: number;
}

export type FormaPago = "Efectivo" | "Tarjeta de débito" | "Tarjeta de crédito";
export type EstadoTicket = "pagado" | "credito";

export interface TicketProcedimiento {
  procedimientoId: string;
  nombre: string;
  costo: number;
}

export interface Ticket {
  id: string;
  servicioId: string;
  folio: string;
  nombre: string;
  identificador?: string;
  tipoUsuario: string;
  categoria: string; // materia / clínica / tipo de proyecto...
  procedimientos: TicketProcedimiento[];
  total: number;
  estado: EstadoTicket;
  formaPago?: FormaPago;
  creadoPor: string; // userId
  fecha: string; // ISO — cuándo se generó el folio, no cuándo se cobró
  // Cuándo se registró el pago de verdad (POST /tickets/:id/pago) —
  // ausente en folios que siguen en crédito, o que ya nacieron
  // "pagado" (ahí coincide con "fecha", así que no hace falta
  // guardarlo aparte). Los reportes de ingresos por mes todavía
  // agrupan por "fecha", no por este campo — ver el comentario en
  // esquema_local.sql sobre por qué eso queda como una decisión
  // pendiente, no resuelta unilateralmente aquí.
  fechaPago?: string; // ISO
}

/** Lo que el navegador manda para crear un folio — a diferencia de
 * Ticket (lo que el servidor devuelve), aquí NO va folio, total,
 * procedimientos con su costo, ni fecha: todo eso lo calcula y asigna
 * el servidor a partir de procedimientoIds y su propio reloj, nunca a
 * partir de lo que mande el cliente. */
export interface NuevoTicket {
  servicioId: string;
  nombre: string;
  identificador?: string;
  tipoUsuario: string;
  categoria: string;
  procedimientoIds: string[];
  estado: EstadoTicket;
  formaPago?: FormaPago;
  // Generada una sola vez por intento de guardar (ver NewTicket.tsx),
  // no en cada llamada — si la respuesta se pierde (red caída) y la
  // persona vuelve a darle a pagar con el mismo intento, el servidor
  // reconoce la misma clave y regresa el folio que ya se había creado
  // en vez de generar uno duplicado con el mismo cobro contado dos
  // veces. Opcional para no romper otros llamadores de crearTicket()
  // (datos demo, prueba de carga) que no la necesitan.
  idempotencyKey?: string;
}

export type EstadoRequisicion = "pendiente" | "aprobada" | "rechazada";

// Solicitud interna de compra/material, con aprobación de un
// administrador — no es un folio de cobro, no tiene total ni forma de
// pago. La firma, cuando existe, es una copia del momento en que se
// resolvió (aprobó/rechazó), no un enlace vivo al perfil de esa
// persona.
export interface Requisicion {
  id: string;
  servicioId: string;
  folio: string;
  concepto: string;
  cantidad: number;
  notas?: string;
  estado: EstadoRequisicion;
  solicitadoPor: string; // userId
  solicitanteNombre?: string;
  aprobadoPor?: string; // userId
  aprobadorNombre?: string;
  firmaResolucion?: string; // dataURL, copiada al resolver
  motivoRechazo?: string;
  creadoEn: string;
  resueltoEn?: string;
}

export interface NuevaRequisicion {
  servicioId: string;
  concepto: string;
  cantidad: number;
  notas?: string;
}

export interface MonthlyRevenuePoint {
  mes: string; // "2026-03"
  label: string; // "Mar 2026"
  total: number;
}

export interface ServiceRevenueBreakdown {
  servicioId: string;
  servicioNombre: string;
  total: number;
}

export interface ServiceComparisonRow {
  servicioId: string;
  servicioNombre: string;
  mesActual: number;
  mesAnterior: number;
  deltaPct: number | null; // null si mesAnterior === 0
}

// Un archivo enviado de un usuario a otro dentro de la misma organización
// (ej. el corte de caja de un servicio) — el contenido viaja como texto
// plano (CSV) para que la persona que lo recibe pueda reconstruir la
// descarga completa del lado del navegador, sin depender de un archivo
// guardado aparte en el servidor.
export interface ArchivoEnviado {
  id: string;
  orgId: string;
  deId: string; // userId de quien envía
  paraId: string; // userId de quien recibe
  servicioId?: string;
  servicioNombre?: string;
  tipo: string; // ej. "Cierre de caja" — etiqueta libre, no un enum cerrado
  nombreArchivo: string; // ej. "cierre-caja-clinica-dental-2026-08-30.csv"
  // Ausente en listarArchivosRecibidos() (metadata solamente, para no
  // volver a transferir el archivo completo cada vez que se actualizan
  // las notificaciones) — pedirlo aparte con obtenerContenidoArchivo(id)
  // en el momento en que alguien de verdad decide descargarlo.
  contenido?: string; // CSV/texto plano
  mensaje?: string;
  fecha: string; // ISO
  leido: boolean;
}
