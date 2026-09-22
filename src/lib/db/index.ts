// Punto único de entrada a los datos — toda la app habla con el
// servidor propio (servidor/api) a través de este módulo, sin que
// ninguna pantalla acceda a la base de datos directamente.
import * as modo from "./localApiAdapter";

export const registrar = modo.registrar;
export const iniciarSesion = modo.iniciarSesion;
export const cerrarSesion = modo.cerrarSesion;
export const cambiarPassword = modo.cambiarPassword;
export const pedirRestablecerPassword = modo.pedirRestablecerPassword;
export const restablecerPasswordConToken = modo.restablecerPasswordConToken;
export const confirmarCorreo = modo.confirmarCorreo;
export const sesionActual = modo.sesionActual;

export const completar2FA = modo.completar2FA;
export const iniciarConfiguracion2FA = modo.iniciarConfiguracion2FA;
export const confirmar2FA = modo.confirmar2FA;
export const desactivar2FA = modo.desactivar2FA;

export const listarUsuarios = modo.listarUsuarios;
export const actualizarPerfil = modo.actualizarPerfil;
export const cambiarRol = modo.cambiarRol;
export const restablecerPasswordUsuario = modo.restablecerPasswordUsuario;

export const crearInvitacion = modo.crearInvitacion;
export const listarInvitaciones = modo.listarInvitaciones;
export const eliminarInvitacion = modo.eliminarInvitacion;

export const listarServicios = modo.listarServicios;
export const actualizarServicio = modo.actualizarServicio;
export const crearServicio = modo.crearServicio;
export const eliminarServicio = modo.eliminarServicio;
export const listarCategorias = modo.listarCategorias;
export const crearCategoria = modo.crearCategoria;
export const eliminarCategoria = modo.eliminarCategoria;
export const listarProcedimientos = modo.listarProcedimientos;
export const guardarProcedimiento = modo.guardarProcedimiento;
export const eliminarProcedimiento = modo.eliminarProcedimiento;

export const listarTickets = modo.listarTickets;
export const siguienteNumeroProyecto = modo.siguienteNumeroProyecto;
export const crearTicket = modo.crearTicket;
export const registrarPago = modo.registrarPago;
export const registrarPagoLote = modo.registrarPagoLote;

export const ingresosMensuales = modo.ingresosMensuales;
export const ingresosPorServicio = modo.ingresosPorServicio;
export const comparativoMensualPorServicio = modo.comparativoMensualPorServicio;
export const totalPendienteCreditos = modo.totalPendienteCreditos;

export const listarOrganizaciones = modo.listarOrganizaciones;
export const listarTodasLasOrganizaciones = modo.listarTodasLasOrganizaciones;
export const obtenerOrganizacion = modo.obtenerOrganizacion;
export const actualizarOrganizacion = modo.actualizarOrganizacion;
export const crearOrganizacion = modo.crearOrganizacion;
export const eliminarOrganizacion = modo.eliminarOrganizacion;
export const obtenerOrgActualId = modo.obtenerOrgActualId;
export const establecerOrgActualId = modo.establecerOrgActualId;

export const enviarArchivo = modo.enviarArchivo;
export const listarArchivosRecibidos = modo.listarArchivosRecibidos;
export const marcarArchivoLeido = modo.marcarArchivoLeido;
export const obtenerContenidoArchivo = modo.obtenerContenidoArchivo;

export const registrarEvento = modo.registrarEvento;
export const listarEventos = modo.listarEventos;

export const buscarFolioGlobal = modo.buscarFolioGlobal;
export const interpretarConsultaIA = modo.interpretarConsultaIA;
export const narrarResultado = modo.narrarResultado;
export const chatLibre = modo.chatLibre;

export const listarRequisiciones = modo.listarRequisiciones;
export const crearRequisicion = modo.crearRequisicion;
export const resolverRequisicion = modo.resolverRequisicion;

export * from "./types";
