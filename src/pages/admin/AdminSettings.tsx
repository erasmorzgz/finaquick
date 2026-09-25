import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Plus, Trash2, Pencil, Check, UserPlus, Mail, History as IconHistory, Eye, PenLine, TriangleAlert, KeyRound, Copy, X } from "lucide-react";
import { Card, CardBody, SectionLabel } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Avatar, EmptyState } from "../../components/ui/Misc";
import { ServiceIcon, ICON_REGISTRY } from "../../components/ui/ServiceIcon";
import * as db from "../../lib/db";
import type { CategoriaServicio, EventoAuditoria, Invitacion, Procedimiento, Role, ServiceConfig, UserProfile } from "../../lib/db/types";
import { formatoMXN } from "../../lib/utils";
import { useOrg } from "../../lib/theme/OrgContext";
import { useAuth } from "../../lib/auth/AuthContext";
import { useService } from "../../lib/service/ServiceContext";
import { aplicarColorMarca } from "../../lib/theme/brand";
import { useAvisos } from "@/lib/avisos/AvisosContext";

// El restablecimiento de contraseña por un administrador solo existe
// en el servidor propio (servidor/api).
const enModoLocal = import.meta.env.VITE_BACKEND_MODE === "local";

// Muchas de estas pestañas administran la organización actual (la que
// eliges desde el selector de equipos en el menú de cuenta) — si cambias
// de organización mientras estás aquí, Servicios/Catálogo/Usuarios se
// vuelven a cargar para esa organización.

const TABS = [
  { id: "marca", label: "Marca" },
  { id: "servicios", label: "Servicios" },
  { id: "catalogo", label: "Catálogo" },
  { id: "usuarios", label: "Usuarios" },
  { id: "auditoria", label: "Auditoría" },
] as const;

export default function AdminSettings() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("marca");

  return (
    <div>
      <div className="mb-6 inline-flex flex-wrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded-full px-4 py-1.5 text-sm font-bold transition-colors",
              tab === t.id ? "bg-brand-600 text-white" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "marca" && <MarcaTab />}
      {tab === "servicios" && <ServiciosTab />}
      {tab === "catalogo" && <CatalogoTab />}
      {tab === "usuarios" && <UsuariosTab />}
      {tab === "auditoria" && <AuditoriaTab />}
    </div>
  );
}

// ---------------- Marca ----------------
const COLORES_SUGERIDOS = [
  { nombre: "Naranja Anáhuac", hex: "#e87722" },
  { nombre: "Azul", hex: "#2a5fd6" },
  { nombre: "Verde esmeralda", hex: "#0f9d58" },
  { nombre: "Violeta", hex: "#6d3fd6" },
  { nombre: "Rojo ladrillo", hex: "#c0392b" },
  { nombre: "Grafito", hex: "#3a3a3a" },
];

