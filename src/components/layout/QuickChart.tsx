// Separado de SmartSearchModal.tsx a propósito: recharts es una
// librería grande, y Topbar.tsx importa SmartSearchModal.tsx de forma
// directa (no perezosa) porque el botón de Quick vive en el
// encabezado de toda la app — sin este archivo aparte, recharts se
// metía al paquete principal de CADA página, se abriera Quick o no
// (encontrado al ver crecer el bundle principal de ~410KB a ~770KB
// después de agregar la gráfica). Cargando este componente con
// React.lazy() desde SmartSearchModal.tsx, recharts solo se descarga
// la primera vez que de verdad se pide una gráfica.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatoMXN } from "../../lib/utils";

// `total` para meses ya pasados, `estimado` para meses proyectados —
// el mes donde empalman los dos (el último real) trae ambos campos, a
// propósito, para que la línea punteada arranque exactamente donde
// termina la sólida en vez de dejar un salto visual.
export type PuntoGrafica = { mes: string; label: string; total?: number; estimado?: number };
export type Grafica = { historico: PuntoGrafica[]; proyeccion: PuntoGrafica[] };

function compacto(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return formatoMXN(n);
}

function QuickChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-bold text-[var(--color-text-primary)]">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="tabular text-[var(--color-text-secondary)]">
          {p.name}: <span className="font-bold text-[var(--color-text-primary)]">{formatoMXN(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Une histórico y proyección en un solo arreglo para la gráfica —
 * repite el último mes real con su valor también como "estimado", así
 * las dos líneas (sólida y punteada) se tocan en ese punto en vez de
 * dejar un hueco entre ellas. */
function datosDeGrafica(g: Grafica): PuntoGrafica[] {
  if (g.proyeccion.length === 0) return g.historico;
  const ultimo = g.historico[g.historico.length - 1];
  return [...g.historico.slice(0, -1), { ...ultimo, estimado: ultimo.total }, ...g.proyeccion];
}

export default function QuickChart({ g }: { g: Grafica }) {
  const datos = datosDeGrafica(g);
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <AreaChart data={datos} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="quickRevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-baseline)" }} tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} />
          <YAxis tickFormatter={compacto} tickLine={false} axisLine={false} tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} width={52} />
          <Tooltip content={<QuickChartTooltip />} />
          <Area
            type="monotone"
            dataKey="total"
            name="Real"
            stroke="var(--color-brand-500)"
            strokeWidth={2}
            fill="url(#quickRevFill)"
            dot={{ r: 3, fill: "var(--color-brand-500)", strokeWidth: 2, stroke: "var(--color-surface)" }}
          />
          {g.proyeccion.length > 0 && (
            <Area
              type="monotone"
              dataKey="estimado"
              name="Estimado"
              stroke="var(--color-brand-500)"
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="none"
              dot={{ r: 3, fill: "var(--color-surface)", strokeWidth: 2, stroke: "var(--color-brand-500)" }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
