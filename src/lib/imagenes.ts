// Reduce una imagen elegida por el usuario antes de guardarla: una foto
// de celular pesa varios MB y el servidor rechaza lo que pase de cierto
// tamaño. Todo pasa en el navegador con un canvas.

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onload = () => {
      URL.revokeObjectURL(url);
      resolver(imagen);
    };
    imagen.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error("Ese archivo no es una imagen que se pueda leer."));
    };
    imagen.src = url;
  });
}

/** Devuelve una imagen (dataURL) que cabe en `maxLado` píxeles y, si se
 * puede, en `maxCaracteres`. JPEG para fotos de artículos; PNG conserva
 * la transparencia de un sello. */
export async function reducirImagen(
  archivo: File,
  opciones: { maxLado: number; formato: "jpeg" | "png"; maxCaracteres: number }
): Promise<string> {
  if (!archivo.type.startsWith("image/") || archivo.type === "image/svg+xml") {
    throw new Error("Elige una imagen PNG, JPG o WebP.");
  }
  const imagen = await cargarImagen(archivo);
  let ancho = imagen.naturalWidth;
  let alto = imagen.naturalHeight;
  if (!ancho || !alto) throw new Error("Ese archivo no es una imagen que se pueda leer.");
  let escala = Math.min(1, opciones.maxLado / Math.max(ancho, alto));
  // Se reintenta más chica hasta que quepa (o ya no valga la pena).
  for (let intento = 0; intento < 6; intento++) {
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    const contexto = lienzo.getContext("2d");
    if (!contexto) throw new Error("No se pudo procesar la imagen en este navegador.");
    if (opciones.formato === "jpeg") {
      contexto.fillStyle = "#fff"; // JPEG no tiene transparencia
      contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    }
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    const calidad = opciones.formato === "jpeg" ? Math.max(0.4, 0.78 - intento * 0.08) : undefined;
    const resultado = lienzo.toDataURL(opciones.formato === "jpeg" ? "image/jpeg" : "image/png", calidad);
    if (resultado.length <= opciones.maxCaracteres) return resultado;
    escala *= 0.75;
  }
  throw new Error("La imagen es demasiado pesada aun reducida — usa una más sencilla.");
}
