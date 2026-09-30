# Informe de auditoría de seguridad — Finaquick

Resumen ejecutivo de la revisión de seguridad realizada sobre
Finaquick, el sistema de folios, créditos y facturación para
instituciones multi-organización. Este documento resume el alcance,
la metodología y los resultados de la revisión; el detalle técnico
completo de cada control está en [`SECURITY.md`](SECURITY.md).

## Verificación de esta entrega (29 de septiembre de 2026)

**Cómo se verificó.** El paquete se instaló desde cero con su propio
instalador de macOS, sin intervención manual, usando un nombre de
institución con acentos. Después se registró la cuenta de administrador
con el código de invitación que imprimió el instalador, se cargaron los
datos de ejemplo y se recorrieron las pantallas principales en un
navegador: se creó un folio desde el formulario, se consultó a Quick y
se imprimieron el cierre de caja y el reporte financiero. La suite de
pruebas del servidor (154 pruebas, contra PostgreSQL real) y las 12
del clasificador de Quick pasaron completas, y `npm audit --omit=dev` reportó cero alertas en el cliente y
en el servidor.

**Cambios de esta entrega:**

- Inicio de sesión: el límite de intentos por IP del segundo factor
  ahora es independiente del de la contraseña; antes, cada código de
  segundo factor consumía también el cupo del inicio de sesión. Cubierto
  por una prueba automática.
- Instaladores: se detienen con un mensaje claro si falla cualquier paso
  de la base de datos (crearla, aplicar el esquema, crear la invitación
  inicial o configurar los accesos), en lugar de continuar con una
  instalación incompleta. Los nombres con acentos se guardan
  correctamente, y las dependencias se instalan exactamente con las
  versiones de los archivos de bloqueo (`npm ci`).
- Entradas hostiles: la API ya no responde con errores de servidor ante
  identificadores mal formados, textos con caracteres nulos, listas o
  banderas de tipo incorrecto, cuerpos JSON inválidos o demasiado
  grandes; nunca expone rutas internas del servidor; y el tiempo de
  respuesta del inicio de sesión ya no delata qué correos existen.
- El bloqueo por intentos fallidos (contraseña y segundo factor) cuenta
  también los intentos hechos en ráfaga.
- Quick sin IA: una pregunta muy larga con una palabra repetida ya no
  congela la interfaz, y "corte del 15 de septiembre" se entiende como
  corte de caja. Cubierto por 12 pruebas nuevas (`npm test`).
- Accesibilidad: cero violaciones en el análisis automático (axe-core)
  de las pantallas principales.
- Nueva variable opcional `ZONA_HORARIA` para fijar la zona horaria de
  los folios y cortes de caja del servidor.
- El cliente de desarrollo queda fijo en `localhost:5173`, el mismo
  origen que acepta el servidor.
- Reportes impresos sin cortes entre hojas, mejoras de uso en varias
  pantallas y animaciones más consistentes.

**Límites de esta verificación:** el instalador de Windows se revisó
línea por línea pero no se ejecutó en Windows; la función opcional de
Quick con Gemini no se probó con una clave real. Antes de manejar datos
reales, conviene repetir la instalación y `npm test` en el equipo de
destino, junto con un respaldo y su restauración. Este resultado no
constituye una garantía de ausencia total de errores o
vulnerabilidades.

## Alcance de la revisión

La revisión cubrió el servidor propio de la aplicación
(`servidor/api`, Node.js + Express + PostgreSQL) y el cliente web
(React), en las siguientes áreas:

