# Prueba de carga

Cómo se prueba el sistema bajo varios usuarios simultáneos, y qué tan
lejos llega en el hardware donde se corrió esta prueba — no en el
servidor final de la institución, que puede rendir distinto (mejor o
peor, según su capacidad).

## Cómo correrla tú mismo

```bash
cd servidor/api
npm run carga
```

Arranca una base de datos y un servidor reales aparte (no toca tu base
de desarrollo), da de alta cuentas de prueba, genera tráfico mixto
durante un rato, y al final borra todo. No necesita nada más que ya no
tengas instalado para correr el servidor normalmente.

Se puede ajustar. En Mac/Linux, en la misma línea:

```bash
USUARIOS=80 DURACION_SEG=30 RAFAGA_LOGINS=40 npm run carga
```

En Windows (`cmd`), cada variable necesita su propio `set`, en líneas
separadas antes de correr el comando — la sintaxis de arriba, todo en
una línea, no funciona ahí:

```bash
set USUARIOS=80
set DURACION_SEG=30
set RAFAGA_LOGINS=40
npm run carga
```

(En PowerShell, cada una sería `$env:USUARIOS="80"`.)

- `USUARIOS` (default 30): cuántas personas conectadas al mismo tiempo.
- `DURACION_SEG` (default 20): cuánto dura la parte de tráfico mixto.
- `RAFAGA_LOGINS` (default 25): cuántos inicios de sesión exactamente
  simultáneos, para medir el caso más exigente (todo el personal
  entrando justo al mismo instante).

**Se puede detener en cualquier momento con Ctrl+C** — no hace falta
esperar a que termine `DURACION_SEG` para verla parar: corta el
tráfico en curso, imprime el reporte de lo que sí alcanzó a medir, y
limpia todo (apaga el servidor de prueba, borra la base de datos
temporal) antes de salir, sin dejar nada a medias. Para dejarla
corriendo el tiempo que uno quiera en vez de un número fijo, se pone
un `DURACION_SEG` grande y se corta con Ctrl+C cuando ya no haga
falta — en Windows (`cmd`):

```bash
set DURACION_SEG=999999
set USUARIOS=20
npm run carga
```

(Un segundo Ctrl+C, si el primero se queda pegado, fuerza la salida de
inmediato sin ese aseo.)

## Qué mide

**Tráfico mixto sostenido** — N personas ya con sesión iniciada, cada
una viendo folios, el panel financiero, buscando, y generando folios
nuevos al mismo tiempo, sin pausa entre una petición y la siguiente
(el caso más exigente: una persona real siempre tarda algo en leer la
pantalla entre una acción y la otra, así que esto es más tráfico del
que de verdad generaría esa misma cantidad de gente).

**Ráfaga de inicios de sesión simultáneos** — varias cuentas reales
iniciando sesión en el mismo instante exacto. El hash de contraseña
(bcrypt, costo 12) es deliberadamente lento — es lo que hace que
adivinar contraseñas por fuerza bruta sea impráctico — así que esta
parte mide específicamente cuánto cuesta esa protección cuando mucha
gente entra al mismo tiempo, no un error.

## Resultados (hardware: laptop de desarrollo, no el servidor final)

Medidos de nuevo el 2026-09-09, después de corregir el propio script de
esta prueba: mandaba la lista de procedimientos con el nombre de campo
viejo (`procedimientos`) en vez del actual (`procedimientoIds`), un
contrato que había cambiado en un endurecimiento de seguridad anterior
sin que este script se actualizara junto con él. El efecto: **cada
folio que la prueba intentaba crear era rechazado** — no se notaba
corriendo la prueba con sus parámetros por default, porque los folios
semilla se creaban sin
revisar si la petición había funcionado. Ya corregido, con una
verificación que ahora sí detendría la prueba de inmediato si algo
similar vuelve a pasar. Los números de abajo son de una corrida real,
ya con el contrato correcto.

### 30 usuarios simultáneos, 20 segundos de tráfico mixto

| Ruta | peticiones | p50 | p95 | p99 | máx | errores |
|---|---:|---:|---:|---:|---:|---:|
| GET /tickets | 2 876 | 91ms | 176ms | 210ms | 257ms | 0 |
| GET /finanzas/ingresos-mensuales | 1 059 | 94ms | 181ms | 222ms | 255ms | 0 |
| GET /servicios | 1 079 | 49ms | 114ms | 136ms | 158ms | 0 |
| GET /categorias | 746 | 47ms | 113ms | 146ms | 173ms | 0 |
| GET /buscar-folio | 666 | 98ms | 191ms | 227ms | 266ms | 0 |
| POST /tickets (crear folio) | 710 | 77ms | 159ms | 234ms | 326ms | 0 |

**356.8 peticiones/segundo, cero errores.** Con gente real (que sí hace
pausas entre acción y acción) esto cubre cómodamente el uso normal de
un campus.