function MarcaTab() {
  const { org, orgs, refresh, eliminarOrganizacion } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState(org?.nombre ?? "");
  const [color, setColor] = useState(org?.colorPrimario ?? "#e87722");
  const [guardado, setGuardado] = useState(false);
  const avisar = useAvisos();
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setNombre(org.nombre);
      setColor(org.colorPrimario);
      db.listarServicios(org.id).then(setServicios);
    }
  }, [org]);

  async function eliminar() {
    if (!org) return;
    setErrorEliminar(null);
    if (!confirm(`¿Eliminar "${org.nombre}"? Esto no se puede deshacer — se pierde su marca, su equipo y su historial de auditoría.`)) return;
    setEliminando(true);
    try {
      await eliminarOrganizacion(org.id);
      navigate("/app/servicios");
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : "No se pudo eliminar la organización.");
      setEliminando(false);
    }
  }

  function previsualizar(hex: string) {
    setColor(hex);
    aplicarColorMarca(hex); // vista previa en vivo antes de guardar
  }

  async function guardar() {
    if (!org || !user) return;
    setErrorGuardar(null);
    setGuardando(true);
    try {
      // PATCH /organizaciones/:id ya deja su propio evento en la
      // bitácora, en la misma transacción, solo si nombre/color de
      // verdad cambiaron — ver rutas.ts.
      await db.actualizarOrganizacion(org.id, { nombre, colorPrimario: color });
      await refresh();
      avisar({ status: "success", title: "Cambios guardados", description: "El nombre y el color de la organización ya se actualizaron." });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } catch (err) {
      setErrorGuardar(err instanceof Error ? err.message : "No se pudo guardar — vuelve a intentar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-xl">
      <Card glass>
        <CardBody className="pt-5">
          <SectionLabel>Identidad</SectionLabel>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            Estás editando <span className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "tu organización"}</span>.
            Este color es el que ve todo su equipo dentro del sistema una vez que inician sesión. Cambia de
            organización desde tu menú de cuenta para editar otra.
          </p>
          <Field label="Nombre de la organización">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Universidad Anáhuac Veracruz" />
          </Field>

          <SectionLabel className="mt-2">Color de marca</SectionLabel>
          <div className="mb-3 flex flex-wrap gap-2.5">
            {COLORES_SUGERIDOS.map((c) => (
              <button
                key={c.hex}
                onClick={() => previsualizar(c.hex)}
                title={c.nombre}
                className="relative h-10 w-10 rounded-full ring-2 ring-offset-2 ring-offset-[var(--color-surface)] transition-transform hover:scale-110"
                style={{ background: c.hex, ["--tw-ring-color" as string]: color === c.hex ? c.hex : "transparent" }}
              >
                {color === c.hex && <Check size={16} className="absolute inset-0 m-auto text-white" />}
              </button>
            ))}
            <label
              className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-[var(--color-border)] text-xs font-bold text-[var(--color-text-muted)]"
              title="Color personalizado"
            >
              +
              <input type="color" value={color} onChange={(e) => previsualizar(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>

          <div className="mb-5 flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3">
            <div className="h-9 w-9 flex-shrink-0 rounded-lg" style={{ background: color }} />
            <div className="text-sm">
              <p className="font-bold text-[var(--color-text-primary)]">{nombre || "Tu organización"}</p>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{color}</p>
            </div>
            <Button size="sm" className="ml-auto">Botón de ejemplo</Button>
          </div>

          {errorGuardar && (
            <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {errorGuardar}
            </p>
          )}
          <Button icon={<Check size={16} />} disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando…" : guardado ? "Guardado" : "Guardar cambios"}
          </Button>
        </CardBody>
      </Card>

      <Card className="mt-6" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
        <CardBody className="pt-5">
          <div className="mb-1 flex items-center gap-2">
            <TriangleAlert size={17} className="text-red-600 dark:text-red-400" />
            <SectionLabel className="mb-0">Zona de peligro</SectionLabel>
          </div>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            Eliminar <span className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "esta organización"}</span> es
            permanente — se pierden su marca, quién pertenece a ella y su bitácora de auditoría.
          </p>

          {errorEliminar && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {errorEliminar}
            </div>
          )}

          {servicios.length > 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Todavía tiene {servicios.length} servicio(s) — elimínalos primero desde la pestaña{" "}
              <span className="font-semibold text-[var(--color-text-secondary)]">Servicios</span> para no perder su historial
              por accidente.
            </p>
          ) : orgs.length <= 1 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Es la única organización que tienes — siempre debe quedar al menos una.
            </p>
          ) : (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={eliminar} disabled={eliminando}>
              {eliminando ? "Eliminando…" : "Eliminar organización"}
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------- Servicios ----------------
function ServiciosTab() {
  const { org } = useOrg();
  const { user } = useAuth();
  // El menú "¿Con cuál vas a trabajar?" (ServicePicker) lee su propia
  // lista de servicios de este mismo contexto — sin recargarla aquí
  // también, crear/activar/eliminar un servicio no se reflejaba ahí
  // hasta recargar la página entera a mano (encontrado probando la
  // instalación completa de punta a punta, no solo revisando código).
  const { recargarServicios } = useService();
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [iconoNuevo, setIconoNuevo] = useState("building");
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    if (org) setServicios(await db.listarServicios(org.id));
  }
  useEffect(() => {
    cargar();
  }, [org]);

  async function actualizar(id: string, cambios: Partial<ServiceConfig>) {
    setError(null);
    // Optimista: se ve el cambio de inmediato, sin esperar la vuelta
    // del servidor — pero si el servidor lo rechaza, hay que deshacerlo
    // de verdad (recargando el estado real), no dejarlo así nada más.
    // Antes de esta corrección, un rechazo dejaba el checkbox/campo
    // mostrando el cambio como si hubiera quedado guardado, cuando en
    // realidad nunca se guardó.
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, ...cambios } : s)));
    try {
      await db.actualizarServicio(id, cambios);
      await recargarServicios();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
      cargar();
    }
  }

  async function agregar() {
    if (!nombreNuevo.trim() || !org || !user) return;
    setError(null);
    try {
      // POST /servicios ya deja su propio evento en la bitácora, en la
      // misma transacción — ver rutas.ts.
      await db.crearServicio(nombreNuevo.trim(), iconoNuevo, org.id);
      setNombreNuevo("");
      setIconoNuevo("building");
      cargar();
      await recargarServicios();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el servicio.");
    }
  }

  async function eliminar(s: ServiceConfig) {
    setError(null);
    if (!confirm(`¿Eliminar "${s.nombre}"? Esto no se puede deshacer.`)) return;
    try {
      // DELETE /servicios/:id ya deja su propio evento en la bitácora,
      // en la misma transacción — ver rutas.ts.
      await db.eliminarServicio(s.id);
      cargar();
      await recargarServicios();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar.");
    }
  }

  return (
    <div className="space-y-4">
      <Card glass>
        <CardBody className="pt-5">
          <SectionLabel>Agregar servicio</SectionLabel>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            Crea un servicio nuevo para <span className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "tu organización"}</span> (por
            ejemplo, si tu operación agrega una nueva área). Sus etiquetas y catálogo se configuran después, aquí abajo.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(ICON_REGISTRY).map(([key]) => (
              <button
                key={key}
                onClick={() => setIconoNuevo(key)}
                className={clsx(
                  "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                  iconoNuevo === key ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand-300"
                )}
              >
                <ServiceIcon name={key} size={16} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Input placeholder="Ej. Fisioterapia, Diseño gráfico…" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
            </div>
            <Button icon={<Plus size={15} />} onClick={agregar} disabled={!nombreNuevo.trim()}>
              Agregar servicio
            </Button>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {servicios.map((s) => (
        <Card key={s.id} glass>
          <CardBody className="pt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                  <ServiceIcon name={s.icono} size={19} />
                </span>
                <div>
                  <p className="font-bold text-[var(--color-text-primary)]">{s.nombre}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">ID: {s.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand-500)]" checked={s.activo} onChange={(e) => actualizar(s.id, { activo: e.target.checked })} />
                  Visible en el menú de servicios
                </label>
                <button onClick={() => eliminar(s)} title="Eliminar servicio" className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <SectionLabel>Ícono</SectionLabel>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {Object.entries(ICON_REGISTRY).map(([key]) => (
                <button
                  key={key}
                  onClick={() => actualizar(s.id, { icono: key })}
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                    s.icono === key ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand-300"
                  )}
                >
                  <ServiceIcon name={key} size={14} />
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Nombre del servicio">
                <Input defaultValue={s.nombre} onBlur={(e) => actualizar(s.id, { nombre: e.target.value })} />
              </Field>
              <Field label='Etiqueta del campo "persona"'>
                <Input defaultValue={s.campoPersonaLabel} onBlur={(e) => actualizar(s.id, { campoPersonaLabel: e.target.value })} />
              </Field>
              <Field label='Etiqueta del campo "categoría"'>
                <Input defaultValue={s.campoCategoriaLabel} onBlur={(e) => actualizar(s.id, { campoCategoriaLabel: e.target.value })} />
              </Field>
            </div>

            <SectionLabel className="mt-2">Funciones activas para este servicio</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <FeatureToggle label="Créditos (dejar cuentas pendientes)" checked={s.features.creditos} onChange={(v) => actualizar(s.id, { features: { ...s.features, creditos: v } })} />
              <FeatureToggle label="Cierre de caja" checked={s.features.cierreCaja} onChange={(v) => actualizar(s.id, { features: { ...s.features, cierreCaja: v } })} />
              <FeatureToggle label="Requisiciones (solicitudes de compra/material)" checked={s.features.requisiciones} onChange={(v) => actualizar(s.id, { features: { ...s.features, requisiciones: v } })} />
              <FeatureToggle label="Requiere identificador" checked={s.features.requiereId} onChange={(v) => actualizar(s.id, { features: { ...s.features, requiereId: v } })} />
            </div>

            {s.features.cierreCaja && (
              <Field label="Nombre del cierre de caja para este servicio" hint='Ej. "Cierre de caja", "Corte diario", "Cierre de turno"…'>
                <Input defaultValue={s.cierreCajaLabel} onBlur={(e) => actualizar(s.id, { cierreCajaLabel: e.target.value })} className="max-w-xs" />
              </Field>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function FeatureToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={clsx(
        "rounded-full border px-3.5 py-2 text-xs font-bold transition-colors",
        checked ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
      )}
    >
      {label}: {checked ? "Sí" : "No"}
    </button>
  );
}

// ---------------- Catálogo ----------------
function CatalogoTab() {
  const { org } = useOrg();
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [servicioId, setServicioId] = useState("");
  const [procs, setProcs] = useState<Procedimiento[]>([]);
  const [cats, setCats] = useState<CategoriaServicio[]>([]);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [categoriaNueva, setCategoriaNueva] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    db.listarServicios(org.id).then((s) => {
      setServicios(s);
      setServicioId(s[0]?.id ?? "");
    });
  }, [org]);

  async function cargar(id: string) {
    setProcs(await db.listarProcedimientos(id));
    setCats(await db.listarCategorias(id));
  }
  useEffect(() => {
    if (servicioId) cargar(servicioId);
  }, [servicioId]);

  async function guardar() {
    if (!nombre.trim() || !precio) return;
    setError(null);
    try {
      await db.guardarProcedimiento({ id: editId ?? `p_${crypto.randomUUID()}`, servicioId, nombre, precio: Number(precio) });
      setNombre("");
      setPrecio("");
      setEditId(null);
      cargar(servicioId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el procedimiento.");
    }
  }

  async function eliminar(id: string) {
    setError(null);
    try {
      await db.eliminarProcedimiento(id);
      cargar(servicioId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el procedimiento.");
    }
  }

  async function agregarCategoria() {
    if (!categoriaNueva.trim()) return;
    setError(null);
    try {
      await db.crearCategoria(categoriaNueva.trim(), servicioId);
      setCategoriaNueva("");
      cargar(servicioId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar la categoría.");
    }
  }

  async function eliminarCat(id: string) {
    setError(null);
    try {
      await db.eliminarCategoria(id);
      cargar(servicioId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la categoría.");
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}
      <Field label="Servicio">
        <select value={servicioId} onChange={(e) => setServicioId(e.target.value)} className="w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm">
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </Field>

      <Card glass className="mb-5">
        <CardBody className="pt-5">
          <SectionLabel>{editId ? "Editar procedimiento" : "Agregar procedimiento"}</SectionLabel>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-[2]">
              <Input placeholder="Ej. Curetaje cerrado" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="min-w-[120px] flex-1">
              <Input type="number" placeholder="Precio MXN" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </div>
            <Button icon={<Plus size={15} />} onClick={guardar}>{editId ? "Guardar" : "Agregar"}</Button>
            {editId && <Button variant="ghost" onClick={() => { setEditId(null); setNombre(""); setPrecio(""); }}>Cancelar</Button>}
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-2">
        {procs.map((p) => (
          <Card key={p.id} className="flex items-center justify-between px-4.5 py-3">
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">{p.nombre}</p>
              <p className="tabular text-sm text-[var(--color-text-muted)]">{formatoMXN(p.precio)}</p>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => { setEditId(p.id); setNombre(p.nombre); setPrecio(String(p.precio)); }} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-black/5 dark:hover:bg-white/10"><Pencil size={15} /></button>
              <button onClick={() => eliminar(p.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={15} /></button>
            </div>
          </Card>
        ))}
      </div>

      <SectionLabel className="mt-6">Categorías ({servicios.find((s) => s.id === servicioId)?.campoCategoriaLabel})</SectionLabel>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input
            placeholder="Ej. General"
            value={categoriaNueva}
            onChange={(e) => setCategoriaNueva(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && agregarCategoria()}
          />
        </div>
        <Button icon={<Plus size={15} />} onClick={agregarCategoria} disabled={!categoriaNueva.trim()}>
          Agregar
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pl-3 pr-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
            {c.nombre}
            <button onClick={() => eliminarCat(c.id)} title="Eliminar categoría" className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
              <X size={12} />
            </button>
          </span>
        ))}
        {cats.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Sin categorías todavía.</p>}
      </div>
    </div>
  );
}

// ---------------- Usuarios ----------------
const ROLES: { id: Role; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "finanzas", label: "Finanzas" },
  { id: "admin", label: "Admin" },
];

function UsuariosTab() {
  const { org } = useOrg();
  const { user: yo } = useAuth();
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [servicios, setServicios] = useState<ServiceConfig[]>([]);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [restableciendo, setRestableciendo] = useState<UserProfile | null>(null);
  const [passwordTemporal, setPasswordTemporal] = useState<string | null>(null);
  const [errorReset, setErrorReset] = useState<string | null>(null);
  const [cargandoReset, setCargandoReset] = useState(false);
  const [errorEquipo, setErrorEquipo] = useState<string | null>(null);

  async function cargarInvitaciones() {
    if (org) setInvitaciones(await db.listarInvitaciones(org.id));
  }
  useEffect(() => {
    db.listarUsuarios().then(setUsuarios);
    if (org) db.listarServicios(org.id).then(setServicios);
    cargarInvitaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  async function cambiar(u: UserProfile, rol: Role) {
    if (rol === u.rol) return;
    setErrorEquipo(null);
    try {
      // cambiar_rol() ya deja su propio evento en la bitácora, en la
      // misma transacción que el cambio de rol (ver esquema_local.sql)
      // — llamar aquí a registrarEvento() por separado duplicaría la
      // entrada, y es justo el patrón (dos peticiones independientes)
      // que dejaba el rastro sin garantía si la segunda se perdía.
      await db.cambiarRol(u.id, rol);
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, rol } : x)));
    } catch (err) {
      // El caso real que puede rechazar esto: quitarle el rol de admin
      // a la única cuenta administradora (ver cambiar_rol() en
      // esquema_local.sql) — sin este catch, el botón simplemente no
      // hacía nada visible, sin explicar por qué.
      setErrorEquipo(err instanceof Error ? err.message : "No se pudo cambiar el rol.");
    }
  }

  async function toggleOrg(u: UserProfile) {
    // Un administrador pertenece a todo automáticamente — no hay nada
    // que alternar aquí.
    if (!org || u.rol === "admin") return;
    setErrorEquipo(null);
    const perteneceAhora = u.orgIds.includes(org.id);
    const orgIds = perteneceAhora ? u.orgIds.filter((id) => id !== org.id) : [...u.orgIds, org.id];
    // Si se le quita la organización, sus servicios de esa organización
    // dejan de tener sentido — se quitan junto con ella.
    const servicioIds = perteneceAhora
      ? u.servicioIds.filter((sid) => !servicios.some((s) => s.id === sid))
      : u.servicioIds;
    try {
      // PATCH /usuarios/:id ya deja sus propios eventos en la bitácora,
      // en la misma transacción — uno por la organización, y uno más
      // por cada servicio que se haya quitado en cascada junto con
      // ella — ver rutas.ts.
      await db.actualizarPerfil(u.id, { orgIds, servicioIds });
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, orgIds, servicioIds } : x)));
    } catch (err) {
      setErrorEquipo(err instanceof Error ? err.message : "No se pudo actualizar a esa persona.");
    }
  }

  async function toggleServicio(u: UserProfile, servicioId: string) {
    setErrorEquipo(null);
    const asignadoAhora = u.servicioIds.includes(servicioId);
    const servicioIds = asignadoAhora
      ? u.servicioIds.filter((id) => id !== servicioId)
      : [...u.servicioIds, servicioId];
    // Si se le quita el servicio, tampoco tiene sentido que se quede
    // marcado como "solo consulta" ahí.
    const serviciosSoloConsulta = u.serviciosSoloConsulta?.filter((sid) => servicioIds.includes(sid));
    try {
      // PATCH /usuarios/:id ya deja su propio evento en la bitácora, en
      // la misma transacción — ver rutas.ts.
      await db.actualizarPerfil(u.id, { servicioIds, serviciosSoloConsulta });
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, servicioIds, serviciosSoloConsulta } : x)));
    } catch (err) {
      setErrorEquipo(err instanceof Error ? err.message : "No se pudo actualizar a esa persona.");
    }
  }

  async function confirmarRestablecer() {
    if (!restableciendo) return;
    setCargandoReset(true);
    setErrorReset(null);
    try {
      // Mismo motivo que en cambiar(): restablecer_password() ya
      // registra su propio evento, atómico con el restablecimiento —
      // ver esquema_local.sql.
      const { passwordTemporal: temporal } = await db.restablecerPasswordUsuario(restableciendo.id);
      setPasswordTemporal(temporal);
    } catch (error: any) {
      setErrorReset(error?.message ?? "No se pudo restablecer la contraseña.");
    } finally {
      setCargandoReset(false);
    }
  }

  function cerrarModalReset() {
    setRestableciendo(null);
    setPasswordTemporal(null);
    setErrorReset(null);
  }

  // Consulta = ve historial y actividad de ese servicio, pero no genera
  // folios nuevos ahí. Solo aplica a servicios ya asignados.
  async function toggleSoloConsulta(u: UserProfile, servicioId: string) {
    setErrorEquipo(null);
    const actual = u.serviciosSoloConsulta ?? [];
    const eraConsulta = actual.includes(servicioId);
    const serviciosSoloConsulta = eraConsulta
      ? actual.filter((id) => id !== servicioId)
      : [...actual, servicioId];
    try {
      // PATCH /usuarios/:id ya deja su propio evento en la bitácora, en
      // la misma transacción — ver rutas.ts.
      await db.actualizarPerfil(u.id, { serviciosSoloConsulta });
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, serviciosSoloConsulta } : x)));
    } catch (err) {
      setErrorEquipo(err instanceof Error ? err.message : "No se pudo actualizar a esa persona.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {org && yo && (
        <InvitarCard org={org} servicios={servicios} actor={yo} onInvitada={cargarInvitaciones} />
      )}

      {invitaciones.length > 0 && (
        <div>
          <SectionLabel>Invitaciones pendientes</SectionLabel>
          <div className="flex flex-col gap-2">
            {invitaciones.map((inv) => (
              <Card key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{inv.correo}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {ROLES.find((r) => r.id === inv.rol)?.label} · {inv.servicioIds.length} servicio(s)
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await db.eliminarInvitacion(inv.id);
                    cargarInvitaciones();
                  }}
                  title="Cancelar invitación"
                  className="flex-shrink-0 rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 size={15} />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Tu equipo</SectionLabel>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          Tú decides quién pertenece a <span className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "esta organización"}</span>,
          qué servicio ve cada quien, y si solo puede consultarlo o también generar folios ahí.
        </p>
        {errorEquipo && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {errorEquipo}
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {usuarios.map((u) => {
            const esAdmin = u.rol === "admin";
            const pertenece = esAdmin || (!!org && u.orgIds.includes(org.id));
            return (
              <Card key={u.id} glass className="px-4.5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar nombre={u.nombre} fotoUrl={u.fotoUrl} size={38} />
                    <div>
                      <p className="font-bold text-[var(--color-text-primary)]">{u.nombre}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{u.correo}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => toggleOrg(u)}
                      disabled={esAdmin}
                      title={esAdmin ? "Los administradores pertenecen a todas las organizaciones automáticamente." : undefined}
                      className={clsx(
                        "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                        esAdmin
                          ? "cursor-default border-brand-600 bg-brand-600 text-white opacity-80"
                          : pertenece
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand-300"
                      )}
                    >
                      {esAdmin ? "Administrador — acceso total" : pertenece ? "Pertenece a este equipo" : "No pertenece — agregar"}
                    </button>
                    <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
                    {ROLES.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => cambiar(u, r.id)}
                        className={clsx(
                          "rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                          u.rol === r.id ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                    {enModoLocal && yo && u.id !== yo.id && (
                      <button
                        onClick={() => setRestableciendo(u)}
                        title="Restablecer contraseña"
                        className="ml-1 rounded-full border border-[var(--color-border)] p-1.5 text-[var(--color-text-secondary)] hover:border-brand-300 hover:text-brand-600"
                      >
                        <KeyRound size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {!pertenece ? (
                  <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
                    No pertenece a {org?.nombre ?? "esta organización"} — no puede ver ninguno de sus servicios.
                  </p>
                ) : u.rol === "admin" ? (
                  <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
                    Como administrador, ve todos los servicios de esta organización automáticamente.
                  </p>
                ) : (
                  <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                    <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Servicios asignados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {servicios.map((s) => {
                        const asignado = u.servicioIds.includes(s.id);
                        const soloConsulta = !!u.serviciosSoloConsulta?.includes(s.id);
                        return (
                          <span key={s.id} className="inline-flex items-center overflow-hidden rounded-full border border-[var(--color-border)]">
                            <button
                              onClick={() => toggleServicio(u, s.id)}
                              className={clsx(
                                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors",
                                asignado ? "bg-brand-600 text-white" : "text-[var(--color-text-secondary)] hover:border-brand-300"
                              )}
                            >
                              {asignado && <Check size={12} />} <ServiceIcon name={s.icono} size={13} /> {s.nombre}
                            </button>
                            {asignado && (
                              <button
                                onClick={() => toggleSoloConsulta(u, s.id)}
                                title={soloConsulta ? "Solo puede consultar — clic para que también genere folios" : "Puede generar folios — clic para dejarlo solo en consulta"}
                                className={clsx(
                                  "flex items-center gap-1 border-l border-[var(--color-border)]/60 px-2 py-1.5 text-[10.5px] font-bold",
                                  soloConsulta ? "bg-black/[0.06] text-[var(--color-text-secondary)] dark:bg-white/10" : "bg-brand-700 text-white"
                                )}
                              >
                                {soloConsulta ? <Eye size={11} /> : <PenLine size={11} />}
                                {soloConsulta ? "Consulta" : "Opera"}
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {servicios.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">Todavía no hay servicios creados.</p>}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <Modal
        open={!!restableciendo}
        onClose={cerrarModalReset}
        title="Restablecer contraseña"
        subtitle={restableciendo ? `${restableciendo.nombre} · ${restableciendo.correo}` : undefined}
        footer={
          passwordTemporal ? (
            <Button onClick={cerrarModalReset}>Listo</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={cerrarModalReset}>
                Cancelar
              </Button>
              <Button onClick={confirmarRestablecer} disabled={cargandoReset}>
                {cargandoReset ? "Restableciendo…" : "Restablecer"}
              </Button>
            </>
          )
        }
      >
        {passwordTemporal ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Contraseña temporal generada. Compártesela a la persona por un medio seguro — no queda guardada en
              ningún lado, y no se volverá a mostrar.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
              <code className="flex-1 select-all break-all text-sm font-bold text-[var(--color-text-primary)]">{passwordTemporal}</code>
              <button
                onClick={() => navigator.clipboard.writeText(passwordTemporal)}
                title="Copiar"
                className="flex-shrink-0 rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-black/[0.06] dark:hover:bg-white/10"
              >
                <Copy size={14} />
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">Pídele que la cambie por una propia en cuanto entre.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Se genera una contraseña temporal nueva y aleatoria para{" "}
              <span className="font-bold text-[var(--color-text-primary)]">{restableciendo?.nombre}</span>. Su contraseña
              actual deja de funcionar de inmediato.
            </p>
            {errorReset && <p className="text-sm font-semibold text-red-600">{errorReset}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function InvitarCard({
  org,
  servicios,
  actor,
  onInvitada,
}: {
  org: { id: string; nombre: string };
  servicios: ServiceConfig[];
  actor: UserProfile;
  onInvitada: () => void;
}) {
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<Role>("personal");
  const [servicioIds, setServicioIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // El código que acaba de generarse — se muestra una sola vez, igual
  // que la contraseña temporal de restablecer-password. Sin este
  // código, la persona invitada no puede completar su registro (ver
  // Register.tsx): coincidir solo el correo no bastaba para probar que
  // de verdad lo controlaba.
  const [tokenGenerado, setTokenGenerado] = useState<{ correo: string; token: string } | null>(null);

  function toggleServicio(id: string) {
    setServicioIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function invitar() {
    if (!correo.trim()) return;
    setError(null);
    try {
      // POST /invitaciones ya deja su propio evento en la bitácora, en
      // la misma transacción — ver rutas.ts.
      const inv = await db.crearInvitacion(correo.trim(), org.id, rol, rol === "admin" ? [] : servicioIds, actor.id);
      setTokenGenerado(inv.token ? { correo: correo.trim(), token: inv.token } : null);
      setCorreo("");
      setRol("personal");
      setServicioIds([]);
      onInvitada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo invitar.");
    }
  }

  if (tokenGenerado) {
    return (
      <Card glass>
        <CardBody className="pt-5">
          <SectionLabel>Invitación creada</SectionLabel>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            Comparte este código con <span className="font-bold text-[var(--color-text-primary)]">{tokenGenerado.correo}</span> por
            un medio que confíes que sí es esa persona (en persona, por chat, por su correo institucional) — lo va a
            necesitar para completar su registro, junto con ese mismo correo. No queda guardado en ningún lado, y no
            se vuelve a mostrar.
          </p>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
            <code className="flex-1 select-all break-all text-sm font-bold text-[var(--color-text-primary)]">{tokenGenerado.token}</code>
            <button
              onClick={() => navigator.clipboard.writeText(tokenGenerado.token)}
              title="Copiar"
              className="flex-shrink-0 rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-black/[0.06] dark:hover:bg-white/10"
            >
              <Copy size={14} />
            </button>
          </div>
          <Button icon={<UserPlus size={16} />} onClick={() => setTokenGenerado(null)}>
            Invitar a alguien más
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card glass>
      <CardBody className="pt-5">
        <SectionLabel>Invitar a alguien nuevo</SectionLabel>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          El registro ya no es abierto — solo puede crear una cuenta quien tenga una invitación vigente para su
          correo, y el código que se genera al invitar. Aquí decides con qué rol y qué servicios de{" "}
          <span className="font-bold text-[var(--color-text-primary)]">{org.nombre}</span> arranca.
        </p>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        <Field label="Correo" id="invitar-correo">
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input id="invitar-correo" className="pl-9" type="email" placeholder="nombre@correo.com" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </div>
        </Field>

        <SectionLabel className="mt-1">Rol</SectionLabel>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRol(r.id)}
              className={clsx(
                "rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors",
                rol === r.id ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {rol !== "admin" && (
          <>
            <SectionLabel>Servicios</SectionLabel>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {servicios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleServicio(s.id)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    servicioIds.includes(s.id) ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand-300"
                  )}
                >
                  {servicioIds.includes(s.id) && <Check size={12} />} <ServiceIcon name={s.icono} size={13} /> {s.nombre}
                </button>
              ))}
              {servicios.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">Todavía no hay servicios creados.</p>}
            </div>
          </>
        )}

        <Button icon={<UserPlus size={16} />} onClick={invitar} disabled={!correo.trim()}>
          Invitar
        </Button>
      </CardBody>
    </Card>
  );
}

// ---------------- Auditoría ----------------
// Cuántos eventos trae cada tanda — tiene que coincidir con lo que
// pide db.listarEventos() para poder saber si "puede haber más" (ver
// hayMas más abajo): si la última tanda vino más corta que esto, ya no
// queda nada más viejo por cargar.
const EVENTOS_POR_TANDA = 50;

function AuditoriaTab() {
  const { org } = useOrg();
  const [eventos, setEventos] = useState<EventoAuditoria[]>([]);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);

  useEffect(() => {
    if (!org) return;
    setEventos([]);
    setHayMas(false);
    db.listarEventos(org.id, { limit: EVENTOS_POR_TANDA }).then((primeraTanda) => {
      setEventos(primeraTanda);
      setHayMas(primeraTanda.length === EVENTOS_POR_TANDA);
    });
  }, [org]);

  // H11: antes esto traía la bitácora COMPLETA de la organización de
  // una sola vez — con una institución nueva no se nota, pero después
  // de meses de uso real esa lista solo crece. "antesDe" es un cursor
  // (la fecha del último evento ya mostrado), no un número de página —
  // sigue dando la tanda correcta aunque, mientras tanto, se hayan
  // registrado eventos nuevos más recientes.
  async function cargarMas() {
    if (eventos.length === 0 || !org) return;
    setCargandoMas(true);
    try {
      const siguienteTanda = await db.listarEventos(org.id, {
        limit: EVENTOS_POR_TANDA,
        antesDe: eventos[eventos.length - 1].fecha,
      });
      setEventos((prev) => [...prev, ...siguienteTanda]);
      setHayMas(siguienteTanda.length === EVENTOS_POR_TANDA);
    } finally {
      setCargandoMas(false);
    }
  }

  const formato = useMemo(
    () => new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    []
  );

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        Quién hizo qué en <span className="font-bold text-[var(--color-text-primary)]">{org?.nombre ?? "esta organización"}</span> — decisiones
        administrativas (crear/eliminar servicios, cambiar roles, la marca) e inicios de sesión, exitosos y
        fallidos (servidor propio). El día a día de folios ya se ve en Actividad.
      </p>
      {eventos.length === 0 ? (
        <EmptyState icon={<IconHistory size={24} strokeWidth={1.75} />} title="Sin eventos todavía" hint="Aquí aparecerán las acciones administrativas de tu equipo." />
      ) : (
        <div className="flex flex-col gap-2">
          {eventos.map((e) => (
            <Card key={e.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-[var(--color-text-secondary)] dark:bg-white/5">
                <IconHistory size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--color-text-primary)]">
                  <span className="font-bold">{e.actorNombre}</span> · {e.accion}
                </p>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{e.detalle}</p>
              </div>
              <span className="flex-shrink-0 text-xs text-[var(--color-text-muted)]">{formato.format(new Date(e.fecha))}</span>
            </Card>
          ))}
          {hayMas && (
            <Button variant="ghost" size="sm" className="mt-2 self-center" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? "Cargando…" : "Cargar más"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
