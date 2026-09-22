# Informe de auditoría de seguridad — Finaquick

Resumen ejecutivo de la revisión de seguridad realizada sobre
Finaquick, el sistema de folios, créditos y facturación para
instituciones multi-organización. Este documento resume el alcance,
la metodología y los resultados de la revisión; el detalle técnico
completo de cada control está en [`SECURITY.md`](SECURITY.md).

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
