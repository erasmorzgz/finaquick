import type { Requisicion } from "../../lib/db/types";

const FORMATO_FECHA = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

// Renglones en blanco para completar el formato, como en la hoja de
// papel: el documento siempre se ve como formulario, no como lista.
const RENGLONES_MINIMOS = 8;

const ESTADO_TEXTO = { pendiente: "Pendiente de revisión", aprobada: "Aprobada", rechazada: "Rechazada" } as const;

/** El formato de "Requisición de compra", listo para verse y para
 * imprimirse (o guardarse como PDF desde el diálogo de impresión).
 * Siempre tinta negra sobre papel blanco. */
export function RequisicionDocumento({
  r, orgNombre, encabezado, logoUrl,
}: { r: Requisicion; orgNombre: string; encabezado?: string; logoUrl?: string }) {
  const fecha = new Date(r.creadoEn);
  const renglones = [...r.articulos, ...Array.from({ length: Math.max(0, RENGLONES_MINIMOS - r.articulos.length) }, () => null)];
  const lineasEncabezado = (encabezado ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <article className="bg-white p-6 text-[12px] leading-snug text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }} aria-label={`Requisición de compra ${r.folio}`}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Requisición de compra {fecha.getFullYear()}</h2>
          <p className="mt-0.5 text-[11px] font-semibold">Folio {r.folio}</p>
        </div>
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-12 max-w-[9rem] object-contain" />
        ) : (
          <p className="max-w-[10rem] text-right text-sm font-bold">{orgNombre}</p>
        )}
      </header>

      {lineasEncabezado.length > 0 && (
        <div className="mt-3 border-y border-black py-2 text-center text-[11px] font-bold uppercase">
          {lineasEncabezado.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 sm:grid-cols-[auto_1fr_auto_auto]">
        <Campo etiqueta="Campus" valor={orgNombre} />
        <Campo etiqueta="Fecha" valor={FORMATO_FECHA.format(fecha)} />
        <Campo etiqueta="Departamento" valor={r.departamento ?? ""} ancho />
        <Campo etiqueta="Solicitante" valor={r.solicitanteNombre ?? ""} ancho />
      </dl>

      <table className="mt-3 w-full border-collapse border border-black text-[11px]">
        <thead>
          <tr className="bg-[#e5e5e5] print:bg-[#e5e5e5]">
            {["Cantidad", "Artículo", "Marca", "Página de internet", "Imagen"].map((t) => (
              <th key={t} className="border border-black px-1.5 py-1 text-center font-bold">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renglones.map((a, i) => (
            <tr key={i} className="h-9 align-top">
              <td className="w-16 border border-black px-1.5 py-1 text-center">{a?.cantidad ?? ""}</td>
              <td className="border border-black px-1.5 py-1">{a?.articulo ?? ""}</td>
              <td className="w-24 border border-black px-1.5 py-1">{a?.marca ?? ""}</td>
              <td className="w-44 break-all border border-black px-1.5 py-1 text-[10px]">{a?.url ?? ""}</td>
              <td className="w-20 border border-black px-1 py-1 text-center">
                {a?.imagen ? <img src={a.imagen} alt="" className="mx-auto max-h-14 max-w-full object-contain" /> : a?.tieneImagen ? "—" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] font-semibold">
        Favor de anexar a este formato características y especificaciones del producto requerido, en caso de ser posible imágenes y página de internet en la que se puede consultar.
      </p>

      <div className="mt-2 border border-black">
        <p className="bg-[#e5e5e5] px-2 py-1 text-center text-[11px] font-bold uppercase print:bg-[#e5e5e5]">Motivo de la solicitud</p>
        <p className="min-h-[3.5rem] whitespace-pre-wrap px-2 py-1.5">{r.motivo ?? r.notas ?? ""}</p>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <Firma
          etiqueta="Firma del solicitante"
          nombre={r.solicitanteNombre}
          firma={r.firmaSolicitante}
          sello={r.selloSolicitante}
        />
        <Firma
          etiqueta="Responsable de compras"
          nombre={r.estado === "pendiente" ? r.destinatarioNombre : r.aprobadorNombre}
          firma={r.firmaResolucion}
          sello={r.selloResolucion}
          detalle={r.estado !== "pendiente" && r.resueltoEn ? `${ESTADO_TEXTO[r.estado]} el ${FORMATO_FECHA_LARGA.format(new Date(r.resueltoEn))}` : undefined}
        />
        <Firma etiqueta="Administración" />
      </div>

      {r.estado === "rechazada" && (
        <p className="mt-4 border border-black px-2 py-1.5 text-[11px]">
          <strong>Rechazada.</strong> {r.motivoRechazo ?? "Sin motivo indicado."}
        </p>
      )}
      <footer className="mt-4 flex justify-between text-[9px] text-black/60">
        <span>{orgNombre} — Finaquick</span>
        <span>Estado: {ESTADO_TEXTO[r.estado]}</span>
      </footer>
    </article>
  );
}

// ancho: la caja ocupa el resto del renglón (Departamento y Solicitante).
function Campo({ etiqueta, valor, ancho }: { etiqueta: string; valor: string; ancho?: boolean }) {
  return (
    <>
      <dt className="text-right font-bold">{etiqueta}</dt>
      <dd className={`min-h-[1.25rem] border border-black px-1.5 py-0.5 ${ancho ? "sm:col-span-3" : ""}`}>{valor}</dd>
    </>
  );
}

function Firma({
  etiqueta, nombre, firma, sello, detalle,
}: { etiqueta: string; nombre?: string; firma?: string; sello?: string; detalle?: string }) {
  return (
    <div className="break-inside-avoid">
      <div className="relative flex h-24 items-end justify-center border-b border-black">
        {sello && <img src={sello} alt="Sello" className="absolute left-1/2 top-0 h-20 max-w-[7rem] -translate-x-1/2 object-contain opacity-80" />}
        {firma && <img src={firma} alt="Firma" className="relative h-14 max-w-[8rem] object-contain" />}
      </div>
      <p className="mt-1 min-h-[1rem] text-[11px] font-bold">{nombre ?? ""}</p>
      <p className="text-[10px] font-bold uppercase">{etiqueta}</p>
      {detalle && <p className="text-[9px] text-black/60">{detalle}</p>}
    </div>
  );
}
