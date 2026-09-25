# Guía de instalación

Finaquick incluye su propio servidor (`servidor/api`): Node.js, Express y
PostgreSQL directo, sin ninguna librería ni servicio de terceros para su
operación normal. El sistema completo corre sobre infraestructura propia
de la institución — el único servicio externo opcional es Google Gemini,
para Quick (sección 5), apagado por default.

## 1. Instalación automática

Los instaladores **"Iniciar Finaquick.command"** (macOS) e
**"Iniciar Finaquick.bat"** (Windows) preparan y levantan el sistema
completo en un solo paso, siempre que [Node.js](https://nodejs.org)
(20.19 o superior) y [PostgreSQL](https://www.postgresql.org/download/)
(13 o superior) ya estén instalados — ver "Requisitos" en la sección 2
para el detalle de versiones:

1. Crea la base de datos y aplica el esquema (solo la primera vez).
2. Genera credenciales propias para esa instalación.
3. Solicita el nombre de la institución y el correo del primer
   administrador, y crea la invitación correspondiente.
4. Inicia el servidor y abre la aplicación en el navegador.

Si PostgreSQL no está instalado, el instalador lo indica y abre
únicamente la interfaz, sin base de datos conectada. Una vez instalado
PostgreSQL, ejecutar el instalador de nuevo completa la configuración.

El nombre de la institución y el correo del administrador son
obligatorios en este paso — sin al menos una cuenta de administrador, el
sistema queda instalado pero sin ninguna forma de acceder a él, dado que
el registro es exclusivamente por invitación. El instalador vuelve a
solicitar estos datos si se dejan en blanco; para configurarlos
manualmente en otro momento, cerrar el instalador (Ctrl+C) y ver la
sección 2, Paso 4. Si la invitación automática falla por otro motivo, la
cuenta también puede crearse manualmente ahí. La configuración del
inicio de sesión con Microsoft (sección 3) sí requiere hacerse
manualmente, dado que necesita acceso al panel de administración de
Microsoft de la institución.

## 2. Instalación manual

Usar esta ruta para revisar cada paso individualmente, o si la
instalación automática no se completó.

### Requisitos

- [Node.js](https://nodejs.org) 20.19 o superior (o 22.12 o superior) —
  lo exige Vite, la herramienta que empaqueta el frontend. Una versión
  LTS actual de Node.js ya cumple esto de sobra; `node --version`
  confirma cuál está instalada.
- PostgreSQL 13 o superior (probado con la 16). No se requiere Docker
  ni ninguna herramienta adicional.

### Paso 1 — Base de datos

Crear una base de datos vacía y aplicar el esquema:

```bash
createdb finaquick
psql -d finaquick -f servidor/esquema_local.sql
```

El script crea también un rol de aplicación (`finaquick_app`) con
únicamente los permisos que necesita. No usar el rol con el que se
ejecutó este script en `DATABASE_URL` — ese rol suele ser el
propietario o superusuario, y un superusuario omite por completo la
seguridad a nivel de fila sin importar cómo esté configurada.

Establecer la contraseña de ese rol (el script deja una de relleno,
`cambia-esta-contrasena`). Usar solo letras y números, sin
`@ : / # ? %` ni espacios — esa contraseña viaja dentro de una URL de
conexión (`DATABASE_URL`), y un símbolo especial puede hacer que
`psql`/`pg_dump` interpreten incorrectamente dónde termina la
contraseña. La instalación automática no tiene esta restricción: genera
la contraseña en un formato siempre seguro.

```bash
psql -d finaquick -c "alter role finaquick_app password 'una-contraseña-real-y-larga';"
```

El script crea un segundo rol, `finaquick_respaldo`, exclusivo para
generar respaldos (ver sección "Respaldos"), con permiso para ver toda
la información sin que la seguridad a nivel de fila la filtre. Establecer
su contraseña de la misma forma:

```bash
psql -d finaquick -c "alter role finaquick_respaldo password 'otra-contraseña-real-y-larga-distinta';"
```

Si el servidor de PostgreSQL vive en otra máquina, usar `-h` / `-U` /
`-W` de `psql`, o la cadena de conexión completa.

### Paso 2 — Servidor (`servidor/api`)

```bash
cd servidor/api
npm install
cp .env.example .env
```

Editar `servidor/api/.env` con el rol `finaquick_app` creado en el paso
1 y su contraseña:

```
DATABASE_URL=postgresql://finaquick_app:una-contraseña-real-y-larga@localhost:5432/finaquick
DATABASE_URL_RESPALDO=postgresql://finaquick_respaldo:otra-contraseña-real-y-larga-distinta@localhost:5432/finaquick
JWT_SECRET=<generar con el comando de abajo>
PORT=4000
ORIGEN_PERMITIDO=http://localhost:5173
FRONTEND_URL=http://localhost:5173
```

Generar `JWT_SECRET` (cadena aleatoria usada para firmar las sesiones):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Iniciar el servidor:

```bash
npm run dev
```

Debe mostrar `Servidor de Finaquick escuchando en el puerto 4000`.

### Paso 3 — Frontend

En la raíz del proyecto (no en `servidor/api`), crear o editar
`.env.local`:

```
VITE_BACKEND_MODE=local
VITE_API_URL=http://localhost:4000/api
```

Iniciar la aplicación:

```bash
npm install
npm run dev
```

### Paso 4 — Cuenta de administrador

Si se usó la instalación automática (sección 1), este paso ya se
completó. Esta sección aplica solo a quien siguió la instalación manual,
o dejó esos campos en blanco durante la instalación automática.

El registro es exclusivamente por invitación, así que la primera cuenta
se crea directamente en la base de datos. Las siguientes cuentas se
invitan desde la propia aplicación.

```sql
insert into organizations (nombre, color_primario)
values ('Nombre de la institución', '#3a3a3a')
returning id;  -- copiar este id para la siguiente instrucción

insert into invitaciones (correo, org_id, rol, token)
values ('correo@institucion.mx', '<el id anterior>', 'admin', 'un-codigo-cualquiera-que-tú-elijas');
```

Con esto, ese correo puede registrarse desde la pantalla `/registro` de
la aplicación, con la contraseña que elija en ese momento — pero
también necesita ese mismo código de invitación (campo "Código de
invitación" del formulario). Es la prueba de que quien se registra es
a quien de verdad se le dio ese código, no solo que conoce o adivinó el
correo invitado; cuando la primera cuenta la crea la misma persona que
corre este script, basta con anotar el código que se escribió arriba.

### Paso 5 — Datos de ejemplo (opcional, solo para revisión/demostración)

Sirve para ver la app ya con folios, servicios y catálogo cargados, sin
tener que crearlos todos a mano antes de poder mostrarla. **No es un
paso de una instalación para uso real** — es justo lo contrario de lo
que se espera ahí (folios y personas ficticias).

Necesita que YA exista la cuenta del primer administrador (paso 4, o el
que haya hecho el instalador automático) — sin eso, el script se
detiene con un mensaje explicándolo, sin dejar nada a medias.

```bash
cd servidor/api
npm run demo
```

Se puede correr varias veces sin duplicar nada: si un servicio o
categoría ya existe con ese nombre, lo deja tal cual; los folios de
ejemplo (prefijo `DEMO-`) se reemplazan cada vez. Para quitarlos antes
de usar la app con datos reales, ver `servidor/datos_demo.sql` — borra
cualquier fila con ese mismo prefijo.

#### Actividad en vivo, para una demostración (opcional)

Si además quieres que se vea gente usando el sistema — folios nuevos
apareciendo, cuentas activas en "Usuarios" — mientras tú mismo estás
en la app, corre esto en OTRA ventana de comandos, con el servidor real
ya corriendo (por ejemplo, con "Iniciar Finaquick" ya abierto):

```bash
cd servidor/api
npm run demo:vivo
```

Crea 8 cuentas reales (6 con rol "personal", 2 con "finanzas" — para
que se vea la mezcla de un equipo real, no todas idénticas), visibles
en Configuración → Usuarios, y cada 10 segundos más o menos una de
ellas hace algo contra tu servidor real: genera un folio, revisa el
historial, busca uno, consulta el panel financiero, o mira el
catálogo — no solo folios, para que se vea uso real de la app
completa. Los folios se ven en "Actividad" y en "Historial" igual que
cualquier folio real, con el nombre marcado "Demo — " para
distinguirlos. A diferencia de `npm run carga`, esto no arranca un
servidor ni una base de datos aparte — usa la real, y por diseño no
compite fuerte por el procesador, así que no debería interrumpir tu
propia sesión mientras lo tienes corriendo.

Necesita que ya exista un servicio con al menos una categoría (corre
`npm run demo` primero si no tienes ninguno). Se detiene con Ctrl+C
cuando quieras — no borra los folios ni las cuentas que ya creó, esos
se quedan (son justo el punto: que se vean después). Para ajustar
cuánta gente (hasta 14) y qué tan seguido:

```bash
PERSONAS=14 INTERVALO_SEG=15 npm run demo:vivo
```

Para quitar los folios que generó más adelante, mismo criterio que los
de `npm run demo`: borra de la tabla `tickets` cualquier fila cuyo
nombre empiece con `Demo — `.

## 3. Inicio de sesión con la cuenta institucional de Microsoft (opcional)

Si la institución ya usa Microsoft para el correo institucional, el
botón "Microsoft" en la pantalla de inicio de sesión puede autenticar
contra esa misma cuenta — sin contraseña adicional que memorizar, y
restringido únicamente al tenant (organización) de Microsoft Entra ID de
la institución. La invitación del administrador sigue siendo
obligatoria: tener una cuenta de Microsoft válida no autoriza por sí
sola el acceso al sistema.

Esta configuración requiere acceso al **Microsoft Entra ID admin
center** (anteriormente Azure AD) de la institución:

1. En [entra.microsoft.com](https://entra.microsoft.com) → **Aplicaciones** → **Registros de aplicaciones** → **Nuevo registro**.
2. Nombre: "Finaquick" (o el que se prefiera).
3. Tipos de cuenta admitidos: **"Solo cuentas en este directorio organizativo"** — restringe el acceso a cuentas de la institución, excluyendo cuentas personales de Microsoft.
4. URI de redirección, tipo **Web**: `http://localhost:4000/api/auth/microsoft/callback` (o el dominio real, una vez desplegado).
5. Copiar el **"Id. de aplicación (cliente)"** y el **"Id. de directorio (inquilino)"** de la página de información general.
6. **Certificados y secretos** → **Nuevo secreto de cliente** → copiar el valor generado (solo se muestra una vez).
7. **Permisos de API**: confirmar que `User.Read` de Microsoft Graph esté presente (incluido por defecto).

Con esos datos, en `servidor/api/.env`:

```
MICROSOFT_CLIENT_ID=<Id. de aplicación (cliente)>
MICROSOFT_CLIENT_SECRET=<el secreto generado>
MICROSOFT_TENANT_ID=<Id. de directorio (inquilino)>
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/auth/microsoft/callback
```

Reiniciar el servidor para activar el botón de Microsoft. Sin estas
variables, el botón permanece visible pero indica que falta
configuración — no interrumpe el resto del sistema ni permite el acceso
de nadie.

## 4. Envío de correo (opcional)

Reutiliza el mismo registro de aplicación de la sección 3, con un
permiso adicional:

1. En la misma aplicación registrada en Microsoft Entra ID → **Permisos de API** → **Agregar un permiso** → **Microsoft Graph** → **Permisos de aplicación** (no "delegados") → buscar `Mail.Send` y agregarlo.
2. Este permiso requiere aprobación de un administrador global — el botón **"Conceder consentimiento de administrador"** aparece en la misma pantalla.
3. En `servidor/api/.env`, agregar el buzón de envío (debe ser una cuenta de correo real de la institución):

```
MICROSOFT_CORREO_ENVIO=notificaciones@institucion.mx
```

Con esto y las variables `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
/ `MICROSOFT_TENANT_ID` de la sección 3 ya configuradas, se habilitan:
recuperación de contraseña por correo, confirmación de correo al
registrarse, y aviso por correo al recibir un archivo. Sin esta
configuración, el sistema funciona igual, sin enviar esos tres correos.

**Paso adicional obligatorio, del lado de Microsoft, no de este
proyecto** — `Mail.Send` como permiso de aplicación (no delegado) le
da a esta app, por default, la capacidad técnica de mandar correo
**a nombre de CUALQUIER cuenta de todo el tenant de Microsoft 365 de
la institución**, no solo del buzón configurado arriba — el código de
este proyecto solo lo usa para `MICROSOFT_CORREO_ENVIO`, pero eso es
un límite que el código se impone a sí mismo, no algo que Microsoft
esté restringiendo por su cuenta. Si el `MICROSOFT_CLIENT_SECRET` se
filtrara, alguien con ese secreto podría, en principio, mandar correo
como cualquier persona de la universidad usando la API de Graph
directamente, sin pasar por este código en absoluto.

Para cerrar esto de verdad, el equipo de sistemas debe crear una
**directiva de acceso de aplicación** (Application Access Policy) en
Exchange Online, que restrinja a esta aplicación específica (por su
`MICROSOFT_CLIENT_ID`) a solo poder actuar sobre el buzón configurado.

`servidor/scripts/configurar-politica-correo.ps1` deja esto listo para
correr — solo hay que completar el `MICROSOFT_CLIENT_ID` y el buzón al
principio del archivo, y ejecutarlo en PowerShell con una cuenta de
administrador de Microsoft 365. El script mismo verifica al final que
la política haya quedado bien puesta (confirma que SÍ se puede enviar
desde el buzón permitido, y explica cómo confirmar que NO se puede
desde cualquier otro).

Sin este paso, el permiso queda técnicamente más amplio de lo que el
sistema necesita — vale la pena pedirle a la persona que administra
Microsoft 365 en la institución que lo confirme antes de dar por
terminada esta configuración.

## 5. Quick — el asistente de datos con IA (opcional)

Quick es el ícono junto a la campana de notificaciones: deja preguntar
en español normal cosas como "cuánto cobré ayer", "qué procedimiento
se vendió más este mes", o "cómo voy comparado con el mes pasado", y
también funciona como un chat libre para preguntas que no calzan en
ningún patrón fijo. **Funciona sin configurar nada** — por default
entiende un conjunto ya amplio de patrones de búsqueda escritos "a
mano" (fechas, nombres, "resumen de tal mes"), sin depender de ningún
servicio externo. Configurar lo de abajo solo lo hace entender frases
más variadas, y habilita el chat libre.

1. Consigue una clave de API de **Google AI Studio** (Gemini) en
   [ai.google.dev](https://ai.google.dev) — con una cuenta de Google
   normal, sin tarjeta, hay un nivel gratuito pensado justo para este
   tipo de uso ligero (revisa las condiciones vigentes, pueden
   cambiar).
2. En `servidor/api/.env`:

```
GEMINI_API_KEY=la-clave-que-generaste
GEMINI_MODELO=
```

`GEMINI_MODELO` se puede dejar vacío — usa un modelo rápido y
económico por default (`gemini-2.5-flash` al momento de escribir
esto). Solo hace falta ponerlo si algún día Google retira ese modelo o
se prefiere uno distinto.

3. Reinicia el servidor (el `.env` solo se lee al arrancar) y abre
   Quick: arriba debe decir **"IA conectada"**. Si dice "Modo básico",
   la clave no se cargó; si dice "La IA no respondió", Google rechazó
   la llamada — con una cuenta de administrador, el mismo aviso dice
   la causa probable (clave inválida, modelo retirado, límite de uso o
   sin conexión a internet).

**Qué datos salen de la institución, y qué no** — importante para
decidir si activar esto: con `GEMINI_API_KEY` puesta, cada pregunta a
Quick sí sale hacia los servidores de Google (la única forma de que un
modelo de lenguaje conteste). Hay dos niveles distintos, según qué
tipo de pregunta se haga:

- **Clasificar y redactar** (la mayoría de las preguntas de un solo
  dato — "cuánto cobré ayer", "resumen de agosto"): Gemini solo recibe
  la pregunta y un resumen YA AGREGADO — totales, conteos, nombres de
  procedimientos del catálogo, tendencias mensuales — nunca un folio
  ni un nombre real de persona.
- **Chat libre** (preguntas que piden el detalle real, no solo un
  total — "quién no ha pagado", "los folios de esta semana con
  nombre"): Gemini SÍ puede recibir, además de lo anterior, hasta 300
  folios individuales recientes **con nombre real** de quien pagó o
  debe (`foliosDetalle`) — pedido explícito, para que Quick pueda
  contestar ese tipo de pregunta de verdad. Ese detalle nunca es más
  de lo que la propia cuenta que pregunta ya podía ver en el resto de
  la app — alguien con acceso acotado a un solo servicio nunca hace
  que Quick vea folios de otro servicio, porque esa sesión nunca los
  tuvo cargados para empezar (ver `SECURITY.md`, sección de Quick,
  para el detalle completo de esta restricción).

En ningún caso sale un dato en crudo ajeno al catálogo, la cuenta, o
los folios que esa sesión ya podía ver — nunca contraseñas, nunca
datos de otra organización. Aun así, que nombres reales de personas y
el detalle de folios individuales puedan salir hacia un proveedor
externo (aunque sea solo cuando la pregunta lo amerite, y solo lo que
esa sesión ya veía) es una decisión real de política de datos de la
institución, no solo una casilla técnica — vale la pena confirmarlo
con quien decida esas políticas antes de activarlo.

Sin `GEMINI_API_KEY`, Quick sigue funcionando exactamente igual para
las preguntas que ya entiende por patrones — nada se rompe, y ningún
dato sale nunca de la instalación.

## 6. Respaldos

Genera una copia completa de la base de datos (usuarios, folios,
organizaciones) en un archivo que puede restaurarse íntegramente ante
cualquier incidente.

**Generación manual:**

```bash
cd servidor/api
npm run respaldar
```

Cada ejecución crea un archivo con fecha y hora en
`servidor/api/respaldos/` (carpeta excluida del control de versiones).
Se conservan los últimos 14 respaldos; los más antiguos se eliminan
automáticamente.

**Programación automática** — responsabilidad del equipo de sistemas de
la institución, con la herramienta de programación de tareas que ya
utilicen:

- **macOS/Linux** (`cron`): agregar a `crontab -e`:
  ```
  0 3 * * * cd /ruta/completa/a/servidor/api && npm run respaldar >> /var/log/finaquick-respaldo.log 2>&1
  ```
  (ejecuta el respaldo diariamente a las 3 a. m.; ajustar ruta y horario según convenga).
- **Windows** (Programador de tareas): crear una tarea que ejecute
  `npm run respaldar` con "Iniciar en" apuntando a `servidor\api`,
  programada diariamente.

Se recomienda además copiar los respaldos automáticamente a una
ubicación distinta (otro disco, otro servidor, almacenamiento en la nube
de la institución) — un respaldo alojado en la misma máquina no protege
contra la pérdida de esa máquina completa. Esta decisión corresponde al
equipo de sistemas, según la política de respaldos ya vigente para sus
otros sistemas.

**Restauración** (con el servidor detenido, o contra una base de datos
nueva), usando el rol superusuario o propietario del esquema — no
`finaquick_app` ni `finaquick_respaldo`, que intencionalmente carecen de
permiso para crear o eliminar tablas:

```bash
psql -d finaquick -f servidor/api/respaldos/finaquick_2026-01-15_03-00-00.sql
```

Esta operación reemplaza todo el contenido de la base de datos indicada.
Confirmar que corresponde a la base de datos correcta antes de
ejecutarla.

**Actualizar el esquema una vez que ya haya datos reales en producción:**
`servidor/esquema_local.sql` está pensado para correrse UNA sola vez,
contra una base de datos vacía — así es como lo aplica el instalador
en una instalación nueva, y así es como lo corre la suite de pruebas
antes de cada corrida (`prepararBaseDeDatos()` en
`servidor/api/test/helpers.ts`, sobre una base descartable). Nada en
este proyecto, hoy, necesita otra cosa: esta es la primera instalación
real, sin ninguna base de datos anterior que preservar.

Eso deja de ser cierto en cuanto la institución empiece a operar con
datos reales y, más adelante, haga falta un cambio de esquema (una
columna nueva, un índice, una función corregida). En ese momento,
**no** es seguro volver a correr `esquema_local.sql` completo sobre esa
base ya en uso — el archivo tiene `create table` para tablas que ya
existirían, y no borra ni reemplaza funciones de forma controlada.
Antes de ese primer cambio de esquema en producción, hace falta:

1. Un respaldo completo (ver arriba) inmediatamente antes.
2. Un script de migración que solo aplique la diferencia (las columnas/
   índices/funciones nuevos o cambiados), no el esquema entero — con
   sus propias sentencias `alter table`, `create or replace function`,
   etc., dentro de una transacción.
3. Probar esa migración primero contra una copia restaurada del
   respaldo, no contra la base real directamente.

Esto es una responsabilidad de quien mantenga el proyecto a partir de
ese momento, no algo que este documento pueda resolver de antemano sin
saber qué cambiará ni cuándo — pero se deja anotado aquí para que nadie
lo pase por alto la primera vez que haga falta.

## 7. Monitoreo y continuidad

### Registro de eventos

Todo error detectado por el servidor —manejado o inesperado— se escribe
en `servidor/api/logs/`, un archivo por día, además de la consola. Se
conservan los últimos 30 días.

### Verificación de estado

`GET /api/salud` confirma que el proceso responde y que la base de datos
también contesta, junto con el tiempo de actividad:

```bash
curl http://localhost:4000/api/salud
```

Compatible con cualquier herramienta de monitoreo que la institución ya
utilice, o con una verificación programada simple.

### Reinicio automático

Sin un gestor de procesos, un error no controlado detiene el servidor
hasta que alguien lo reinicie manualmente. Con
[pm2](https://pm2.keymetrics.io/) (gestor de procesos de Node.js de uso
extendido), el servidor se reinicia automáticamente:

```bash
cd servidor/api
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save        # conserva la configuración ante un reinicio de la máquina
pm2 startup     # configura el arranque automático de pm2 al iniciar el sistema
```

`pm2 logs finaquick-api` muestra la actividad en tiempo real; `pm2 status`
indica si el proceso está activo.

## 8. Pruebas automatizadas

`servidor/api/test/` contiene una suite de pruebas que arranca el
servidor real contra una base de datos de pruebas (separada de
cualquier dato real, se crea y se borra sola en cada corrida) y
confirma en vivo, por HTTP, que los controles de seguridad y
validación descritos en `SECURITY.md` siguen funcionando — registro
solo por invitación, suplantación de identidad bloqueada, bloqueo de
cuenta tras intentos fallidos, límites por rol, y que ninguna
operación reporte éxito sin haber ocurrido de verdad.

```bash
cd servidor/api
npm test
```

Requiere PostgreSQL disponible localmente (usa los mismos comandos
`createdb`/`psql` que el resto del proyecto) — no necesita el servidor
de desarrollo corriendo aparte, lo levanta y lo detiene solo. Se
recomienda correrla después de cualquier cambio al servidor, antes de
desplegarlo.

Al final de la corrida se imprime un reporte de cobertura (qué
porcentaje de cada archivo del servidor quedó ejercitado por alguna
prueba) — nativo de Node.js, sin ninguna herramienta adicional.

## 9. Prueba de carga

```bash
cd servidor/api
npm run carga
```

Simula varias decenas de personas usando el sistema al mismo tiempo
contra un servidor y una base de datos reales (aparte, se crean y se
borran solas), y al final imprime cuánto tardó cada tipo de petición.
Igual que la suite de pruebas, no necesita nada que no esté ya
instalado para correr el servidor. Ver
[`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md) para cómo interpretar el
resultado, los números de referencia disponibles, y cómo ajustar
cuántos usuarios simular.

## 10. Arquitectura interna

- **`servidor/esquema_local.sql`**: define todas las tablas y aplica
  seguridad a nivel de fila (RLS) de PostgreSQL — cada consulta solo
  accede a lo que corresponde según organización y rol, reforzado en la
  base de datos, no únicamente en la interfaz.
- **`servidor/api`**: servidor HTTP que valida la sesión (JWT en una
  cookie `httpOnly`, inaccesible desde JavaScript) e identifica al
  usuario en cada consulta a PostgreSQL para que la seguridad a nivel de
  fila filtre correctamente. Las contraseñas se almacenan con `bcrypt`.
  Ver [`SECURITY.md`](SECURITY.md) para el detalle completo de los
  controles implementados.
- **`src/lib/db/localApiAdapter.ts`**: capa del cliente que se comunica
  con el servidor.

## 11. Despliegue en un servidor de la institución

- El **frontend** (`npm run build`) genera archivos estáticos (`dist/`),
  servibles desde cualquier servidor web (IIS, Nginx, Apache).
- El **servidor** (`servidor/api`) es una aplicación de Node.js estándar
  — `npm run build && npm start`, o gestionado con `pm2` como cualquier
  otro servicio backend.
- La **base de datos** es PostgreSQL, alojable en la misma
  infraestructura donde la institución aloje sus otras bases de datos,
  incluyendo servicios administrados en la nube. Si el proveedor exige
  conexión cifrada, agregar `?sslmode=require` al final de
  `DATABASE_URL` y `DATABASE_URL_RESPALDO` — sin requerir cambios en el
  código (ejemplo: `postgresql://usuario:contraseña@servidor.institucion.mx:5432/finaquick?sslmode=require`).
- **Importante para coordinar con el equipo de sistemas ANTES del día
  de la instalación:** aplicar `servidor/esquema_local.sql` por primera
  vez requiere una cuenta con privilegios de superusuario o dueño del
  esquema — el script crea dos roles propios de PostgreSQL
  (`finaquick_app`, `finaquick_respaldo`) y activa seguridad por fila
  forzada. Esto es una sola vez, no algo que la aplicación necesite en
  su operación normal (que corre con `finaquick_app`, un rol acotado,
  sin ese privilegio) — pero si la base de datos vive en un servicio
  administrado donde la institución no tiene ese nivel de control (todo
  se hace desde la consola del proveedor), hay que pedirle a quien sí
  lo tenga que corra el script, o solicitar una base de datos dedicada
  con privilegios completos para esta instalación.
- Si ese servidor de PostgreSQL también aloja otras bases de datos de
  la institución (no uno dedicado solo a Finaquick), correr
  `servidor/scripts/verificar-aislamiento-bd.sh nombre_de_la_base` una
  vez, después de instalar — confirma que los roles de esta
  aplicación no tengan más privilegios de los necesarios, y señala
  cualquier otra base de datos del mismo servidor con conexión
  abierta por default (ver `SECURITY.md`, "Aislamiento de red").
- Al desplegar detrás de HTTPS, agregar `COOKIE_SECURE=true` en
  `servidor/api/.env`, de forma que la cookie de sesión viaje siempre
  cifrada.
- Si el servidor opera detrás de un proxy o balanceador (Nginx, IIS
  como proxy inverso, un balanceador de carga), agregar `TRUST_PROXY=1`
  (o el número de saltos de proxy correspondiente) — de lo contrario, el
  límite de intentos de inicio de sesión identifica a todos los usuarios
  con la IP del proxy en lugar de la IP real de cada uno. No activar
  esta variable si el servidor no opera realmente detrás de un proxy.

El sistema no depende de ninguna cuenta ni servicio en la nube de
terceros para funcionar.
