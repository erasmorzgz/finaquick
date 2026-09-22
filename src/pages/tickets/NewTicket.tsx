import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Users, UserCircle2, X, Printer, Eraser, Wallet, Banknote, CreditCard, History, Eye, CheckCircle2 } from "lucide-react";
import { Card, CardBody, SectionLabel } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { SearchSelect } from "../../components/ui/SearchSelect";
import { EmptyState } from "../../components/ui/Misc";
import { useService } from "../../lib/service/ServiceContext";
import { useAuth } from "../../lib/auth/AuthContext";
import * as db from "../../lib/db";
import { ErrorApi } from "../../lib/db/localApiAdapter";
import type { CategoriaServicio, FormaPago, NuevoTicket, Procedimiento, Ticket } from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";
import { clsx } from "clsx";

const TIPOS = [
  { id: "Estudiante", icon: GraduationCap },
  { id: "Externo", icon: UserCircle2 },
  { id: "Comunidad Anáhuac", icon: Users },
];

// Un prefijo, no una sola clave fija — cada intento se guarda aparte,
// bajo SU PROPIA clave de idempotencia. Con una única clave global (la
// primera versión de esto), un segundo intento pendiente sobrescribía
// al primero sin conciliarlo, y la respuesta de uno podía borrar, sin
// querer, el intento del OTRO. Ver el efecto de recuperación más abajo.
const PREFIJO_STORAGE_INTENTO = "finaquick_ticket_pendiente:";

interface IntentoGuardado {
  ticket: NuevoTicket;
  // A quién pertenece este intento — sin esto, si A deja un intento a
  // medias (la respuesta se perdió) y B inicia sesión en la MISMA
  // pestaña después, la recuperación podía reenviar el folio de A bajo
  // la sesión de B, atribuyéndoselo. Nunca se reenvía un intento cuyo
  // dueño no coincide con quien tiene la sesión abierta ahora mismo —
  // se deja intacto en sessionStorage, sin tocar, para cuando su dueño
  // real vuelva a esta pestaña (o para que un administrador lo
  // reconcilie a mano si hiciera falta).
  usuarioId: string;
}

function claveStorageDe(idempotencyKey: string): string {
  return PREFIJO_STORAGE_INTENTO + idempotencyKey;
}

// Cuándo el resultado de guardar un folio sigue siendo DESCONOCIDO
// (hay que conservar el intento para reconciliarlo después) en vez de
// DEFINITIVO (el servidor ya dijo que no con una respuesta real, y
// repetir la misma petición no cambiaría esa respuesta):
// - Un fetch que nunca llegó a completarse (red caída, servidor
//   inalcanzable) rechaza con un TypeError, antes de que exista
//   ninguna respuesta HTTP que leer — el resultado real es un misterio
//   total.
// - Un 5xx (500/502/503/504) SÍ es una respuesta HTTP, pero no una
//   decisión real del servidor sobre esta petición — puede venir de un
//   proxy o balanceador que la cortó después de que el servidor ya
//   hubiera guardado el folio, y antes de que la respuesta de éxito
//   llegara de vuelta. Tratarlo igual que un 400/409 (rechazo
//   definitivo, se borra el intento) perdía la única referencia que
//   permitía reconciliar un folio que en realidad sí se había creado.
// Solo un 4xx (400, 404, 409…) es de verdad definitivo: ahí sí hubo
// una decisión real del servidor sobre el contenido de la petición.
function resultadoDesconocido(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof ErrorApi) return err.status >= 500;
  return false;
}

