// Sistema de marca por organización: el color primario NO está fijo en el
// código — se elige desde Configuración → Marca y se aplica en vivo. Si el
// producto se vende a otra organización, solo cambia este color (y el
// nombre), nada más del código.
//
// A partir de UN color base generamos toda la escala 50–900 manipulando
// luminosidad en HSL, igual que si fuera una paleta de diseño hecha a mano.

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Los mismos pasos de luminosidad que ya validamos a mano para el naranja
// Anáhuac (50 casi blanco -> 900 casi negro), reaplicados a cualquier tono.
const LIGHTNESS_STEPS: Record<number, number> = {
  50: 96,
  100: 91,
  200: 82,
  300: 70,
  400: 60,
  500: 50,
  700: 33,
  800: 27,
  900: 21,
};

function relativeLuminance(hex: string): number {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastVsWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

// El paso "600" carga texto blanco (botones, píldoras activas): no es un
// porcentaje fijo de luminosidad como los demás, se busca por bisección la
// luminosidad más clara que aún pasa 4.5:1 (AA) — algunos tonos (amarillo,
// verde-limón) necesitan mucha más oscuridad que otros para lograrlo.
function encontrarLuminosidad600(h: number, s: number): number {
  let lo = 15;
  let hi = 55;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const hex = hslToHex(h, s, mid);
    if (contrastVsWhite(hex) >= 4.5) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function generarEscalaMarca(colorBase: string): Record<number, string> {
  const [h, sRaw] = hexToHsl(colorBase);
  // El piso de saturación evita tonos lavados cuando el usuario elige un
  // color con algo de color pero débil — pero un gris de verdad (grafito,
  // negro, blanco) tiene s≈0 a propósito y debe seguir siendo gris, no
  // convertirse en rojo porque h cae en 0 por default cuando no hay matiz.
  const s = sRaw < 4 ? 0 : Math.max(sRaw, 45);
  const escala: Record<number, string> = {};
  for (const [step, l] of Object.entries(LIGHTNESS_STEPS)) {
    escala[Number(step)] = hslToHex(h, s, l);
  }
  escala[600] = hslToHex(h, s, encontrarLuminosidad600(h, s));
  return escala;
}

export function aplicarColorMarca(colorBase: string) {
  const escala = generarEscalaMarca(colorBase);
  const root = document.documentElement;
  for (const [step, hex] of Object.entries(escala)) {
    root.style.setProperty(`--color-brand-${step}`, hex);
  }
}
