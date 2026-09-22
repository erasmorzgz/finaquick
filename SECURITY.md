# Seguridad

Este documento describe los controles de seguridad implementados en el
servidor propio de Finaquick (`servidor/api` + PostgreSQL). Cada control
fue verificado mediante pruebas funcionales contra un servidor y una
base de datos en ejecución, no únicamente mediante revisión de código.

## Autenticación

- Las contraseñas se almacenan con `bcrypt`, nunca en texto plano.
- Longitud mínima de 8 caracteres, exigida tanto en la interfaz como en
  el servidor.
- Sesiones firmadas con JWT y vencimiento, transmitidas en una cookie
  `httpOnly` que establece y elimina el propio servidor. JavaScript en
  el navegador no tiene acceso a esa cookie bajo ninguna circunstancia,
  incluida una eventual inyección de código en el cliente.
- **Cambiar la contraseña invalida de inmediato cualquier otra sesión
  activa** de esa cuenta — uno mismo cambiándola, un administrador
  restableciéndola, o un enlace de "olvidé mi contraseña". Sin esto,
  una sesión ya copiada (por ejemplo, de una laptop robada con la
  sesión abierta) seguía funcionando hasta sus 30 días de vencimiento
  sin importar que la contraseña ya fuera otra — cambiarla no le
  cerraba la puerta a quien ya tenía una copia. La persona que hizo el
  cambio no pierde su propia sesión: recibe una cookie nueva en la
  misma respuesta.