export default function NewTicket() {
  const { servicioActual } = useService();
  const { user } = useAuth();
  const [categorias, setCategorias] = useState<CategoriaServicio[]>([]);
  const [procCatalogo, setProcCatalogo] = useState<Procedimiento[]>([]);

  const [tipoUsuario, setTipoUsuario] = useState("Estudiante");
  const [nombre, setNombre] = useState("");
  const [identificador, setIdentificador] = useState("");
  const [numeroProyecto, setNumeroProyecto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [procQuery, setProcQuery] = useState("");
  const [seleccion, setSeleccion] = useState<Procedimiento[]>([]);
  // Dos pasos, no uno: "mostrarConfirmacion" es antes de guardar (elegir
  // cómo se pagó — todavía no existe ningún folio real), "ticketCreado"
  // es lo que el servidor devolvió después de guardar de verdad, con su
  // folio y (si aplica) su número de proyecto ya asignados ahí — el
  // servidor los asigna, no el navegador.
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
  const [ticketCreado, setTicketCreado] = useState<Ticket | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  // Una por cada intento de guardar este folio (se genera al abrir la
  // confirmación, no en cada click de "pagar") — si el guardado falla
  // por red y la persona reintenta el MISMO intento, se reenvía la
  // misma clave para que el servidor detecte un reintento en vez de
  // crear un folio duplicado con el mismo cobro contado dos veces.
  const [claveIdempotencia, setClaveIdempotencia] = useState<string | null>(null);

  useEffect(() => {
    if (!servicioActual) return;
    db.listarCategorias(servicioActual.id).then(setCategorias);
    db.listarProcedimientos(servicioActual.id).then(setProcCatalogo);
  }, [servicioActual]);

  // Recupera un intento de guardar que se quedó a medias — la clave de
  // idempotencia solo servía de algo mientras viviera en memoria de
  // React: perder la respuesta original Y recargar la página (o
  // cerrar/volver a abrir la pestaña) antes de que llegara esa
  // respuesta dejaba sin forma de reenviar la MISMA petición, así que
  // un reintento manual generaba una clave nueva y, con ella, un folio
  // genuinamente duplicado. Guardar el intento en sessionStorage justo
  // antes de mandarlo (ver confirmarPago) y reintentarlo aquí, al
  // montar, cierra ese hueco — si el servidor ya lo había guardado de
  // verdad, esto regresa el mismo folio en vez de crear otro.
  useEffect(() => {
    if (!servicioActual || !user) return;
    let claves: string[];
    try {
      claves = Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIJO_STORAGE_INTENTO));
    } catch {
      return; // sessionStorage no disponible — nada que recuperar
    }
    for (const clave of claves) {
      let guardado: string | null;
      try {
        guardado = sessionStorage.getItem(clave);
      } catch {
        continue;
      }
      if (!guardado) continue;
      let entrada: IntentoGuardado;
      try {
        entrada = JSON.parse(guardado);
      } catch {
        try {
          sessionStorage.removeItem(clave);
        } catch {
          // nada más que hacer si ni siquiera esto se puede
        }
        continue;
      }
      const { ticket: intento, usuarioId } = entrada;
      // Ni de otro servicio (se deja para cuando corresponda) ni de
      // otra cuenta (ver el comentario de IntentoGuardado — nunca se
      // reenvía bajo una sesión distinta a la que lo dejó a medias).
      if (intento.servicioId !== servicioActual.id) continue;
      if (usuarioId !== user.id) continue;
      db.crearTicket(intento)
        .then((creado) => {
          try {
            sessionStorage.removeItem(clave); // solo ESTE intento — nunca todo el almacén
          } catch {
            // el folio ya quedó confirmado igual — esto es solo limpieza
          }
          setTicketCreado(creado);
        })
        .catch((err) => {
          if (!resultadoDesconocido(err)) {
            // El servidor sí dio una decisión real y definitiva sobre
            // esta petición — reenviarla tal cual solo repetiría el
            // mismo rechazo en cada recarga.
            try {
              sessionStorage.removeItem(clave);
            } catch {
              // ver comentario de arriba
            }
          }
          // No se fuerza si el resultado sigue siendo desconocido: se
          // avisa, en vez de fallar en silencio, para que quien esté en
          // recepción sepa que hay un cobro sin confirmar todavía.
          setErrorGuardar(
            `Hay un folio sin confirmar de un intento anterior (${intento.nombre || "sin nombre"}) — ` +
              (err instanceof Error ? err.message : "no se pudo confirmar todavía. Vuelve a intentarlo.")
          );
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioActual?.id, user?.id]);

  // "Externo" no tiene ID institucional: el sistema le asigna un número de
  // proyecto consecutivo en vez de pedírselo — se recalcula cada vez que
  // podría cambiar el consecutivo (cambia el tipo, o ya se generó un
  // ticket). Es solo una vista previa: el número real lo asigna el
  // servidor al guardar, no necesariamente este mismo valor, si otra
  // persona generó uno mientras tanto — ver POST /tickets.
  useEffect(() => {
    if (!servicioActual || tipoUsuario !== "Externo") return;
    db.siguienteNumeroProyecto(servicioActual.id).then(setNumeroProyecto);
  }, [servicioActual, tipoUsuario, ticketCreado]);

  const total = useMemo(() => seleccion.reduce((s, p) => s + p.precio, 0), [seleccion]);
  const procOptions = procCatalogo
    .filter((p) => !seleccion.some((s) => s.id === p.id))
    .filter((p) => p.nombre.toLowerCase().includes(procQuery.toLowerCase()));

  if (!servicioActual) return null;
  const f = servicioActual.features;

  // Acceso de solo consulta: aunque nadie vea el atajo en el menú, esto
  // bloquea entrar directo por la URL también.
  if (user?.serviciosSoloConsulta?.includes(servicioActual.id)) {
    return (
      <EmptyState
        icon={<Eye size={24} strokeWidth={1.75} />}
        title="Tienes acceso de solo consulta aquí"
        hint={`Puedes ver el historial y la actividad de ${servicioActual.nombre}, pero no generar folios nuevos. Si necesitas hacerlo, pídele a un administrador que te cambie a acceso completo.`}
      >
        <Link to="/app/historial" className="mt-4 inline-block">
          <Button variant="secondary" icon={<History size={15} />}>Ir a Historial</Button>
        </Link>
      </EmptyState>
    );
  }

  function limpiar() {
    setTipoUsuario("Estudiante");
    setNombre("");
    setIdentificador("");
    setCategoria("");
    setSeleccion([]);
    setProcQuery("");
    setClaveIdempotencia(null);
  }

  function generarTicket() {
    if (!user || !servicioActual) return;
    setErrorGuardar(null);
    // Si ya existe una clave de un intento anterior de ESTA sesión que
    // todavía sigue pendiente en sessionStorage (una respuesta que
    // nunca llegó — la única razón por la que sigue ahí, ver
    // confirmarPago), se reusa esa misma clave EN VEZ de generar una
    // nueva — pero solo si los datos del formulario que ya están
    // fijados en este punto (nombre, identificador, tipo, categoría,
    // procedimientos) siguen siendo los mismos que se guardaron con esa
    // clave. Si la persona los cambió desde entonces, ya no es un
    // reintento del mismo intento — es una operación distinta, y
    // reusar la clave sobrescribiría en sessionStorage el único rastro
    // del intento original sin resolver, perdiendo la referencia que
    // hiciera falta para reconciliarlo si en realidad sí se había
    // guardado del lado del servidor. (estado/formaPago no entran en
    // esta comparación — todavía no se eligen a esta altura, se fijan
    // recién en confirmarPago.)
    let claveVigente: string | null = null;
    if (claveIdempotencia) {
      try {
        const guardado = sessionStorage.getItem(claveStorageDe(claveIdempotencia));
        if (guardado) {
          const { ticket: anterior } = JSON.parse(guardado) as IntentoGuardado;
          const mismosDatos =
            anterior.nombre === nombre &&
            (anterior.identificador ?? "") === (tipoUsuario === "Externo" ? "" : identificador || "") &&
            anterior.tipoUsuario === tipoUsuario &&
            anterior.categoria === categoria &&
            JSON.stringify([...anterior.procedimientoIds].sort()) === JSON.stringify(seleccion.map((p) => p.id).sort());
          if (mismosDatos) claveVigente = claveIdempotencia;
        }
      } catch {
        // sessionStorage no disponible, o el JSON guardado no es
        // válido — se genera una nueva, como si no hubiera nada
        // pendiente.
      }
    }
    setClaveIdempotencia(claveVigente ?? crypto.randomUUID());
    setMostrarConfirmacion(true);
  }

  async function confirmarPago(opcion: FormaPago | "credito") {
    // "guardando" además de "!mostrarConfirmacion": sin esto, dos clics
    // rápidos en el mismo botón (o un doble toque en una tablet)
    // podían generar el folio DOS veces — nada en el servidor lo
    // impedía, porque cada clic es una petición válida por sí sola.
    if (!mostrarConfirmacion || guardando || !servicioActual || !user || !claveIdempotencia) return;
    const nuevo: NuevoTicket = {
      servicioId: servicioActual.id,
      nombre,
      identificador: tipoUsuario === "Externo" ? undefined : identificador || undefined,
      tipoUsuario,
      categoria,
      procedimientoIds: seleccion.map((p) => p.id),
      estado: opcion === "credito" ? "credito" : "pagado",
      formaPago: opcion === "credito" ? undefined : opcion,
      idempotencyKey: claveIdempotencia,
    };
    const clave = claveStorageDe(claveIdempotencia);
    setErrorGuardar(null);
    setGuardando(true);
    // Se guarda ANTES de mandar la petición, no después de que falle
    // — si el navegador se cierra o pierde la conexión mientras la
    // petición sigue en el aire (ni éxito ni error todavía), el efecto
    // de recuperación de arriba necesita encontrar este intento igual
    // al volver a abrir la página. Bajo su PROPIA clave (no una global
    // compartida) para que un segundo intento — de este mismo folio o
    // de otro — nunca lo sobrescriba ni lo borre por error.
    try {
      sessionStorage.setItem(clave, JSON.stringify({ ticket: nuevo, usuarioId: user.id } satisfies IntentoGuardado));
    } catch {
      // sessionStorage no disponible (modo privado estricto, etc.) —
      // sin bloquear el guardado normal por esto; solo se pierde la
      // recuperación tras recargar, no la protección contra el doble
      // clic normal (esa la sigue dando "guardando" arriba).
    }
    try {
      // El folio, el total y (si aplica) el número de proyecto de la
      // respuesta son los que de verdad quedaron guardados — los
      // asigna el servidor, no lo que se haya mostrado como vista
      // previa mientras se llenaba el formulario.
      const creado = await db.crearTicket(nuevo);
      try {
        sessionStorage.removeItem(clave);
      } catch {
        // ver comentario de arriba
      }
      setMostrarConfirmacion(false);
      setTicketCreado(creado);
    } catch (err) {
      // Sin este catch, un folio que fallara al guardarse (red caída,
      // el servidor rechazándolo) no avisaba nada — la persona en
      // recepción podía pensar que sí quedó cobrado cuando en realidad
      // nunca se guardó, un problema real de cuadre de caja.
      if (!resultadoDesconocido(err)) {
        // El servidor ya dio una decisión real y definitiva (4xx) — no
        // una caída de red ni un 5xx de por medio — así que conservar
        // el intento solo lo reenviaría idéntico, y con el mismo
        // rechazo, en cada recarga.
        try {
          sessionStorage.removeItem(clave);
        } catch {
          // ver comentario de arriba
        }
      }
      setErrorGuardar(err instanceof Error ? err.message : "No se pudo guardar el folio — vuelve a intentar.");
    } finally {
      setGuardando(false);
    }
  }

  function cerrarConfirmacion() {
    setTicketCreado(null);
    limpiar();
  }

  const idListo = !f.requiereId || tipoUsuario === "Externo" || identificador.trim().length > 0;
  const puedeGenerar = nombre.trim().length > 1 && categoria.trim().length > 0 && seleccion.length > 0 && idListo;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <Card glass>
        <CardBody className="pt-5">
          <SectionLabel>Tipo de usuario</SectionLabel>
          <div className="mb-5 flex flex-wrap gap-2">
            {TIPOS.map((t) => {
              const activo = tipoUsuario === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTipoUsuario(t.id)}
                  title={t.id}
                  className={clsx(
                    "inline-flex items-center gap-0 rounded-full border p-2 text-sm font-semibold transition-[background-color,border-color,color,padding-right] duration-150 ease-out-emil",
                    activo
                      ? "border-brand-600 bg-brand-600 pr-3.5 text-white"
                      : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand-300"
                  )}
                >
                  <t.icon size={15} className="flex-shrink-0" />
                  <span
                    className={clsx(
                      "overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-[180ms] ease-out-emil",
                      activo ? "ml-1.5 max-w-[180px] opacity-100" : "max-w-0 opacity-0"
                    )}
                  >
                    {t.id}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={servicioActual.campoPersonaLabel}>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Apellido Nombre" />
            </Field>
            {f.requiereId && tipoUsuario === "Externo" && (
              <Field label="Número de proyecto" hint="Lo asigna el sistema automáticamente.">
                <Input value={numeroProyecto} disabled className="font-mono opacity-70" />
              </Field>
            )}
            {f.requiereId && tipoUsuario !== "Externo" && (
              <Field label={servicioActual.campoIdLabel}>
                <Input value={identificador} onChange={(e) => setIdentificador(e.target.value)} placeholder="Ej. 2021012345" />
              </Field>
            )}
          </div>

          <Field label={servicioActual.campoCategoriaLabel}>
            <SearchSelect
              options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
              value={categoria}
              onChange={setCategoria}
              placeholder="Busca o escribe…"
            />
          </Field>

          <Field label="Procedimientos">
            {seleccion.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {seleccion.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                    {p.nombre} <span className="opacity-70">{formatoMXN(p.precio)}</span>
                    <button onClick={() => setSeleccion((s) => s.filter((x) => x.id !== p.id))} className="ml-0.5 opacity-70 hover:opacity-100">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <SearchSelect
              options={procOptions.map((p) => ({ id: p.id, label: p.nombre, meta: formatoMXN(p.precio) }))}
              value={procQuery}
              onChange={(label) => {
                const found = procCatalogo.find((p) => p.nombre === label);
                if (found) {
                  setSeleccion((s) => [...s, found]);
                  setProcQuery("");
                } else {
                  setProcQuery(label);
                }
              }}
              placeholder="Busca procedimiento…"
            />
          </Field>

          <div className="hero-gradient hero-dots relative mt-2 flex items-center justify-between overflow-hidden rounded-[var(--radius-card)] px-5 py-4">
            <span className="text-sm font-semibold text-white/80">Total estimado</span>
            <span className="tabular text-2xl font-extrabold text-white">{formatoMXN(total)}</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button icon={<Printer size={16} />} disabled={!puedeGenerar} onClick={generarTicket}>
              Generar folio
            </Button>
            <Button variant="secondary" icon={<Eraser size={16} />} onClick={limpiar}>
              Limpiar
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card glass className="h-fit">
        <CardBody className="pt-5">
          <SectionLabel>Catálogo de {servicioActual.nombre}</SectionLabel>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {procCatalogo.length} procedimiento(s) · {categorias.length} categoría(s) disponibles. Se administran desde{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">Configuración</span>.
          </p>
        </CardBody>
      </Card>

      <Modal
        open={mostrarConfirmacion}
        onClose={() => { if (!guardando) { setMostrarConfirmacion(false); setErrorGuardar(null); } }}
        title="Confirmar folio nuevo"
        subtitle={nombre || undefined}
      >
        <div>
          <p className="tabular mb-5 text-center text-3xl font-extrabold text-brand-600">{formatoMXN(total)}</p>
          <p className="mb-3 text-center text-sm font-semibold text-[var(--color-text-secondary)]">¿Cómo pagó?</p>
          {errorGuardar && (
            <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {errorGuardar}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button variant="secondary" icon={<Banknote size={16} />} disabled={guardando} onClick={() => confirmarPago("Efectivo")}>Efectivo</Button>
            <Button variant="secondary" icon={<CreditCard size={16} />} disabled={guardando} onClick={() => confirmarPago("Tarjeta de débito")}>Tarjeta de débito</Button>
            <Button variant="secondary" icon={<CreditCard size={16} />} disabled={guardando} onClick={() => confirmarPago("Tarjeta de crédito")}>Tarjeta de crédito</Button>
            {f.creditos && (
              <Button variant="outline" icon={<Wallet size={16} />} disabled={guardando} onClick={() => confirmarPago("credito")}>Agregar a crédito</Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Paso posterior a guardar: el folio de aquí ya es el real,
          asignado por el servidor — antes se mostraba uno inventado en
          el navegador antes incluso de intentar guardar. */}
      <Modal open={!!ticketCreado} onClose={cerrarConfirmacion} title="Folio guardado" subtitle={ticketCreado ? `${ticketCreado.folio} · ${ticketCreado.nombre}` : undefined}>
        {ticketCreado && (
          <div className="flex flex-col items-center text-center">
            <CheckCircle2 size={40} className="mb-3 text-emerald-500" strokeWidth={1.75} />
            <p className="tabular mb-1 text-3xl font-extrabold text-brand-600">{formatoMXN(ticketCreado.total)}</p>
            <p className="mb-5 font-mono text-sm text-[var(--color-text-secondary)]">{ticketCreado.folio}</p>
            <Button icon={<Printer size={16} />} onClick={cerrarConfirmacion}>Listo</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
