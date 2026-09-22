export function formatoMXN(valor: number): string {
  return valor.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

// Convierte texto plano (normalmente un CSV) en una descarga real del
// navegador — mismo patrón para generar el archivo y para que quien lo
// recibe lo baje después desde su bandeja de notificaciones.
export function descargarTexto(nombreArchivo: string, contenido: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Sin esto, un valor que alguien haya escrito en un folio (el nombre
// del cliente, por ejemplo) y que empiece con =, +, - o @ se abre como
// FÓRMULA en Excel/Sheets al abrir el CSV, no como texto — es un
// ataque real y documentado (CSV/Formula Injection). Se neutraliza
// anteponiendo un apóstrofo, que fuerza texto plano en cualquier hoja
// de cálculo sin cambiar lo que se ve.
const INICIO_PELIGROSO_CSV = /^[=+\-@\t\r]/;

function celdaCSV(valor: string | number): string {
  let s = String(valor);
  if (INICIO_PELIGROSO_CSV.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function generarCSV(encabezados: string[], filas: (string | number)[][]): string {
  return [encabezados, ...filas].map((fila) => fila.map(celdaCSV).join(",")).join("\n");
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