- El registro de cuentas es exclusivamente por invitación: sin una
  invitación vigente para el correo indicado, el registro se rechaza.
  No existe alta pública de cuentas. **Además del correo, el registro
  exige un código de invitación** generado al crear la invitación
  (Configuración → Usuarios) y mostrado una única vez a quien invita,
  igual que una contraseña temporal — sin este código, coincidir solo
  el correo no demostraba que quien se registra de verdad lo controla:
  cualquiera que conociera o adivinara un correo con invitación
  pendiente podía registrarlo primero, con su propia contraseña,
  quedándose con el rol de esa invitación (incluido administrador, si
  esa era la invitación). El registro vía la cuenta institucional de
  Microsoft no necesita este código — Microsoft ya demuestra esa misma
  identidad de una forma más fuerte (ver "Inicio de sesión con
  Microsoft").
- Límite de intentos por dirección IP: 300 cada 15 minutos en inicio
  de sesión (y en el segundo paso de 2FA), 20 cada 15 minutos en
  registro de cuentas nuevas — con presupuestos separados, para que
  una tanda de altas de cuentas no le reste presupuesto de login a
  todos los demás en la misma IP, ni viceversa. El número de login está
  dimensionado para una IP compartida por todo un campus (un mismo
  NAT/firewall institucional a la salida a internet, algo común): la
  barrera real contra fuerza bruta sobre UNA cuenta específica es el
  bloqueo por cuenta de abajo, no este límite — este solo evita que
  una sola dirección sature el servidor de peticiones. Ver
  [`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md) para el escenario de
  referencia usado para dimensionarlo.
- **Bloqueo por cuenta**: 5 contraseñas incorrectas consecutivas
  bloquean esa cuenta específica durante 15 minutos, sin importar el
  número de direcciones IP de origen — complementa el límite por IP, que
  por sí solo no detiene un ataque distribuido contra una sola cuenta.
  El bloqueo se restablece con un inicio de sesión exitoso.
- **Bitácora de inicios de sesión**: cada intento fallido y cada inicio
  de sesión exitoso queda registrado en la misma auditoría visible para
  un administrador (Configuración → Auditoría), incluyendo correo y
  momento del intento.
- **Restablecimiento de contraseña por un administrador**: un
  administrador puede generar una contraseña temporal aleatoria para
  cualquier cuenta desde Configuración → Usuarios. La contraseña se
  muestra una única vez, viaja solo en esa respuesta (no queda en
  ningún registro del servidor), y la anterior queda invalidada de
  inmediato. Este es el mecanismo disponible por defecto, sin
  necesidad de configurar envío de correo. **El cambio posterior es
  obligatorio, no solo una recomendación**: mientras la cuenta no
  cambie esa contraseña temporal, el servidor le bloquea cualquier
  ruta que no sea cambiarla o cerrar sesión — no puede seguir usándola
  indefinidamente aunque nadie se lo pida.
- **Recuperación de contraseña por correo (opcional)**: si el envío de
  correo está configurado, el enlace de recuperación vence en 1 hora y
  deja de ser válido en cuanto se utiliza una vez — el servidor
  registra un rastro de la contraseña vigente al generar el enlace y lo
  compara al usarlo, invalidándolo si ya cambió por cualquier medio. La
  respuesta es idéntica exista o no la cuenta correspondiente, para no
  revelar qué correos están registrados. Sin esta configuración, la
  recuperación queda a cargo de un administrador.
- Confirmación de correo al registrarse y aviso por correo al recibir
  un archivo (ambos opcionales, informativos, sin efecto sobre el
  registro o inicio de sesión mientras no estén configurados).
- **Protección contra registro automatizado**: un campo invisible en los
  formularios de inicio de sesión y registro detecta el llenado
  automático típico de bots. Si el campo recibe contenido, el servidor
  responde el mismo mensaje que unas credenciales incorrectas, sin
  revelar la existencia del mecanismo.
- **Autenticación de dos factores (2FA), opcional, por cuenta**:
  código de un solo uso (TOTP) de cualquier app autenticadora estándar
  (Google Authenticator, Authy, Microsoft Authenticator…) — el cálculo
  es enteramente local, sin llamar a ningún servicio externo. Con 2FA
  activo, la contraseña correcta no basta por sí sola: el servidor
  regresa un token de un solo propósito, con vencimiento de 5 minutos,
  y solo pone la cookie de sesión real después de verificar el código.
  Ese segundo paso comparte el mismo límite de intentos por IP que el
  primero (mismo contador que inicio de sesión, separado del de
  registro) — un código de 6 dígitos son un millón de combinaciones, y
  sin límite alguien con la contraseña pero sin el teléfono podría
  probarlas todas dentro de la ventana de 5 minutos. **Además, un
  código incorrecto cuenta para el mismo bloqueo por cuenta que una
  contraseña incorrecta** (5 seguidos bloquean la cuenta 15 minutos,
  sin importar desde cuántas direcciones IP distintas se repartan los
  intentos) — el límite por IP por sí solo no basta contra alguien que
  ya tiene la contraseña y reparte sus intentos entre varias IPs.
  Activarla exige confirmar con un código real generado por el secreto
  antes de quedar activa (para no bloquear a nadie de su propia cuenta
  por un QR mal escaneado); desactivarla exige la contraseña actual.
  **Activarla o desactivarla invalida cualquier otra sesión activa de
  esa cuenta**, igual que un cambio de contraseña — sin esto, una
  sesión ya copiada seguía sirviendo igual después de que su dueño
  activara 2FA para protegerse, o la desactivara pensando que eso
  también cerraba el acceso de quien la tuviera copiada. **El secreto
  se guarda cifrado** (AES-256-GCM, con una llave derivada de
  `JWT_SECRET` que nunca vive en PostgreSQL) — a diferencia de una
  contraseña, necesita poder recuperarse para verificar el código en
  cada login, así que un cifrado reversible es la única opción real;
  protegido además por las mismas reglas de fila de la tabla de
  perfiles, nunca expuesto en ninguna respuesta de la API. Rotar
  `JWT_SECRET` invalida también los secretos TOTP ya cifrados, no solo
  las sesiones — ver "Rotación de JWT_SECRET" más abajo.
- **Reemplazar un secreto 2FA ya activo exige la contraseña actual y no
  toca el secreto activo hasta confirmarse**: el secreto nuevo se
  guarda en una columna aparte, pendiente — el que de verdad se usa
  para verificar el login sigue siendo el anterior hasta que el
  reemplazo se confirme con un código real. Confirmarlo es, además, una
  actualización condicionada a que ese secreto pendiente siga siendo
  exactamente el que se acaba de verificar (no una lectura y luego una
  escritura por separado): si otra petición de esa misma cuenta
  alcanzara a pedir un secreto nuevo justo en ese instante, la
  confirmación se rechaza en vez de activar, por error, un secreto
  distinto al que en verdad se verificó.
- **Una cuenta creada por Microsoft (sin contraseña propia) puede
  activar 2FA reautenticándose con Microsoft en vez de escribir una
  contraseña que nunca tuvo**: al iniciar la configuración, se le
  redirige a reautenticarse ahí mismo — con `prompt=login`, exigiendo
  credenciales nuevas para esa solicitud en particular, sin que una
  sesión de Microsoft ya abierta en el navegador (SSO) baste por sí
  sola. El servidor liga esa reautenticación a la cuenta exacta que la
  pidió (no basta con volver con cualquier cuenta de Microsoft del
  mismo tenant) y emite un token de un solo propósito y 5 minutos de
  vigencia que sustituye a la contraseña solo para esa cuenta — una
  cuenta con contraseña propia no puede usar este camino para
  saltarse la suya. Ese token no lleva, hoy, un consumo de un solo uso
  server-side (una lista de tokens ya gastados): dentro de su ventana
  de 5 minutos, reenviarlo repite el mismo efecto acotado (dejar un
  secreto pendiente sin activar, nunca activarlo — eso sigue exigiendo
  un código TOTP real), así que el riesgo de no tener ese registro es
  bajo, pero es una limitación real, no una casualidad de diseño.
- Dependencias sin vulnerabilidades conocidas (`npm audit` limpio en
  frontend y servidor), verificado en cada modificación del proyecto.

## Autorización y control de acceso

Cada tabla de la base de datos aplica reglas de seguridad a nivel de
fila (RLS) de PostgreSQL, reforzadas dentro de la propia base de datos y
no únicamente en la interfaz — las mismas reglas aplican aunque una
solicitud llegue directamente a la API sin pasar por ninguna pantalla.

- Un usuario solo accede a los datos de las organizaciones a las que
  pertenece. Verificado con cuentas en organizaciones distintas: ninguna
  ve los servicios ni la lista de usuarios de la otra.
- Las acciones administrativas (crear o eliminar organizaciones, cambiar
  roles, administrar servicios) exigen rol de administrador, verificado
  en el servidor.
- Los folios financieros no se pueden eliminar mediante la API, ni
  siquiera con rol de administrador — se conservan como historial
  permanente.
- La bitácora de auditoría tampoco admite edición ni eliminación por la
  API.
- Un usuario con acceso de solo consulta a un servicio puede verlo, pero
  no generar ni modificar folios en él.
- El campo `rol` de cada cuenta está protegido a nivel de columna,
  además de por las reglas de fila: ninguna cuenta puede autoasignarse
  el rol de administrador mediante una actualización de perfil, aun
  llamando la API directamente. Solo una función dedicada, con su propia
  verificación de permisos, puede modificarlo.
- El servidor se conecta a la base de datos con un rol de aplicación
  dedicado (`finaquick_app`), sin privilegios de superusuario y sin ser
  propietario de las tablas — un superusuario omite la seguridad a nivel
  de fila sin importar cómo esté configurada. `FORCE ROW LEVEL SECURITY`
  está activo en cada tabla como capa adicional.
- **Ninguna función queda ejecutable por cualquier rol que se conecte a
  la base de datos**: por default, PostgreSQL deja que cualquier rol
  ejecute una función recién creada, incluidas las `SECURITY DEFINER`
  que hacen las operaciones privilegiadas (cambiar de rol, eliminar una
  organización, restablecer una contraseña). Ese privilegio se revoca
  explícitamente de `PUBLIC` en cada una, y se otorga solo a
  `finaquick_app` — reduce la superficie de ataque si algún día otro
  rol se conecta a esta misma base de datos, aunque cada función ya
  valide por su cuenta quién la llama.
- **Identidad de autor derivada de la sesión, nunca del cliente**: en
  toda operación que registra quién la realizó —eventos de auditoría,
  folios financieros, archivos compartidos entre usuarios— el servidor
  toma la identidad exclusivamente de la sesión autenticada. Un valor
  distinto enviado en la solicitud se ignora por completo, evitando que
  una cuenta atribuya una acción a otra persona.
- **El acceso a un servicio exige también seguir siendo miembro de su
  organización, no solo tener una asignación directa**: la política que
  decide si una cuenta puede leer/generar folios de un servicio exige
  las dos cosas — una fila de asignación al servicio Y membresía
  vigente a la organización dueña de ese servicio. Antes solo exigía lo
  primero: si a alguien se le quitaba una organización pero, por lo que
  fuera, su asignación directa a uno de sus servicios sobrevivía, el
  acceso a los folios de ese servicio seguía funcionando con solo
  conocer su identificador, aunque el menú ya no lo mostrara. Quitar la
  organización de alguien también limpia, en la misma operación, sus
  asignaciones a los servicios de esa organización — pero la garantía
  real vive en la política misma, no en que cada ruta que pudiera tocar
  una membresía recuerde hacer esa limpieza.
- Verificado con pruebas de autorización por identificador (IDOR) en
  cada ruta que recibe un identificador de recurso en la URL o en el
  cuerpo de la solicitud: ninguna cuenta sin rol de administrador puede
  modificar datos de una organización a la que no pertenece.
- **El rol de administrador es de toda la institución, no por
  organización** — a propósito: las "organizaciones" representan
  campus o sedes de una misma institución, y un administrador debe
  poder operar los de todos ellos desde una sola cuenta, sin que un
  administrador de un campus quede bloqueado de los demás. Los roles
  "finanzas" y "personal" sí quedan limitados estrictamente a las
  organizaciones a las que pertenecen.
- **La institución nunca puede quedar sin ningún administrador**:
  quitarle el rol de administrador a la única cuenta que lo tiene se
  rechaza — sin este candado, alguien podía degradarse a sí mismo (o
  al único otro admin) por accidente, dejando a TODA la institución
  sin nadie que pueda invitar gente, crear servicios, o devolverle el
  rol a alguien, sin poder recuperarse desde la aplicación misma. Este
  chequeo bloquea también las filas de los administradores mientras
  dura la operación, para que dos administradores degradándose
  mutuamente en el mismo instante no puedan pasar los dos el candado a
  la vez — verificado con dos sesiones de base de datos reales
  entrelazadas a propósito, no solo probado uno a la vez.
- **La institución nunca puede quedar sin ninguna organización**:
  eliminar la única organización que queda se rechaza, por la misma
  razón que con el último administrador — sin este candado, alguien
  podía quedarse sin ningún lugar donde operar. Tiene el mismo
  candado de concurrencia que la protección de administradores
  (bloquea las filas de organizaciones mientras dura la operación),
  agregado después de encontrar y reproducir el mismo hueco de carrera
  que ya se había corregido ahí: dos eliminaciones concurrentes de las
  dos únicas organizaciones existentes lograban borrar las dos antes
  de esta corrección, dejando la institución sin ninguna — verificado
  igual, con dos sesiones de base de datos reales entrelazadas a
  propósito.
- **Respuestas honestas sobre el resultado real de una operación**:
  toda ruta que elimina o actualiza un registro por su identificador
  confirma cuántas filas afectó antes de responder — si la seguridad a
  nivel de fila rechazó la operación (el identificador no existe, o
  pertenece a algo fuera del alcance de quien la pidió), la respuesta
  es un error claro, nunca un `{"ok": true}` que sugiera un cambio que
  en realidad no ocurrió.
- Lo mismo aplica a las operaciones que **crean** un registro y dependen
  de la seguridad a nivel de fila para rechazar un intento inválido
  (agregar una categoría a un servicio ajeno, enviar un archivo a
  alguien fuera de la organización): el rechazo de PostgreSQL se
  traduce a un mensaje claro para quien lo pidió, no a un error de
  servidor genérico. Encontrado en una auditoría externa, revisando
  los registros de error reales del servidor.

## Validación de datos de entrada

Toda solicitud se valida en el servidor antes de tocar la base de
datos, sin depender de la validación de la interfaz, que puede omitirse
llamando la API directamente.

- Formato de correo, longitud mínima de contraseña, longitud máxima de
  campos de texto libre.
- Los precios del catálogo de procedimientos se validan como números
  finitos, no negativos, y dentro del rango admitido por la columna
  correspondiente en la base de datos — reforzado además con
  restricciones (`check`) a nivel de columna, como segunda capa
  independiente de la validación del servidor.
- Las imágenes (foto de perfil, logotipo de organización) deben ser
  archivos de imagen válidos y no exceder aproximadamente 1.5 MB.
- Los roles de usuario se validan contra una lista fija de valores
  admitidos, reforzada también con una restricción en la base de datos.
- El estado de un folio se valida contra los únicos dos valores
  admitidos (pagado, crédito).

## Integridad de folios y montos

Un folio es un registro financiero — estos controles existen
específicamente para que ninguno de sus datos centrales dependa de lo
que decida mandar quien hace la petición HTTP, ni siquiera una cuenta
autenticada y con permiso legítimo para generar folios.

- **El total de un folio lo calcula el servidor, no el navegador**: el
  cliente manda únicamente los IDs de los procedimientos elegidos; el
  servidor lee el nombre y el precio de cada uno directamente del
  catálogo, en ese momento, y calcula el total él mismo. Antes, el
  navegador calculaba el total (y el detalle de cada procedimiento) y
  el servidor lo guardaba tal cual — una cuenta autenticada podía
  modificar la petición HTTP a mano y registrar un total distinto al
  que en realidad corresponde a lo elegido. Verificado enviando un
  total y un costo por procedimiento deliberadamente falsos junto con
  IDs reales: el folio se guarda con el total correcto del catálogo,
  ignorando por completo lo que mandó el cliente.
- Un id de procedimiento que no existe, o que pertenece a un servicio
  distinto al del folio, se rechaza — no se guarda un folio con
  procedimientos a medias.
- **El folio en sí lo asigna el servidor, de forma atómica**: antes se
  generaba en el navegador con una parte aleatoria de 4 dígitos, sin
  ninguna garantía real de no repetirse, y la columna no tenía una
  restricción de unicidad — dos folios podían coincidir con más
  frecuencia de la esperada bajo uso real (varias personas cobrando al
  mismo tiempo). Ahora un contador atómico por servicio y día
  (`INSERT ... ON CONFLICT ... DO UPDATE`, sin necesitar un bloqueo
  aparte) asigna un número consecutivo que nunca se repite, reforzado
  con una restricción `UNIQUE` en la base de datos como respaldo.
  Verificado disparando varias creaciones de folio en paralelo de
  verdad (no en secuencia) contra el mismo servicio: nunca se repite
  un folio.
- El registro de un pago identifica el folio por su identificador único
  interno (UUID), no por el texto del folio — así, aunque alguna vez
  volviera a existir un folio repetido, el pago nunca podría aplicarse
  a más de un ticket a la vez.
- La fecha de un folio siempre es la del reloj del servidor al
  momento de crearlo, nunca la que reporte el navegador de quien lo
  generó.
- **Pagar un folio en crédito es una transición de un solo sentido**:
  `POST /tickets/:id/pago` solo tiene efecto sobre un folio que
  todavía está en `credito` (`... where id = $2 and estado = 'credito'`
  en la base de datos, no solo en la ruta) — un segundo intento sobre
  un folio que ya quedó pagado responde 404 en vez de sobrescribir en
  silencio la forma de pago que ya se había registrado. Ese mismo pago
  guarda además el momento real en que se cobró (`fecha_pago`),
  separado de la fecha en que se generó el folio (`fecha`) — un
  crédito emitido un día y cobrado varios días después ya no pierde el
  momento real del cobro. **El cierre de caja y TODOS los reportes de
  ingresos (mensual, por servicio, comparativo, y el desglose por
  procedimiento del panel de finanzas) agrupan por ese momento real de
  cobro** (`fecha_pago`, o `fecha` en un folio que nació ya "pagado",
  donde las dos coinciden) — todos ya filtran a folios pagados, es
  decir, ya eligieron el criterio de caja; antes agrupaban ese mismo
  filtro por `fecha` de emisión, así que un crédito de un mes cobrado
  el siguiente se sumaba, para siempre, al corte y al reporte del mes
  en que solo se había emitido. El desglose por procedimiento fue el
  último en corregirse — vivía en un archivo aparte del resto de los
  reportes financieros, con su propia lectura directa de los folios en
  vez de pasar por la misma API ya corregida, así que quedó
  inconsistente con el resto un round más de lo debido; ahora usa el
  mismo criterio en un solo lugar. Un reporte de ingreso DEVENGADO de
  verdad (que cuente también lo facturado y todavía sin cobrar) sería
  un reporte nuevo y distinto — eso sí queda pendiente de que la
  institución lo pida, no algo que este cambio deba decidir por su
  cuenta.
- **La forma de pago se valida contra una lista cerrada**, tanto al
  generar un folio como al pagarlo — antes se aceptaba cualquier texto
  no vacío, y un valor que no coincidiera exactamente con las tres
  formas reales (`Efectivo`, `Tarjeta de débito`, `Tarjeta de crédito`)
  sumaba al total del corte de caja sin aparecer en ningún desglose por
  forma de pago. El cierre de caja además agrupa aparte, en un bucket
  "Otro", cualquier folio cuya forma de pago no calce con ninguna de
  las tres — por si algún dato anterior a este control llegara a
  quedar así — para que el total del día nunca pueda dejar de cuadrar
  con la suma de su propio desglose.
- **Saldar varios folios de una cuenta a la vez es una sola
  transacción real** (`POST /tickets/pago-lote`, hasta 200 folios por
  llamada) — antes, saldar un grupo mandaba un pago por folio, uno
  tras otro: si el tercero de cinco fallaba, los dos primeros ya habían
  quedado pagados sin nada que lo deshiciera. Ahora, si UN folio del
  grupo ya no está disponible para pagar (alguien más ya lo pagó
  mientras tanto, o ya no existe), NINGUNO del grupo se aplica — la
  transacción completa se revierte, no solo ese folio.
- **Crear un folio admite una clave de idempotencia opcional**: el
  navegador genera una sola vez por intento de guardar y la
  reenvía tal cual si reintenta después de perder la respuesta original
  (por ejemplo, una caída de red justo después de que el servidor ya
  hubiera guardado el folio) — el servidor, con un índice único parcial
  `(service_id, clave_idempotencia)` en la base de datos, reconoce ese
  reintento y regresa el folio que ya existe en vez de crear uno
  duplicado con el mismo cobro contado dos veces. Reusar la misma clave
  con datos distintos (no un reintento del mismo folio) se rechaza con
  409. Antes, la unicidad del folio en sí nunca evitaba esto: cada
  petición válida creaba una fila nueva, con folio distinto, sin
  importar si en realidad era el mismo intento repetido.
  - La comparación de "mismo contenido" se hace contra una foto
    inmutable de la petición ORIGINAL (`idempotencia_payload`), nunca
    contra `estado`/`forma_pago` en vivo del folio — esas columnas
    cambian con un pago normal, sin relación con si la petición de
    CREACIÓN se reintentó; comparar contra el valor en vivo rechazaba
    como "clave reusada con otro contenido" un reintento genuino del
    mismo intento, solo porque el folio ya se había pagado mientras
    tanto.
  - Cuando dos peticiones con la misma clave pero contenido distinto
    chocan de verdad contra el índice único (no solo en secuencia), la
    que pierde la inserción también se compara contra esa misma foto
    antes de responder — nunca recibe, como si fuera su propio éxito,
    el folio que en realidad corresponde a la otra petición.
  - El navegador guarda el intento (clave, contenido y quién lo inició)
    justo antes de mandarlo, bajo su PROPIA clave de idempotencia — no
    una sola global compartida — y lo reintenta solo al volver a cargar
    la página de generar folios. Perder la respuesta Y cerrar o
    recargar la página antes de que llegara ya no obliga a generar una
    clave nueva (y, con ella, un folio genuinamente duplicado) para
    reintentar a mano; abrir de nuevo la confirmación reusa la misma
    clave mientras siga sin resolverse, en vez de generar otra para el
    mismo intento. Guardar cada intento bajo su propia clave, en vez de
    una sola global, también evita que la respuesta de UN intento
    borre o sobrescriba el de otro que siga pendiente al mismo tiempo.
  - **Un intento pendiente nunca se reenvía bajo una sesión distinta a
    la que lo dejó a medias**: el intento guardado incluye a quién
    pertenece, y la recuperación al recargar solo lo reintenta si la
    cuenta con sesión abierta en ese momento es la misma — si alguien
    cierra sesión con un cobro sin confirmar y otra persona inicia
    sesión en la misma pestaña después, ese intento se queda intacto
    (ni se reenvía, ni se borra) hasta que su dueño real vuelva a esa
    pestaña, en vez de terminar atribuido a quien inició sesión
    después. Solo un rechazo DEFINITIVO del servidor (4xx: la petición
    en sí estaba mal, repetirla igual no cambiaría esa respuesta) borra
    el intento guardado. Un fallo de red (sin respuesta alguna) o un
    5xx (500/502/503/504 — pudo venir de un proxy o balanceador que
    cortó la respuesta después de que el servidor ya hubiera guardado
    el folio) se tratan igual: el resultado real sigue siendo
    desconocido, así que el intento se conserva para reintentarlo
    después en vez de descartarse con una respuesta que nunca demostró
    nada.
  - **El contenido de un intento pendiente es inmutable mientras su
    resultado siga sin resolverse**: si se cancela la confirmación y se
    vuelve a abrir con el formulario editado, eso ya no cuenta como el
    mismo intento — se genera una clave nueva para el contenido nuevo,
    dejando la clave e intento anteriores intactos en `sessionStorage`
    (para su propia reconciliación, si hiciera falta) en vez de
    sobrescribirlos con datos distintos bajo la misma clave. Sin esto,
    si el intento original SÍ se había guardado del lado del servidor,
    reenviar contenido editado con la misma clave se topaba con un 409
    por la comparación de contenido (ver más arriba) — y el frontend,
    al ver un rechazo, borraba el intento guardado, perdiendo la única
    referencia que hubiera servido para reconciliar el folio original.

## Protección de contenido generado por usuarios

- **XSS**: la interfaz está construida en React, que escapa
  automáticamente todo el texto que se muestra en pantalla. No existe
  ningún punto de la aplicación que inserte HTML sin procesar a partir
  de datos de usuario.
- **Inyección de fórmulas en archivos CSV**: un valor que comience con
  `=`, `+`, `-` o `@` se interpreta como fórmula al abrirse en hojas de
  cálculo, no como texto — se neutraliza anteponiendo un carácter que
  impide esa interpretación, sin alterar el contenido visible. Aplica de
  forma uniforme a las tres pantallas que exportan CSV.
- **Correo electrónico**: cualquier dato de usuario incorporado al
  cuerpo HTML de un correo (nombre, nombre de servicio) se escapa antes
  de insertarse, evitando que un nombre de cuenta pueda contener
  enlaces o etiquetas HTML que lleguen como contenido real a otra
  persona.

## Seguridad de red y transporte

- El servidor no se publica a internet por sí mismo — corre en la red
  de la institución hasta que su equipo de sistemas decida y configure
  su exposición externa, con su propio dominio, certificado HTTPS y
  reglas de firewall.
- CORS restringido al origen exacto configurado para el frontend.
- Cabeceras de seguridad estándar (`helmet`): protección contra
  clickjacking, detección incorrecta de tipo de contenido, entre otras.
- Todas las consultas a la base de datos usan parámetros — no existe
  concatenación de texto de usuario dentro de sentencias SQL, ni
  siquiera en las consultas que arman dinámicamente qué columnas
  actualizar (la lista de columnas proviene siempre de una lista fija en
  el código; el valor del usuario viaja siempre como parámetro aparte).
- Los tokens de sesión se verifican contra falsificación: un token sin
  firma o firmado con una clave distinta a la del servidor se rechaza.
  La verificación fija explícitamente el algoritmo (HS256) — no deja
  que el propio token diga con qué algoritmo debe verificarse.
- **Llaves distintas para cada tipo de token**, derivadas de un único
  `JWT_SECRET` configurado (sin pedirle a quien despliega esto que
  gestione tres secretos en vez de uno): la cookie de sesión, los
  tokens de un solo propósito (confirmar correo, restablecer
  contraseña) y el `state` de OAuth con Microsoft se firman cada uno
  con su propia llave derivada. Un token firmado para un dominio no
  verifica en ningún otro, así que un error de código que llegara a
  confundir un tipo de token con otro no bastaría por sí solo para que
  uno sirviera como el otro.
- **Límite de tasa en rutas autenticadas de escritura con cuerpos
  grandes**: enviar un archivo (hasta ~3MB por envío) tiene su propio
  límite por IP, aparte del resto de la API — sin esto, una cuenta
  cualquiera podía llenar el disco del servidor con el tiempo. Marcar
  un archivo como leído y consultar la bandeja de recibidos no
  comparten ese límite, al ser acciones frecuentes y sin ese riesgo.
- **Tres límites de tamaño de cuerpo, no uno solo para toda la API**:
  `POST /archivos` acepta hasta 5mb (los archivos viajan en base64);
  `PATCH /usuarios/:id` y `PATCH /organizaciones/:id` aceptan hasta
  2.5mb (la foto de perfil y el logotipo, que también viajan como
  imagen en base64); el resto de la API — folios, roles, categorías,
  login, todo lo que en realidad son unos cuantos campos de texto —
  acepta hasta 150kb. Cada comparación es por ruta y método exactos, no
  por prefijo, para no afectar por error otras rutas relacionadas.
- **El listado de archivos recibidos no transfiere el contenido
  completo**: la campana de notificaciones vuelve a pedir ese listado
  cada pocos segundos, y antes cada consulta traía también el archivo
  completo en base64 de todo lo recibido — cuanto más historial
  acumulara una cuenta, más pesada se ponía cada una de esas consultas
  repetidas, sin que nadie estuviera pidiendo descargar nada. Ahora ese
  listado trae solo metadata; el contenido se pide aparte, por su
  propio identificador, y solo en el momento en que alguien decide de
  verdad descargar un archivo — con la misma seguridad a nivel de fila
  de siempre (solo quien lo envió o lo recibió puede leerlo).
- **El nombre del servicio en un archivo enviado se lee del catálogo,
  no del cliente**: antes, quien enviaba un archivo podía mandar
  cualquier texto como "nombre del servicio" junto con el id real del
  servicio, sin que el servidor verificara que coincidieran — ahora,
  si se indica un servicio, su nombre siempre se resuelve contra el
  catálogo real en ese momento, y se exige además que ese servicio
  pertenezca a la organización indicada en el archivo (no solo que
  exista).
- **Identificadores validados antes de tocar la base de datos**: en
  `POST /archivos`, la organización, el destinatario y el servicio
  (cuando se indica) se validan como UUID con formato correcto antes de
  cualquier consulta — un identificador mal formado responde con un 400
  claro, en vez de depender de que PostgreSQL lo rechace con un error
  de sintaxis que llegaría como 500 genérico.
- Protección contra CSRF: ninguna ruta que modifica datos acepta el
  método GET con la cookie de sesión; combinado con `SameSite=Lax`, un
  sitio externo no puede ejecutar una acción a nombre de un usuario sin
  su conocimiento.
- **`TRUST_PROXY`**, desactivado por defecto: si el servidor opera
  detrás de un proxy o balanceador sin esta variable activa, el límite
  de intentos de inicio de sesión identifica a todas las solicitudes con
  la IP del proxy, perdiendo su efectividad. Activarla sin operar
  realmente detrás de un proxy es igualmente riesgoso — ver
  `LOCAL_SETUP.md`.

## Inicio de sesión con Microsoft (opcional)

El inicio de sesión con la cuenta institucional de Microsoft aplica las
mismas reglas que el registro estándar: sin invitación vigente para el
correo correspondiente, el acceso se rechaza — una cuenta válida del
tenant de Microsoft de la institución no constituye autorización por sí
sola. La aplicación registrada en Microsoft Entra ID se restringe a
cuentas del directorio organizativo de la institución, excluyendo
cuentas personales de Microsoft.

El intercambio con Microsoft utiliza el flujo estándar OAuth 2.0. El
parámetro `state` va firmado, con vencimiento corto, y **además ligado
al navegador que inició el flujo**: un valor aleatorio se guarda en una
cookie httpOnly de vida corta al iniciar sesión con Microsoft, se repite
dentro del `state` firmado, y se exige que ambos coincidan al volver —
sin ese amarre, la sola firma no demuestra que quien completa el
callback es el mismo navegador que lo inició, dejando abierto un
escenario de "login CSRF" (alguien inicia sesión con su propia cuenta de
Microsoft y logra que el navegador de otra persona complete ese mismo
callback, dejándola con una sesión a nombre de quien inició el flujo).
Verificado con dos amarres deliberadamente distintos (cookie y state sin
coincidir) para confirmar el rechazo. La URL de redirección nunca
depende de datos proporcionados por quien realiza la solicitud.

**El inicio de sesión con Microsoft nunca se salta el 2FA local**: si la
cuenta ya tiene activada la autenticación de dos factores, entrar con
Microsoft no basta por sí solo — se exige el mismo código TOTP que
pediría el inicio de sesión con correo y contraseña, con el mismo token
de un solo propósito y de vida corta. Ese token viaja en el fragmento
de la URL de regreso (`#tokenPre=...`), no en un parámetro de consulta
normal — el navegador nunca manda el fragmento de una URL a ningún
servidor (ni siquiera como encabezado `Referer` a otro sitio), así que
no puede quedar registrado en un log de acceso, un proxy, o una
herramienta de analítica de terceros.

**Alcance del permiso de Microsoft Graph para enviar correo**: el
código de este proyecto solo manda correo desde el buzón indicado en
`MICROSOFT_CORREO_ENVIO`, pero el permiso de Microsoft Graph que esto
requiere (`Mail.Send`, de aplicación) técnicamente alcanza para
cualquier buzón del tenant, no solo ese — es Microsoft quien concede
ese alcance, no algo que este código pueda restringir por su cuenta.
Ver `LOCAL_SETUP.md`, sección 4, para la directiva de acceso de
aplicación (Application Access Policy) que el equipo de sistemas debe
configurar en Exchange Online para cerrar esa diferencia. Sin ese
paso, un `MICROSOFT_CLIENT_SECRET` filtrado tendría más alcance del
que el sistema necesita.

## Quick — el asistente de datos con IA (opcional)

Quick (el ícono junto a la campana) entiende preguntas en español
normal sobre los datos de la propia cuenta. **Funciona sin depender de
ningún servicio externo por default** — un conjunto amplio de patrones
fijos (fechas, nombres, "resumen de tal mes") vive enteramente en el
navegador, sin salir nunca de la instalación. Configurar
`GEMINI_API_KEY` (ver `LOCAL_SETUP.md`, sección 5) solo amplía qué
tantas formas de preguntar entiende, y habilita un chat libre — nunca
es la única forma de usar Quick, y su ausencia nunca rompe nada más.

- **El modelo nunca tiene acceso a la base de datos — nunca genera ni
  ejecuta una consulta**: en las dos rutas que solo clasifican o
  redactan (`interpretar`, `narrar`), Gemini nunca ve un folio ni un
  nombre real, solo un resumen ya agregado (totales, conteos,
  promedios, nombres de PROCEDIMIENTOS del catálogo). En el chat libre
  (`chat`), Gemini sí puede recibir folios individuales recientes con
  nombre real (`foliosDetalle`, hasta 300, ver más abajo) — pedido
  explícito, para que pueda contestar preguntas que necesitan el
  detalle ("quién no ha pagado"), no solo un total. En los tres casos,
  el resumen lo arma el propio navegador de antemano, con los datos
  que ya tenía cargados bajo las mismas políticas de seguridad por
  fila de siempre — el modelo solo (según la ruta) clasifica la
  pregunta en una forma fija y validada, redacta en prosa un número ya
  calculado, o responde en prosa a partir del resumen que se le dio;
  nunca decide por su cuenta qué datos pedir. Ver
  `servidor/api/src/asistente.ts` — el archivo entero está comentado
  línea por línea explicando este límite en cada punto donde alguien
  podría, sin querer, ampliarlo.
- **`foliosDetalle` nunca es MÁS de lo que la propia sesión ya podía
  ver en el resto de la app**: viene del mismo arreglo de tickets que
  el navegador ya cargó para el servicio actual, con el mismo acceso
  (seguridad por fila del servidor + `service_access`) que ya tiene
  esa sesión — un "personal" con acceso a un solo servicio jamás tiene
  folios de otro servicio en ese arreglo para empezar, así que Quick
  tampoco puede mostrárselos. No hay una capa de permisos nueva y
  distinta para Quick: hereda exactamente la misma que ya tiene toda
  la app, incluyendo la diferencia entre un administrador (ve todo su
  organización) y alguien con acceso acotado a un servicio. Capado
  además a los 300 folios más recientes por tamaño y costo — el
  histórico completo sigue disponible como agregados, no como filas
  individuales.
- **Toda respuesta del modelo se valida antes de usarse, nunca se
  confía en ella tal cual**: la clasificación de una pregunta debe
  calzar EXACTO contra una de nueve formas fijas (fechas con formato
  válido, una métrica de una lista cerrada, campos de más de cierto
  largo rechazados) — cualquier otra cosa se descarta como si el
  modelo no hubiera contestado nada. Lo mismo en la dirección
  contraria: el resumen que el navegador le manda al modelo para
  narrar o para el chat libre se valida contra una forma exacta y un
  tamaño máximo antes de mandarse, campo por campo — incluyendo cada
  fila de `foliosDetalle` (nombre, folio, fecha, categoría, total,
  solo "pagado"/"credito", solo una forma de pago de la lista
  cerrada) — un intento de colar algo con otra forma, o más de 300
  filas, simplemente no se manda.
- **Ningún dato sale de la instalación sin que la institución lo
  decida explícitamente**: sin `GEMINI_API_KEY`, la clave nunca se
  genera ni se pide — Quick sigue funcionando con sus patrones fijos, y
  nada sale jamás hacia ningún servicio externo. Con la clave puesta,
  cada pregunta y su resumen sí viajan hacia los servidores de Google
  (`generativelanguage.googleapis.com`) — y ese resumen, para el chat
  libre, puede incluir nombres reales y folios individuales (ver los
  dos puntos de arriba), no solo cifras agregadas. Esta es una
  decisión real de política de datos, no solo técnica — vale la pena
  confirmarla con quien decida esas políticas en la institución antes
  de activarla, no solo asumir que es una casilla técnica más. Ver la
  nota completa en `LOCAL_SETUP.md`, sección 5.
- **Límite de tasa aparte, compartido entre las tres rutas**
  (`/api/asistente/interpretar`, `/narrar`, `/chat`): 40 peticiones
  por 15 minutos por IP — cada llamada a Gemini tiene un costo real
  (aunque sea del nivel gratuito), a diferencia de la mayoría de las
  rutas de este sistema. El límite existe para que un error del propio
  frontend disparando peticiones de más, o alguien escribiendo muy
  rápido, no genere un gasto sin que nadie lo note a tiempo.
- **Nunca bloquea, nunca lanza un error visible**: si la IA no está
  configurada, si Gemini está caído, o si su respuesta no calza contra
  la forma esperada, las tres rutas responden `204` (sin contenido) y
  el navegador cae de vuelta a su propio flujo sin IA, sin que se note
  ningún error — un proveedor externo fallando nunca debe verse como
  si el sistema mismo estuviera roto.
- **Cobertura de pruebas honesta**: la suite automatizada (ver
  `test/asistente.test.ts`) corre sin `GEMINI_API_KEY` — cubre la
  validación de entrada de las tres rutas, que exigen sesión iniciada,
  el límite de tasa, que las tres caen a `204` de forma silenciosa
  para cualquier entrada cuando la IA no está configurada, y —
  llamando directo a `validarDigesto` (exportada solo para esto) — la
  validación completa del resumen del chat libre incluyendo
  `foliosDetalle`: acepta filas bien formadas, rechaza más de 300,
  rechaza un estado o una forma de pago fuera de la lista cerrada, y
  rechaza un campo faltante o del tipo equivocado. Lo que NINGUNA
  prueba automatizada de este proyecto cubre — porque depende de un
  proveedor externo real que este entorno no puede alcanzar — es que
  Gemini clasifique o redacte correctamente una pregunta real; eso
  solo se puede confirmar probándolo a mano, con una `GEMINI_API_KEY`
  real, después de instalar.

## Bitácora de auditoría e integridad de registros

- La bitácora de auditoría y los folios financieros no admiten edición
  ni eliminación por la API — constituyen un historial permanente.
- La identidad del autor en cada evento se deriva de la sesión
  autenticada (ver "Autorización y control de acceso").
- **Toda acción administrativa deja su evento en la bitácora de forma
  atómica, nunca como una segunda petición aparte**: cambiar un rol,
  restablecer una contraseña, cambiar la marca, crear o eliminar un
  servicio, invitar a alguien, agregar/quitar a alguien de una
  organización o de un servicio, y cambiar su nivel de acceso — las
  nueve insertan su evento dentro de la MISMA transacción SQL que el
  cambio real, así que no puede quedar uno sin el otro: ni el cambio
  aplicado sin rastro (por una falla de red antes de que el navegador
  alcanzara a mandar el evento por separado, que es como funcionaba
  antes), ni un evento describiendo un cambio que en realidad no
  ocurrió. Quitar a alguien de una organización, cuando también tenía
  un servicio de esa organización asignado, deja dos eventos (el de la
  organización y, en cascada, el del servicio) — es intencional: son
  dos cambios reales, no uno solo.
- **`POST /eventos` no acepta el texto exacto de ninguna de esas nueve
  acciones** — el actor de un evento siempre sale de la sesión, nunca
  se puede falsear, pero el texto de qué pasó sí lo manda quien llama a
  esta ruta; sin este candado, cualquier miembro autenticado de una
  organización podía insertar, con la misma etiqueta, un evento
  inventado que se mezclara con (o contradijera) el registro real y
  auténtico de una de esas acciones. La comparación normaliza espacios
  (al inicio, al final, o dobles en medio) y mayúsculas/minúsculas
  antes de comparar — la primera versión de este candado comparaba el
  texto crudo, así que un espacio de más ya bastaba para pasar
  desapercibido, con el mismo mensaje que a simple vista se ve
  idéntico. No cierra un homógrafo Unicode deliberado (una letra de
  otro alfabeto que se ve idéntica) — nadie audita la bitácora contra
  eso. Ninguna pantalla de la aplicación llama ya a esta ruta —todas
  las acciones reales generan su evento desde el servidor— así que su
  único uso posible hoy es una nota manual hecha llamando a la API
  directamente, que ya no puede hacerse pasar por ninguna acción real.
- **La bitácora y los archivos recibidos ya no se entregan completos
  de un solo jalón**: `GET /eventos` y `GET /archivos/recibidos` traen
  como máximo 100 registros por llamada (100 y 500 respectivamente
  como tope si se pide explícitamente más), ordenados del más reciente
  al más antiguo. La pantalla de bitácora pide más con un botón
  "Cargar más" que manda `antesDe` con la fecha del último evento ya
  mostrado — un cursor por fecha, no un número de página, así que un
  evento nuevo que se inserte mientras alguien va viendo páginas
  anteriores no hace que la siguiente página repita o se salte un
  registro (que es justo lo que le pasaría a una paginación por
  posición numérica si la lista cambia debajo). Antes, una
  organización con años de historial hacía que esa pantalla — y esa
  sola consulta a la base de datos — creciera sin límite para siempre.
  El grupo de conexiones a la base de datos también gana límites de
  tiempo explícitos (conexión, inactividad, y ejecución de una
  consulta individual, los tres configurables por variable de entorno)
  que antes no existían, para que una consulta o una conexión colgada
  no se quede ocupando un lugar del grupo indefinidamente.
- **Deliberadamente fuera de este cambio queda la paginación de
  `GET /tickets`**, la lista completa de folios: hoy varias pantallas
  (el cierre de caja por día y por mes, el panel financiero, y el
  agrupado de créditos) calculan sus totales en el navegador a partir
  de la lista completa que regresa esa ruta. Paginarla sin antes mover
  esos cálculos al servidor (con `GROUP BY` en SQL) haría que esas
  pantallas reportaran solo lo que cupiera en la página actual,
  silenciosamente — un reporte financiero incompleto que se ve
  completo es peor que no tener el cambio. Se deja pendiente para un
  cambio aparte que primero mueva esos cálculos al servidor.

## Respaldos y continuidad

- Respaldo completo de la base de datos (`npm run respaldar`, dentro de
  `servidor/api`) mediante un rol dedicado con permiso mínimo para leer
  toda la información sin que la seguridad a nivel de fila la filtre —
  un respaldo incompleto representa un riesgo mayor que la ausencia de
  respaldo. Verificado de punta a punta: generación, restauración en una
  base de datos nueva, y confirmación de integridad de datos y roles.
- Los mensajes de error del proceso de respaldo se filtran para eliminar
  cualquier credencial de conexión antes de escribirse en el registro o
  la consola, incluyendo los casos donde la contraseña contiene
  caracteres especiales.
- Registro de errores en disco (`servidor/api/logs/`), con retención de
  30 días, independiente de la consola.
- Verificación de estado (`GET /api/salud`) que confirma la conectividad
  real con la base de datos, no únicamente que el proceso sigue en
  ejecución.
- Configuración de reinicio automático mediante `pm2` ante un error no
  controlado.
- **Apagado ordenado ante `SIGTERM`/`SIGINT`**: al detener o reiniciar
  el proceso (un gestor de procesos, un contenedor, `Ctrl+C`), el
  servidor deja de aceptar conexiones nuevas pero espera a que las
  peticiones ya en curso terminen, y solo entonces cierra el pool de
  conexiones a PostgreSQL — con un límite de tiempo de seguridad para
  no quedarse esperando indefinidamente. Sin esto, un reinicio corta de
  tajo cualquier petición a medias.

Ver `LOCAL_SETUP.md`, secciones 6 y 7, para la configuración de
respaldos programados y monitoreo.

## Consideraciones según el entorno de despliegue

- **HTTPS**: el código no lo impone — corresponde al servidor web o
  balanceador que lo sirva. Al operar detrás de HTTPS real, agregar
  `COOKIE_SECURE=true` en `servidor/api/.env`, de forma que la cookie de
  sesión viaje siempre cifrada.
- **Rotación de `JWT_SECRET`**: ante la sospecha de que se haya
  filtrado, cambiar este valor invalida todas las sesiones activas de
  forma inmediata — **y también todos los secretos TOTP ya cifrados**
  (ver "Autenticación"), ya que la llave de cifrado se deriva del mismo
  valor. Después de rotar, cualquier cuenta con 2FA activo necesita
  desactivarlo y volver a activarlo para poder iniciar sesión de nuevo
  con su app autenticadora.
- **Cifrado en reposo**: las contraseñas están siempre hasheadas; el
  cifrado del disco donde reside la base de datos (BitLocker, FileVault,
  o el mecanismo que ya utilice el servidor de la institución) es una
  decisión de infraestructura, consistente con las políticas ya
  vigentes para los demás sistemas de la institución.
- **Aislamiento de red — qué tan lejos llega un problema si lo hay**:
  este servidor no necesita alcanzar ningún otro sistema de la
  institución para funcionar — sus únicas conexiones salientes
  posibles son hacia los dominios de Microsoft
  (`login.microsoftonline.com`, `graph.microsoft.com`), solo si el
  inicio de sesión institucional o el envío de correo están
  configurados, y hacia `generativelanguage.googleapis.com` (Google
  Gemini), solo si Quick tiene una `GEMINI_API_KEY` puesta (ver
  "Quick — el asistente de datos con IA", más abajo). De ahí en fuera,
  solo habla con su propia base de datos. Se recomienda desplegarlo en
  un segmento de red que NO tenga alcance directo a otros sistemas
  sensibles de la institución (expedientes, nómina, otras bases de
  datos) — así, aunque este servidor específico llegara a
  comprometerse, no sirve por sí solo como punto de partida hacia el
  resto de la red. Esta es una decisión de la topología de red de la
  institución, no algo que el código de la aplicación pueda garantizar
  por sí mismo.
- **La base de datos debe ser exclusiva de este sistema**: si se aloja
  en un servidor de PostgreSQL que la institución ya usa para otras
  bases de datos, `servidor/scripts/verificar-aislamiento-bd.sh`
  confirma que los roles `finaquick_app` y `finaquick_respaldo`
  (creados en `esquema_local.sql`) no tengan más privilegios de los
  necesarios, y señala cualquier otra base de datos del mismo servidor
  con conexión abierta por default — el comportamiento estándar de
  PostgreSQL, salvo que se revoque explícitamente, es dejar que
  cualquier rol se conecte a cualquier base de datos del mismo
  servidor (no leer sus datos, solo conectarse). Ver `LOCAL_SETUP.md`,
  sección 11.

## Metodología

Cada control descrito en este documento fue verificado con pruebas
funcionales contra un servidor y una base de datos en ejecución —
creación de cuentas, generación de folios, e intentos deliberados de
evadir cada restricción con cuentas sin privilegios— y no únicamente
mediante revisión estática del código.

## Alcance y limitaciones

Para que este documento sea útil como base de una decisión, y no solo
como lista de lo que ya se hizo bien:

- Todo lo descrito aquí fue encontrado, probado y corregido por quien
  construyó el sistema. No sustituye una auditoría de seguridad
  independiente por un tercero, especialmente antes de manejar datos
  institucionales reales en producción.
- Las pruebas de carga (ver [`PRUEBA_DE_CARGA.md`](PRUEBA_DE_CARGA.md))
  se corrieron en hardware de desarrollo, no en el servidor final de la
  institución.
- Las pruebas de interfaz se hicieron en un solo navegador — no hay
  verificación cruzada contra distintos motores de renderizado.
- Esto documenta los controles implementados y cómo se verificaron, no
  una certificación ni una garantía de ausencia total de
  vulnerabilidades.