| Área | Qué se revisó |
|---|---|
| Autenticación y sesiones | Almacenamiento de contraseñas, bloqueo de cuenta por intentos fallidos, invalidación de sesión al cambiar contraseña, autenticación de dos factores, algoritmo y vigencia de tokens de sesión. |
| Autorización y multi-organización | Aislamiento de datos entre organizaciones, control de acceso por servicio y por rol, protección contra escalamiento de privilegios, seguridad a nivel de fila en la base de datos. |
| Validación de datos de entrada | Límites de longitud y formato en cada campo escrito por el usuario, rechazo explícito de datos incompletos o mal formados antes de llegar a la base de datos. |
| Integridad financiera | Cálculo de totales de folio exclusivamente en el servidor (nunca confiando en el navegador), unicidad garantizada de folios bajo concurrencia, operaciones de pago en lote atómicas, idempotencia en la creación de folios. |
| Contenido generado por usuarios | Protección contra inyección de contenido (XSS) en campos de texto libre y archivos adjuntos. |
| Seguridad de red y transporte | Cabeceras HTTP de seguridad, política de CORS, límites de tasa (rate limiting) por ruta sensible. |
| Inicio de sesión institucional (Microsoft, opcional) | Validación del flujo OAuth, protección contra CSRF en el callback, interacción correcta con la autenticación de dos factores local. |
| Asistente de datos con IA — Quick (opcional) | Qué información puede o no recibir el proveedor de IA configurado, validación estricta de esa información en ambas direcciones, límite de tasa dedicado, degradación sin errores cuando no está configurado. |
| Bitácora de auditoría | Registro atómico (dentro de la misma transacción) de toda acción administrativa, imposibilidad de suplantar al autor de un evento, paginación del historial. |
| Respaldos y continuidad | Generación y restauración de respaldos completos, apagado ordenado del servidor, verificación de estado real (no solo del proceso). |
| Consideraciones de despliegue | Aislamiento de red recomendado, rotación de credenciales, cifrado en reposo, exclusividad de la base de datos. |

## Metodología

Cada control fue verificado mediante pruebas funcionales contra un
servidor y una base de datos en ejecución — creación de cuentas,
generación de folios, e intentos deliberados de evadir cada
restricción con cuentas sin privilegios — y no únicamente mediante
revisión estática del código. La suite de pruebas automatizadas
(`servidor/api/test/`) ejercita estos mismos controles en cada
ejecución y se incluye en el proyecto para que el equipo de sistemas
de la institución pueda correrla de nuevo en cualquier momento (ver
[`LOCAL_SETUP.md`](LOCAL_SETUP.md), sección 8).

Adicionalmente, el sistema fue sometido a varias rondas de revisión
independientes entre sí, cada una enfocada en encontrar defectos
reales contra el código en ejecución — no solo contra su descripción
— con los hallazgos confirmados corregidos y verificados de nuevo
antes de darlos por cerrados.

## Resultados

Los controles descritos arriba fueron implementados, probados, y — en
el caso de hallazgos identificados durante las distintas rondas de
revisión — corregidos y verificados nuevamente. El detalle línea por
línea de cada control, incluyendo el razonamiento detrás de cada
decisión de diseño, está documentado en [`SECURITY.md`](SECURITY.md).

## Alcance y limitaciones

Para que este informe sea útil como base de una decisión, y no
únicamente como una lista de lo que ya se hizo bien:

- Todo lo descrito aquí fue encontrado, probado y corregido por el
  propio equipo que construyó el sistema. **No sustituye una auditoría
  de seguridad independiente por un tercero**, especialmente antes de
  manejar datos institucionales reales en producción.
- Las pruebas de carga (ver [`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md))
  se corrieron en hardware de desarrollo, no en el servidor final de la
  institución.
- Las pruebas de interfaz se hicieron en un solo navegador — no hay
  verificación cruzada contra distintos motores de renderizado.
- Este informe documenta los controles implementados y cómo se
  verificaron — no es una certificación ni una garantía de ausencia
  total de vulnerabilidades.

## Documentos relacionados

- [`SECURITY.md`](SECURITY.md) — detalle técnico completo de cada
  control.
- [`LOCAL_SETUP.md`](LOCAL_SETUP.md) — guía de instalación y
  despliegue.
- [`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md) — resultados de la prueba
  de carga y cómo repetirla.