### 80 usuarios simultáneos, 15 segundos de tráfico mixto

| Ruta | peticiones | p50 | p95 | p99 | máx | errores |
|---|---:|---:|---:|---:|---:|---:|
| GET /tickets | 2 926 | 149ms | 367ms | 418ms | 460ms | 0 |
| GET /finanzas/ingresos-mensuales | 1 152 | 153ms | 367ms | 407ms | 465ms | 0 |
| GET /servicios | 1 043 | 120ms | 297ms | 334ms | 442ms | 0 |
| GET /categorias | 684 | 126ms | 299ms | 324ms | 358ms | 0 |
| GET /buscar-folio | 698 | 156ms | 373ms | 433ms | 495ms | 0 |
| POST /tickets (crear folio) | 691 | 144ms | 317ms | 351ms | 423ms | 0 |

**479.6 peticiones/segundo, cero errores.** La latencia sube frente a
30 usuarios (p95 pasa de ~100-190ms a ~300-370ms) pero **sigue sin
haber ni un solo error**: el sistema no se cae ni empieza a responder
mal, solo tarda más por petición. En un laptop de desarrollo corriendo
Node y PostgreSQL en el mismo procesador, ese es el techo esperable —
el hardware real del servidor de la institución puede dar más margen
(o menos, si es más modesto); lo importante es que el comportamiento
bajo presión es "más lento", no "se rompe".

### Ráfaga de 25 inicios de sesión en el mismo instante

**~7 segundos para la persona que le tocó el turno más tardado**, cero
errores. Esto es intencional, no un bug: la contraseña se verifica con
bcrypt a costo 12, un cálculo deliberadamente lento (fracciones de
segundo por cuenta) para que probar contraseñas una tras otra a la
fuerza sea impráctico. Con 25 cuentas entrando exactamente al mismo
milisegundo, esos cálculos se van formando en fila. En la práctica,
que 25 personas inicien sesión en el mismo instante exacto (no "en el
mismo minuto", sino el mismo instante) es un caso extremo poco
probable — pero si en algún momento se vuelve un problema real,
bajar el costo de bcrypt es la única forma de acelerarlo, y eso sí
reduciría la protección contra fuerza bruta. No se tocó por eso.

## Cómo se dimensionaron algunos límites de configuración

- **Límite de intentos por IP en login, separado del de registro**
  (`servidor/api/src/index.ts`): el límite pensado para frenar fuerza
  bruta se dimensiona pensando en una IP compartida por todo un
  campus (un mismo NAT/firewall institucional a la salida a
  internet, algo común), no en una sola persona — un número bajo ahí
  no detiene a un atacante (a quien detiene el bloqueo por cuenta,
  ver `SECURITY.md`), solo arriesga bloquear a todo el personal si
  coinciden varias personas entrando a la vez. El límite de registro
  de cuentas nuevas se mantiene aparte y más bajo, al ser un evento
  poco frecuente por persona.
- **Validación de la lista de procedimientos al crear un folio**
  (`servidor/api/src/rutas.ts`): la columna es obligatoria en la base
  de datos; la ruta la valida explícitamente antes de intentar
  guardar, para responder con un mensaje claro en vez de un error de
  servidor genérico ante una petición incompleta.
- **Límite de conexiones a la base de datos, configurable**
  (`DB_POOL_MAX` en `servidor/api/.env`, ver `db.ts`): con 20
  conexiones simultáneas de margen por default, ajustable según la
  capacidad del servidor donde se despliegue. En el hardware de
  desarrollo usado para esta prueba, el límite real de rendimiento
  observado fue compartir un solo procesador entre Node y PostgreSQL,
  no el número de conexiones — el margen queda ahí para servidores
  con más capacidad.
- **Invalidación de sesión al cambiar la contraseña** (`requerirSesion`
  en `servidor/api/src/auth.ts`, ver `SECURITY.md`): agrega una
  consulta adicional, de una sola columna, en cada petición protegida.
  A 30 usuarios simultáneos, esto no se refleja en el rendimiento
  medido (577 peticiones/segundo, p95 entre 73ms y 131ms según la
  ruta) frente al escenario equivalente sin ese control.

## Qué NO mide esta prueba

- No mide el servidor real de la institución, solo hardware de
  desarrollo — antes de un despliegue con mucha gente, vale la pena
  correr `npm run carga` directo en el servidor final.
- No simula el envío de correo (confirmación de cuenta, recuperación
  de contraseña) bajo carga — depende de Microsoft Graph, que tiene
  sus propios límites, ajenos a este sistema.
- No es una prueba de penetración ni un sustituto de una auditoría de
  seguridad independiente (ver "Alcance y limitaciones" en
  [`SECURITY.md`](SECURITY.md)) — mide comportamiento bajo carga, no
  vulnerabilidades.
