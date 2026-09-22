-- Esquema para el servidor propio (servidor/api) — PostgreSQL puro, sin
-- ningún esquema ni extensión de terceros. La cuenta y la contraseña
-- viven en la propia tabla profiles, y la seguridad por fila usa una
-- variable de sesión que pone el servidor (app.usuario_actual).
--
-- Correr una sola vez, en una base de datos PostgreSQL vacía:
--   psql "$DATABASE_URL" -f servidor/esquema_local.sql

create extension if not exists pgcrypto;

-- ============================================================
-- Helpers de seguridad por fila — leen la variable de sesión que pone
-- el servidor en cada consulta (ver servidor/api/src/db.ts,
-- conSesionDe()), no un JWT de terceros.
--
-- SECURITY DEFINER en todos, a propósito: corren con los privilegios
-- de quien los creó (dueño del esquema), no con los del rol de la
-- aplicación (finaquick_app, con RLS forzado). Sin esto, es_admin()
-- consultando profiles dispara la política de SELECT de profiles, que
-- a su vez llama a es_admin() otra vez — recursión infinita
-- ("stack depth limit exceeded"). Con SECURITY DEFINER, esa consulta
-- interna corre fuera de RLS y no se vuelve a disparar la política.
-- ============================================================
create or replace function usuario_actual()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select nullif(current_setting('app.usuario_actual', true), '')::uuid;
$$;

create or replace function es_admin()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return coalesce((select rol = 'admin' from profiles where id = usuario_actual()), false);
end;
$$;

create or replace function pertenece_a_org(org uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return es_admin() or exists (
    select 1 from org_members where org_id = org and user_id = usuario_actual()
  );
end;
$$;

create or replace function puede_acceder_servicio(servicio uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- Antes esto solo revisaba service_access — si un admin quitaba a
  -- alguien de una organización pero no le quitaba, por separado, cada
  -- servicio suyo que tuviera asignado (dos pasos independientes en la
  -- ruta PUT /usuarios/:id), la fila de service_access sobrevivía y la
  -- persona conservaba acceso directo a los tickets de un servicio de
  -- una organización de la que ya no es miembro — con solo conocer el
  -- UUID del servicio, sin que el menú se lo mostrara. Exigir también
  -- la membresía vigente a la organización dueña del servicio cierra
  -- eso aquí, en la política misma, sin depender de que cada ruta que
  -- pueda tocar org_members recuerde limpiar service_access también.
  return es_admin() or exists (
    select 1
    from service_access sa
    join services s on s.id = sa.service_id
    join org_members om on om.org_id = s.org_id and om.user_id = sa.user_id
    where sa.service_id = servicio and sa.user_id = usuario_actual()
  );
end;
$$;

create or replace function org_de_servicio(servicio uuid)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return (select org_id from services where id = servicio);
end;
$$;

-- Comparte al menos una organización con el usuario que llama. Vive
-- aquí (plpgsql, resolución diferida) y no inline en la política de
-- profiles de abajo, porque profiles se crea antes que org_members en
-- este archivo — una política resuelve su expresión SQL de una vez al
-- crearse, así que necesitaría que org_members ya existiera arriba.
-- Una función plpgsql no.
create or replace function comparte_org_con(otro uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from org_members mio
    join org_members suyo on suyo.org_id = mio.org_id
    where mio.user_id = usuario_actual() and suyo.user_id = otro
  );
end;
$$;

-- ============================================================
-- Organizaciones
-- ============================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  color_primario text not null default '#3a3a3a',
  logo_url text,
  created_at timestamptz not null default now()
);
alter table organizations enable row level security;
create policy "ver organizaciones a las que perteneces" on organizations
  for select using (pertenece_a_org(id));
create policy "admin actualiza su organización" on organizations
  for update using (es_admin() and pertenece_a_org(id));

-- ============================================================
-- Perfiles — aquí SÍ vive la cuenta completa (correo + contraseña),
-- sin ningún sistema de autenticación aparte que la maneje.
-- ============================================================
create table profiles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null unique,
  password_hash text not null,
  telefono text,
  foto_url text,
  -- Firma dibujada una sola vez desde Mi perfil (dataURL de un canvas,
  -- mismo formato y mismo límite de tamaño que foto_url) — al aprobar
  -- o rechazar una requisición, quien lo hace puede estampar ESTA
  -- firma con un clic (ver requisiciones.firma_resolucion más abajo)
  -- en vez de tener que dibujarla cada vez.
  firma_url text,
  bio text,
  rol text not null default 'personal' check (rol in ('admin', 'finanzas', 'personal')),
  creado_en timestamptz not null default now(),
  -- Bloqueo por intentos fallidos — aparte del límite por IP (que ya
  -- existe en el servidor): ese solo frena a alguien intentando desde
  -- una sola dirección; esto frena intentos contra UNA cuenta en
  -- concreto, sin importar desde cuántas IPs distintas vengan.
  intentos_fallidos integer not null default 0,
  bloqueado_hasta timestamptz,
  -- No bloquea nada por sí solo (ver confirmar_correo más abajo) — es
  -- solo informativo, para cuando el envío de correo esté configurado
  -- (opcional, vía la cuenta institucional de Microsoft).
  correo_confirmado boolean not null default false,
  -- Autenticación de dos factores (TOTP, compatible con cualquier app
  -- autenticadora — Google Authenticator, Authy, etc. — sin depender de
  -- ningún servicio externo: el código se genera y se verifica todo
  -- localmente). totp_secret se guarda cifrado (AES-256-GCM, ver
  -- cifrarTotp()/descifrarTotp() en servidor/api/src/auth.ts) — a
  -- diferencia de una contraseña, este valor necesita poder recuperarse
  -- para verificar el código en cada login, no solo compararse como
  -- hash, así que un cifrado reversible es la única opción real; texto
  -- plano expondría los secretos de toda cuenta con 2FA activo ante una
  -- fuga de la base de datos o de un respaldo. Protegido además por las
  -- mismas reglas de fila de esta tabla, nunca expuesto en ninguna
  -- respuesta de la API. totp_habilitado separado del secreto: se
  -- genera el secreto primero y se confirma con un código real antes de
  -- activarlo, para no dejar a alguien bloqueado de su propia cuenta
  -- por un QR mal escaneado.
  totp_secret text,
  -- Un secreto nuevo (generado al activar 2FA por primera vez, o al
  -- reemplazar uno ya activo) se guarda AQUÍ primero, no directamente
  -- en totp_secret — hasta que se confirme con un código real, el
  -- secreto que de verdad se usa para verificar el login sigue siendo
  -- el anterior. Sin este campo aparte, una sesión con acceso momentáneo
  -- a la cuenta (un equipo compartido, una sesión robada) podía llamar
  -- a iniciar-2FA y reemplazar el secreto activo de inmediato, sin
  -- confirmar nada: el dueño real se quedaba con su app autenticadora
  -- mostrando códigos que ya no servían, sin haber tocado nada él mismo.
  totp_secret_pendiente text,
  totp_habilitado boolean not null default false,
  -- Se actualiza cada vez que la contraseña cambia (uno mismo, un
  -- administrador restableciéndola, o un enlace de "olvidé mi
  -- contraseña") — servidor/api/src/auth.ts (requerirSesion) rechaza
  -- cualquier sesión (JWT) emitida ANTES de este momento. Sin esto,
  -- cambiar la contraseña no le cerraba la puerta a una sesión ya
  -- copiada (una laptop robada con la sesión abierta, por ejemplo):
  -- el token seguía siendo válido hasta sus 30 días de vencimiento,
  -- sin importar que la contraseña ya fuera otra.
  sesion_valida_desde timestamptz not null default now(),
  -- true cuando un administrador acaba de generarle una contraseña
  -- temporal a esta cuenta (ver restablecer_password() más abajo). El
  -- servidor lo hace cumplir de verdad, no solo lo documenta: mientras
  -- esté en true, requerirSesion() (servidor/api/src/auth.ts) rechaza
  -- cualquier ruta que no sea cambiar la contraseña o cerrar sesión.
  -- Vuelve a false en cuanto la contraseña cambia, por cualquier vía.
  debe_cambiar_password boolean not null default false
);
alter table profiles enable row level security;
create policy "perfiles visibles dentro de tu organización" on profiles
  for select using (
    id = usuario_actual()
    or es_admin()
    or comparte_org_con(id)
  );
create policy "cada quien edita su propio perfil" on profiles
  for update using (id = usuario_actual() or es_admin());

-- ============================================================
-- Membresía de organizaciones
-- ============================================================
create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (org_id, user_id)
);
alter table org_members enable row level security;
create policy "ver membresías de tus organizaciones" on org_members
  for select using (pertenece_a_org(org_id) or user_id = usuario_actual());
create policy "admin agrega o quita miembros" on org_members
  for all using (es_admin() and pertenece_a_org(org_id));

-- ============================================================
-- Servicios
-- ============================================================
create table services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  nombre text not null,
  icono text not null default 'building',
  campo_persona_label text not null default 'Nombre del cliente',
  campo_id_label text not null default 'ID',
  campo_categoria_label text not null default 'Categoría',
  cierre_caja_label text not null default 'Cierre de caja',
  features jsonb not null default '{"creditos":true,"cierreCaja":true,"requisiciones":true,"requiereId":true,"esDerechoClinica":false}'::jsonb,
  activo boolean not null default true
);
alter table services enable row level security;
create policy "ver servicios de tu organización" on services
  for select using (pertenece_a_org(org_id));
create policy "admin administra servicios de su organización" on services
  for all using (pertenece_a_org(org_id) and es_admin());

-- ============================================================
-- Acceso a servicios (asignación + nivel de consulta)
-- ============================================================
create table service_access (
  service_id uuid not null references services(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  solo_consulta boolean not null default false,
  primary key (service_id, user_id)
);
alter table service_access enable row level security;
create policy "ver tus propios accesos o los de tu organización si eres admin" on service_access
  for select using (user_id = usuario_actual() or pertenece_a_org(org_de_servicio(service_id)));
create policy "admin asigna servicios" on service_access
  for all using (pertenece_a_org(org_de_servicio(service_id)) and es_admin());

-- ============================================================
-- Catálogo: categorías y procedimientos
-- ============================================================
create table categorias (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  nombre text not null
);
alter table categorias enable row level security;
create policy "ver categorías de servicios de tu organización" on categorias
  for select using (pertenece_a_org(org_de_servicio(service_id)));
create policy "admin administra categorías" on categorias
  for all using (pertenece_a_org(org_de_servicio(service_id)) and es_admin());

create table procedimientos (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  nombre text not null,
  precio numeric(10, 2) not null check (precio >= 0)
);
alter table procedimientos enable row level security;
create policy "ver procedimientos de servicios de tu organización" on procedimientos
  for select using (pertenece_a_org(org_de_servicio(service_id)));
create policy "admin administra procedimientos" on procedimientos
  for all using (pertenece_a_org(org_de_servicio(service_id)) and es_admin());

-- ============================================================
-- Contadores atómicos — para asignar números de folio y de proyecto
-- sin condición de carrera cuando dos personas los generan casi al
-- mismo instante (por ejemplo, dos personas en recepción cobrando al
-- mismo tiempo). Antes, el número se calculaba con count(*) + 1 en el
-- servidor, y el folio en sí se generaba en el navegador con una parte
-- aleatoria (Math.random()) sin garantía real de ser único — dos
-- peticiones concurrentes podían terminar con el mismo número, y como
-- "folio" no tenía una restricción UNIQUE, un pago después podía
-- aplicarse al ticket equivocado.
-- Sin RLS a propósito: es estado interno del servidor, nunca se
-- expone tal cual a la API.
-- ============================================================
create table contadores (
  clave text primary key,
  siguiente integer not null default 0
);

-- Un solo INSERT ... ON CONFLICT ... DO UPDATE es atómico en
-- PostgreSQL sin necesitar un SELECT ... FOR UPDATE aparte: dos
-- llamadas concurrentes con la misma clave quedan serializadas por el
-- propio motor y cada una recibe un número distinto y consecutivo.
create or replace function siguiente_contador(p_clave text)
returns integer
language sql
as $$
  insert into contadores (clave, siguiente) values (p_clave, 1)
  on conflict (clave) do update set siguiente = contadores.siguiente + 1
  returning siguiente;
$$;

-- ============================================================
-- Folios
-- ============================================================
create table tickets (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  folio text not null,
  nombre text not null,
  identificador text,
  tipo_usuario text not null,
  categoria text not null,
  procedimientos jsonb not null default '[]'::jsonb,
  total numeric(10, 2) not null check (total >= 0),
  estado text not null check (estado in ('pagado', 'credito')),
  forma_pago text,
  creado_por uuid references profiles(id),
  fecha timestamptz not null default now(),
  -- Momento real en que se registró el pago (POST /tickets/:id/pago),
  -- no la fecha de creación del folio — un crédito emitido un día y
  -- pagado varios días después antes no dejaba ningún rastro de
  -- cuándo se cobró de verdad, solo de cuándo se generó. null en
  -- folios que siguen en crédito, o que se marcaron "pagado" desde su
  -- creación (ahí fecha_pago = fecha, no hace falta guardarlo aparte).
  -- El cierre de caja y los tres reportes de ingresos (mensual, por
  -- servicio, comparativo) ya filtran a estado = 'pagado' — es decir,
  -- ya eligieron el criterio de caja (cuánto se ha cobrado), así que
  -- ahora agrupan por este campo (coalesce con "fecha") en vez de por
  -- "fecha" a secas: antes mezclaban el filtro de caja con la fecha de
  -- emisión, así que un crédito de agosto cobrado en septiembre se
  -- sumaba al corte y al reporte de agosto para siempre. Un reporte de
  -- ingreso DEVENGADO real (que cuente también lo facturado y todavía
  -- no cobrado) sería un reporte nuevo y distinto, no una variación de
  -- estos — eso sí queda pendiente de que la institución lo pida.
  fecha_pago timestamptz,
  -- Clave que el navegador genera una sola vez por intento de crear un
  -- folio (un UUID, ver NewTicket.tsx) y reenvía tal cual si reintenta
  -- después de perder la respuesta original (caída de red, recarga
  -- accidental) — sin esto, el servidor ya generaba folios consecutivos
  -- sin condición de carrera, pero cada petición válida igual creaba
  -- una fila nueva: la unicidad del folio nunca evitó duplicar el
  -- folio/cobro comercial en sí. null en folios creados antes de este
  -- cambio, y en cualquier otro punto que inserte tickets sin pasar por
  -- esta clave (los datos de ejemplo, la prueba de carga).
  clave_idempotencia text,
  -- Foto de los campos de la petición ORIGINAL que creó este folio con
  -- esta clave — nombre, identificador (cuando no es "Externo", que lo
  -- asigna el servidor), tipoUsuario, categoria, procedimientoIds
  -- (ordenados) y la forma de pago con la que se creó. Un reintento se
  -- compara contra ESTA foto, nunca contra "estado"/"forma_pago" en
  -- vivo del folio: ese folio pudo haberse pagado después con POST
  -- /tickets/:id/pago, un evento normal y sin relación con si la
  -- petición de CREACIÓN se reintentó — comparar contra el estado
  -- actual habría rechazado como "clave reusada con otro contenido" un
  -- reintento genuino del mismo intento original, solo porque el folio
  -- ya no seguía en crédito para cuando llegó el reintento. null
  -- cuando no se mandó clave_idempotencia.
  idempotencia_payload jsonb,
  -- El folio ahora lo asigna el servidor con siguiente_contador() (ver
  -- arriba), pero esta restricción es el respaldo definitivo: aunque
  -- algún día un bug volviera a permitir un folio repetido, la base de
  -- datos misma se niega a guardarlo, en vez de dejar que un UPDATE
  -- por folio (ver la ruta de pago) le pegue a más de un ticket a la
  -- vez.
  unique (service_id, folio)
);
-- Dos peticiones con la MISMA clave para el MISMO servicio nunca deben
-- terminar en dos folios distintos — este índice es lo que de verdad
-- lo garantiza (incluso ante dos peticiones concurrentes reales, no
-- solo secuenciales); la ruta que la usa (POST /tickets) solo decide
-- QUÉ responder cuando choca, no si choca.
create unique index tickets_service_id_clave_idempotencia_key
  on tickets (service_id, clave_idempotencia) where clave_idempotencia is not null;
alter table tickets enable row level security;
create policy "ver folios de servicios a los que tienes acceso" on tickets
  for select using (puede_acceder_servicio(service_id));
-- creado_por = usuario_actual() además del acceso al servicio: la API
-- (rutas.ts, POST /tickets) ya deriva el creador de la sesión y nunca
-- de lo que mande el cliente, pero esto lo exige también aquí, en la
-- base de datos — mismo criterio de defensa en profundidad que arriba.
create policy "generar folios con acceso completo, como uno mismo" on tickets
  for insert with check (
    creado_por = usuario_actual()
    and (
      es_admin() or exists (
        select 1 from service_access
        where service_id = tickets.service_id and user_id = usuario_actual() and solo_consulta = false
      )
    )
  );
create policy "actualizar folios con acceso completo" on tickets
  for update using (
    es_admin() or exists (
      select 1 from service_access
      where service_id = tickets.service_id and user_id = usuario_actual() and solo_consulta = false
    )
  );

-- ============================================================
-- Requisiciones — solicitud interna de compra/material, con
-- aprobación de un administrador. Mismo patrón que tickets: folio
-- consecutivo por servicio y día (siguiente_contador), el solicitante
-- sale siempre de la sesión, nunca del cuerpo de la petición.
-- ============================================================
create table requisiciones (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  folio text not null,
  concepto text not null,
  cantidad integer not null default 1 check (cantidad > 0),
  notas text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por uuid references profiles(id),
  aprobado_por uuid references profiles(id),
  -- Copia de la firma del aprobador EN EL MOMENTO de resolver, no una
  -- referencia viva a profiles.firma_url — si esa persona cambia su
  -- firma después, una requisición ya resuelta no debe cambiar de
  -- aspecto retroactivamente. Mismo criterio que idempotencia_payload
  -- en tickets: foto de un momento, no un enlace.
  firma_resolucion text,
  motivo_rechazo text,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  unique (service_id, folio)
);
alter table requisiciones enable row level security;
create policy "ver requisiciones de servicios a los que tienes acceso" on requisiciones
  for select using (puede_acceder_servicio(service_id));
create policy "crear requisiciones con acceso de escritura al servicio" on requisiciones
  for insert with check (
    solicitado_por = usuario_actual()
    and (
      es_admin() or exists (
        select 1 from service_access
        where service_id = requisiciones.service_id and user_id = usuario_actual() and solo_consulta = false
      )
    )
  );
-- Solo un administrador resuelve (aprueba/rechaza) — a diferencia de
-- crear una, que cualquiera con acceso de escritura al servicio puede
-- hacer.
create policy "admin resuelve requisiciones de su organización" on requisiciones
  for update using (es_admin() and puede_acceder_servicio(service_id));

-- ============================================================
-- Invitaciones
-- ============================================================
create table invitaciones (
  id uuid primary key default gen_random_uuid(),
  correo text not null,
  org_id uuid not null references organizations(id) on delete cascade,
  rol text not null check (rol in ('admin', 'finanzas', 'personal')),
  servicio_ids uuid[] not null default '{}',
  creada_por uuid references profiles(id),
  creada_en timestamptz not null default now(),
  -- Código de un solo uso que el administrador le da a la persona
  -- invitada por un canal que él mismo elige (en persona, por chat,
  -- por su correo institucional aparte) — sin esto, registrarse solo
  -- exigía conocer o adivinar el correo invitado, sin ninguna prueba
  -- de que quien se registra es realmente su dueño. Alguien que
  -- supiera que iba a invitarse a cierta cuenta (o simplemente a
  -- "admin@la-institución.mx") podía registrarla primero, con su
  -- propia contraseña, quedándose con el rol de la invitación —
  -- incluido admin, si esa era la invitación. Generado por el
  -- servidor (servidor/api/src/rutas.ts, POST /invitaciones), nunca
  -- por el cliente.
  token text not null
);
alter table invitaciones enable row level security;
create policy "ver invitaciones de tu organización" on invitaciones
  for select using (pertenece_a_org(org_id) and es_admin());
create policy "admin crea y cancela invitaciones" on invitaciones
  for all using (pertenece_a_org(org_id) and es_admin());

-- ============================================================
-- Bitácora de auditoría
-- ============================================================
create table eventos_auditoria (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references profiles(id),
  actor_nombre text not null,
  accion text not null,
  detalle text not null,
  fecha timestamptz not null default now()
);
alter table eventos_auditoria enable row level security;
create policy "admin ve la bitácora de su organización" on eventos_auditoria
  for select using (pertenece_a_org(org_id) and es_admin());
-- actor_id = usuario_actual() además de pertenecer a la organización:
-- la API (rutas.ts, POST /eventos) ya deriva el actor de la sesión y
-- nunca de lo que mande el cliente, pero esto lo exige también aquí,
-- en la base de datos — para no depender solo de que la API nunca se
-- le olvide a nadie en el futuro (defensa en profundidad).
create policy "cualquier miembro puede registrar un evento como uno mismo" on eventos_auditoria
  for insert with check (pertenece_a_org(org_id) and actor_id = usuario_actual());

-- ============================================================
-- Archivos enviados entre compañeros
-- ============================================================
create table archivos_enviados (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  de_id uuid not null references profiles(id),
  para_id uuid not null references profiles(id),
  service_id uuid references services(id) on delete set null,
  servicio_nombre text,
  tipo text not null,
  nombre_archivo text not null,
  contenido text not null,
  mensaje text,
  fecha timestamptz not null default now(),
  leido boolean not null default false
);
alter table archivos_enviados enable row level security;
create policy "ver archivos que enviaste o recibiste" on archivos_enviados
  for select using (de_id = usuario_actual() or para_id = usuario_actual());
-- "dentro de tu organización" tiene que valer también para A QUIÉN se
-- manda, no solo quién lo manda: sin el exists() de abajo, el único
-- requisito real era pertenecer TÚ a alguna organización — para_id
-- podía ser cualquier cuenta que existiera en todo el sistema, de
-- cualquier institución, mientras el uuid se conociera (no adivinable
-- en la práctica, pero rompía la promesa de aislamiento entre
-- organizaciones si este mismo servidor algún día atendiera a más de
-- una institución a la vez). Encontrado en esta auditoría.
create policy "enviar un archivo dentro de tu organización" on archivos_enviados
  for insert with check (
    de_id = usuario_actual()
    and pertenece_a_org(org_id)
    and exists (select 1 from org_members where org_id = archivos_enviados.org_id and user_id = para_id)
  );
create policy "marcar como leído lo que recibiste" on archivos_enviados
  for update using (para_id = usuario_actual());

-- ============================================================
-- Índices
-- ============================================================
create index tickets_folio_idx on tickets (folio);
create index tickets_service_id_idx on tickets (service_id);
create index invitaciones_correo_idx on invitaciones (lower(correo));
create index profiles_correo_idx on profiles (lower(correo));

-- ============================================================
-- FORCE ROW LEVEL SECURITY — sin esto, la seguridad por fila de
-- arriba NO aplica para el dueño de las tablas (que es quien ejecutó
-- este script). "enable row level security" por sí solo exime al
-- dueño; "force" lo obliga también a él. Necesario porque
-- servidor/api se conecta con un solo rol para todo — no hay un rol
-- "dueño de las tablas" y otro distinto "de la aplicación".
-- ============================================================
alter table organizations force row level security;
alter table profiles force row level security;
alter table org_members force row level security;
alter table services force row level security;
alter table service_access force row level security;
alter table categorias force row level security;
alter table procedimientos force row level security;
alter table tickets force row level security;
alter table requisiciones force row level security;
alter table invitaciones force row level security;
alter table eventos_auditoria force row level security;
alter table archivos_enviados force row level security;

-- ============================================================
-- Operaciones que necesitan saltarse la seguridad por fila a propósito
-- (SECURITY DEFINER, corren con los privilegios de quien las creó, no
-- de quien las llama) — exactamente el mismo patrón que ya usa la
-- versión en la nube (servidor/migraciones/), solo que aquí en vez de
-- auth.uid() se usa usuario_actual():
--
--   - Registrar cuenta: antes de que exista sesión, no hay
--     usuario_actual() con el que RLS deje insertar nada en profiles.
--   - Crear/eliminar organización, eliminar servicio: el chequeo de
--     "eres admin" y las reglas de negocio (no dejar la última
--     organización, no borrar un servicio con folios) viven dentro de
--     la función, no en una política de tabla.
--   - Cambiar rol: profiles.rol queda protegido por columna más abajo
--     (ver GRANT) — solo esta función puede tocarlo.
-- ============================================================
create or replace function registrar_usuario(p_nombre text, p_correo text, p_password_hash text, p_token text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invitaciones%rowtype;
  nuevo profiles%rowtype;
begin
  select * into inv from invitaciones where lower(trim(correo)) = lower(trim(p_correo)) limit 1;
  if inv.id is null then
    raise exception 'Tu administrador debe invitarte primero desde Configuración → Usuarios.';
  end if;
  -- El código de invitación demuestra que quien se registra es a quien
  -- el administrador le dio ese código (en persona, por chat, por su
  -- propio correo institucional) — coincidir solo el correo no probaba
  -- nada: cualquiera que conociera o adivinara un correo con invitación
  -- pendiente podía registrarlo primero, con su propia contraseña,
  -- quedándose con el rol de esa invitación.
  if p_token is null or inv.token <> p_token then
    raise exception 'Ese código de invitación no es correcto.';
  end if;

  insert into profiles (nombre, correo, password_hash, rol)
  values (p_nombre, lower(trim(p_correo)), p_password_hash, inv.rol)
  returning * into nuevo;

  insert into org_members (org_id, user_id) values (inv.org_id, nuevo.id);
  if array_length(inv.servicio_ids, 1) > 0 then
    insert into service_access (service_id, user_id) select unnest(inv.servicio_ids), nuevo.id;
  end if;
  delete from invitaciones where id = inv.id;

  return nuevo;
end;
$$;

-- Misma función que la de arriba, sin el chequeo del código de
-- invitación — solo para el registro vía la cuenta institucional de
-- Microsoft (servidor/api/src/microsoft.ts): ahí quien se registra ya
-- demostró controlar ese correo autenticándose de verdad ante Azure
-- AD/Entra ID, una prueba de identidad más fuerte que un código
-- relayado a mano. Duplicada en vez de compartir código con un
-- parámetro "omitir verificación" a propósito — así ninguna llamada
-- puede saltarse el código de invitación por accidente.
create or replace function registrar_usuario_via_microsoft(p_nombre text, p_correo text, p_password_hash text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invitaciones%rowtype;
  nuevo profiles%rowtype;
begin
  select * into inv from invitaciones where lower(trim(correo)) = lower(trim(p_correo)) limit 1;
  if inv.id is null then
    raise exception 'Tu administrador debe invitarte primero desde Configuración → Usuarios.';
  end if;

  insert into profiles (nombre, correo, password_hash, rol)
  values (p_nombre, lower(trim(p_correo)), p_password_hash, inv.rol)
  returning * into nuevo;

  insert into org_members (org_id, user_id) values (inv.org_id, nuevo.id);
  if array_length(inv.servicio_ids, 1) > 0 then
    insert into service_access (service_id, user_id) select unnest(inv.servicio_ids), nuevo.id;
  end if;
  delete from invitaciones where id = inv.id;

  return nuevo;
end;
$$;

create or replace function crear_organizacion(p_nombre text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  nueva organizations%rowtype;
begin
  if not es_admin() then
    raise exception 'Solo un administrador puede crear una organización.';
  end if;
  insert into organizations (nombre, color_primario) values (p_nombre, '#3a3a3a') returning * into nueva;
  insert into org_members (org_id, user_id) values (nueva.id, usuario_actual());
  insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
  select nueva.id, usuario_actual(), coalesce(nombre, correo), 'Creó la organización', p_nombre
  from profiles where id = usuario_actual();
  return nueva;
end;
$$;

create or replace function eliminar_organizacion(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin() then
    raise exception 'Solo un administrador puede eliminar una organización.';
  end if;
  -- "for update" bloquea TODAS las filas de organizations mientras
  -- dura esta transacción — mismo motivo exacto que el candado de
  -- cambiar_rol(): sin esto, dos eliminaciones de DOS organizaciones
  -- DISTINTAS, disparadas casi al mismo tiempo cuando solo quedan 2,
  -- podían ver las dos "hay más de una" y proceder las dos, dejando
  -- CERO organizaciones.
  perform 1 from organizations for update;
  if (select count(*) from organizations) <= 1 then
    raise exception 'No puedes eliminar tu única organización — siempre debe quedar al menos una.';
  end if;
  if exists (select 1 from services where org_id = p_org_id) then
    raise exception 'Esta organización todavía tiene servicios — elimínalos primero para no perder su historial por accidente.';
  end if;
  delete from organizations where id = p_org_id;
end;
$$;

create or replace function eliminar_servicio(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (pertenece_a_org(org_de_servicio(p_service_id)) and es_admin()) then
    raise exception 'Solo un administrador de esta organización puede eliminar el servicio.';
  end if;
  if exists (select 1 from tickets where service_id = p_service_id) then
    raise exception 'Este servicio ya tiene folios registrados — desactívalo en vez de eliminarlo.';
  end if;
  delete from services where id = p_service_id;
end;
$$;

create or replace function cambiar_rol(p_user_id uuid, p_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_anterior text;
  v_nombre_afectado text;
  v_actor_id uuid := usuario_actual();
  v_actor_nombre text;
begin
  if not es_admin() then
    raise exception 'Solo un administrador puede cambiar roles.';
  end if;
  select rol, nombre into v_rol_anterior, v_nombre_afectado from profiles where id = p_user_id;
  -- El rol de administrador es de toda la institución, no por
  -- organización (ver AdminSettings.tsx) — sin este candado, el
  -- último administrador podía degradarse a sí mismo (o a el otro
  -- único admin) por accidente, dejando a TODA la institución sin
  -- nadie que pueda invitar gente, crear servicios, o volver a asignar
  -- el rol de admin — sin acceso directo a la base de datos, no habría
  -- forma de recuperarse desde la aplicación misma. Mismo criterio que
  -- ya protege a "no eliminar la única organización" (eliminar_organizacion).
  if p_rol <> 'admin' then
    -- "for update" bloquea las filas de TODOS los administradores
    -- mientras dura esta transacción — sin esto, dos administradores
    -- degradándose el uno al otro al mismo tiempo (cada uno viendo "2
    -- admins" antes de que el otro terminara) podían pasar las dos el
    -- chequeo de abajo a la vez y dejar la institución con CERO
    -- administradores — justo lo que este candado existe para evitar.
    -- Con el bloqueo, la segunda transacción tiene que ESPERAR a que
    -- la primera termine, y entonces sí ve el conteo ya actualizado.
    perform 1 from profiles where rol = 'admin' for update;
    if v_rol_anterior = 'admin' and (select count(*) from profiles where rol = 'admin') <= 1 then
      raise exception 'No puedes quitarle el rol de administrador a la única cuenta administradora — primero dale ese rol a alguien más.';
    end if;
  end if;
  update profiles set rol = p_rol where id = p_user_id;
  -- El evento se registra en esta misma transacción, no con una
  -- segunda petición aparte del navegador después de que esto ya tuvo
  -- éxito: antes, una falla de red entre ambas dejaba el rol cambiado
  -- sin ningún rastro en la bitácora, y nada impedía llamar solo a
  -- /eventos para describir un cambio de rol que nunca ocurrió. Se
  -- registra en cada organización a la que pertenece la cuenta
  -- afectada — el rol es institucional, así que a todas les interesa.
  select nombre into v_actor_nombre from profiles where id = v_actor_id;
  insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
  select om.org_id, v_actor_id, coalesce(v_actor_nombre, 'Alguien'), 'Cambió el rol de un usuario',
    coalesce(v_nombre_afectado, p_user_id::text) || ': ' || coalesce(v_rol_anterior, '?') || ' → ' || p_rol
  from org_members om where om.user_id = p_user_id;
end;
$$;

-- "Olvidé mi contraseña" sin servicio de correo configurado: el admin
-- restablece la contraseña de alguien (misma confianza que ya existe
-- en todo el sistema — nada pasa sin que un admin lo autorice) y le
-- comparte la temporal por el medio que sea; la persona la cambia al
-- entrar, con la pantalla de "cambiar contraseña" que ya existe. El
-- hash lo calcula el servidor (bcrypt, igual que el resto) — esta
-- función solo lo guarda, y de paso limpia cualquier bloqueo pendiente.
create or replace function restablecer_password(p_user_id uuid, p_password_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre_afectado text;
  v_actor_id uuid := usuario_actual();
  v_actor_nombre text;
begin
  if not es_admin() then
    raise exception 'Solo un administrador puede restablecer una contraseña.';
  end if;
  update profiles
  set password_hash = p_password_hash, intentos_fallidos = 0, bloqueado_hasta = null,
      sesion_valida_desde = now(), debe_cambiar_password = true
  where id = p_user_id
  returning nombre into v_nombre_afectado;
  -- Mismo motivo que en cambiar_rol(): un restablecimiento de
  -- contraseña ajena es exactamente el tipo de acción que un admin
  -- necesita poder rastrear después con certeza — no algo que dependa
  -- de que el navegador mande, aparte, una segunda petición a /eventos
  -- que sí llegue.
  select nombre into v_actor_nombre from profiles where id = v_actor_id;
  insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
  select om.org_id, v_actor_id, coalesce(v_actor_nombre, 'Alguien'), 'Restableció la contraseña de alguien',
    coalesce(v_nombre_afectado, p_user_id::text)
  from org_members om where om.user_id = p_user_id;
end;
$$;

-- Login (y el paso de Microsoft que revisa si un correo ya tiene
-- cuenta): antes de que exista sesión, RLS no deja ver ninguna fila de
-- profiles — esta función expone lo mínimo indispensable (id, hash y
-- si está bloqueada), nunca el resto del perfil.
create or replace function obtener_credenciales_login(p_correo text)
returns table (id uuid, password_hash text, bloqueado_hasta timestamptz, totp_habilitado boolean, totp_secret text)
language sql
security definer
set search_path = public
stable
as $$
  select id, password_hash, bloqueado_hasta, totp_habilitado, totp_secret from profiles where lower(correo) = lower(trim(p_correo));
$$;

-- Mismo caso que la de arriba (sin sesión todavía), pero para el
-- segundo paso del login con 2FA: en ese momento ya se sabe el id
-- (viene firmado en el token de la primera mitad del login, ver
-- rutas.ts), no el correo.
-- bloqueado_hasta aquí también: el segundo paso del login (verificar
-- el código TOTP) necesita poder rechazar de una vez una cuenta ya
-- bloqueada, igual que el primer paso — sin esto, alguien con un
-- tokenPre válido (ya pasó la contraseña) podía seguir probando
-- códigos de 6 dígitos repartiendo los intentos entre varias
-- direcciones IP, ya que el límite de tasa del servidor es por IP y
-- el bloqueo por cuenta de aquí no lo era.
-- sesion_valida_desde aquí también: el tokenPre del segundo paso lleva
-- su propio "emitido en" (igual que el JWT de sesión completa), y este
-- segundo paso tiene que poder rechazar un tokenPre emitido ANTES de
-- que la contraseña cambiara — sin esto, un tokenPre obtenido antes de
-- un cambio de contraseña (el usuario reaccionando a una cuenta
-- comprometida) seguía sirviendo para completar el login dentro de su
-- ventana de 5 minutos, aunque la contraseña ya fuera otra.
create or replace function obtener_credenciales_login_por_id(p_user_id uuid)
returns table (totp_habilitado boolean, totp_secret text, bloqueado_hasta timestamptz, sesion_valida_desde timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select totp_habilitado, totp_secret, bloqueado_hasta, sesion_valida_desde from profiles where id = p_user_id;
$$;

-- requerirSesion() (servidor/api/src/auth.ts) llama esto en CADA
-- petición protegida, antes de que exista la sesión que RLS necesita
-- para dejar ver la fila (usuario_actual() todavía no está puesto en
-- este punto) — mismo motivo que las dos funciones de arriba, solo que
-- esta corre con sesión ya identificada (por el JWT), no antes del
-- login. SECURITY DEFINER + esta única columna, nunca el resto del
-- perfil.
create or replace function sesion_valida_desde_de(p_user_id uuid)
returns table (sesion_valida_desde timestamptz, debe_cambiar_password boolean)
language sql
security definer
set search_path = public
stable
as $$
  select sesion_valida_desde, debe_cambiar_password from profiles where id = p_user_id;
$$;

-- Umbral de bloqueo: 5 intentos fallidos seguidos bloquean la cuenta
-- 15 minutos. Se resetea el contador solo con un login exitoso — no
-- con el paso del tiempo, a propósito, para que alguien probando
-- contraseñas al azar de vez en cuando no evada el bloqueo.
create or replace function registrar_intento_fallido(p_correo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update profiles
  set intentos_fallidos = intentos_fallidos + 1,
      bloqueado_hasta = case
        when intentos_fallidos + 1 >= 5 then now() + interval '15 minutes'
        else bloqueado_hasta
      end
  where lower(correo) = lower(trim(p_correo))
  returning id into v_id;

  -- Solo se registra si el correo SÍ es una cuenta real — un intento
  -- contra un correo que no existe no tiene organización a la que
  -- asociarse, y tampoco es tan interesante para un admin como "alguien
  -- falló varias veces contra una cuenta real de mi organización".
  if v_id is not null then
    insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
    select om.org_id, v_id, p.nombre, 'Intento de inicio de sesión fallido', p.correo
    from profiles p join org_members om on om.user_id = p.id
    where p.id = v_id;
  end if;
end;
$$;

create or replace function registrar_login_exitoso(p_correo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update profiles set intentos_fallidos = 0, bloqueado_hasta = null
  where lower(correo) = lower(trim(p_correo))
  returning id into v_id;

  if v_id is not null then
    insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
    select om.org_id, v_id, p.nombre, 'Inició sesión', p.correo
    from profiles p join org_members om on om.user_id = p.id
    where p.id = v_id;
  end if;
end;
$$;

-- Mismas dos funciones de arriba, por id en vez de por correo — para
-- el segundo paso del login (verificar el código TOTP), donde ya se
-- conoce la cuenta por su id (viene del tokenPre) y no por el correo.
-- El límite es el mismo: 5 códigos incorrectos bloquean la cuenta 15
-- minutos, sin importar desde cuántas direcciones IP distintas se
-- repartan los intentos.
create or replace function registrar_intento_fallido_por_id(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_correo text;
begin
  update profiles
  set intentos_fallidos = intentos_fallidos + 1,
      bloqueado_hasta = case
        when intentos_fallidos + 1 >= 5 then now() + interval '15 minutes'
        else bloqueado_hasta
      end
  where id = p_user_id
  returning nombre, correo into v_nombre, v_correo;

  if v_nombre is not null then
    insert into eventos_auditoria (org_id, actor_id, actor_nombre, accion, detalle)
    select om.org_id, p_user_id, v_nombre, 'Código de verificación incorrecto', v_correo
    from org_members om where om.user_id = p_user_id;
  end if;
end;
$$;

create or replace function registrar_login_exitoso_por_id(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set intentos_fallidos = 0, bloqueado_hasta = null where id = p_user_id;
end;
$$;

-- Confirmar correo (opcional — solo se usa si el envío de correo está
-- configurado): el enlace que se manda por correo trae un token
-- firmado (JWT, verificado en el servidor, no aquí) que ya identifica
-- al usuario — esta función solo aplica el cambio.
create or replace function confirmar_correo(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set correo_confirmado = true where id = p_user_id;
$$;

-- Restablecer contraseña vía enlace de correo (opcional, distinto de
-- restablecer_password() de arriba, que es la versión que usa un
-- ADMINISTRADOR desde el panel). Aquí la autorización ya la validó el
-- servidor (el token firmado del enlace) — lo único que hace esta
-- función es, además de aplicar el cambio, evitar que el MISMO enlace
-- se pueda reusar después de ya haberse usado una vez: p_hash_termina
-- son los últimos caracteres del password_hash que tenía la cuenta
-- cuando se mandó el correo — si ya no coinciden (porque la
-- contraseña ya cambió, con este enlace o por cualquier otro medio),
-- el enlace quedó vencido. Regresa false en ese caso en vez de
-- lanzar una excepción — el servidor decide qué mensaje mostrar.
create or replace function restablecer_password_via_token(
  p_user_id uuid, p_hash_termina text, p_password_hash_nuevo text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
begin
  select password_hash into v_actual from profiles where id = p_user_id;
  if v_actual is null or right(v_actual, 12) <> p_hash_termina then
    return false;
  end if;
  update profiles
  set password_hash = p_password_hash_nuevo, intentos_fallidos = 0, bloqueado_hasta = null,
      sesion_valida_desde = now(), debe_cambiar_password = false
  where id = p_user_id;
  return true;
end;
$$;

-- ============================================================
-- Rol de aplicación — servidor/api se conecta con ESTE rol, nunca con
-- el que corrió este script (ese suele ser dueño/superusuario, y un
-- superusuario se salta RLS sin importar FORCE de arriba). Cambia la
-- contraseña de abajo antes de usarlo en producción.
-- ============================================================
do $$
begin
  if not exists (select from pg_roles where rolname = 'finaquick_app') then
    create role finaquick_app with login password 'cambia-esta-contrasena' nosuperuser;
  end if;
end
$$;

grant usage on schema public to finaquick_app;

grant select, insert, update, delete on
  organizations, org_members, services, service_access, categorias,
  procedimientos, tickets, requisiciones, invitaciones, eventos_auditoria, archivos_enviados
to finaquick_app;

-- contadores no necesita RLS ni políticas (no guarda datos de ningún
-- usuario), pero sí necesita estos permisos directos porque
-- siguiente_contador() NO es SECURITY DEFINER — corre con los
-- privilegios de quien la llama, que es finaquick_app.
grant select, insert, update on contadores to finaquick_app;

-- profiles aparte: nadie actualiza su propio rol por UPDATE normal
-- (solo la función cambiar_rol de arriba, que corre con privilegios
-- propios) — sin esto, cualquier cuenta podría auto-asignarse
-- rol = 'admin' llamando la API directo. password_hash sí se puede
-- actualizar directo (cambiar la propia contraseña) porque RLS ya
-- limita esa fila a "la tuya o eres admin" — no hace falta una función
-- aparte para eso.
grant select on profiles to finaquick_app;
grant update (nombre, telefono, foto_url, firma_url, bio, password_hash, totp_secret, totp_secret_pendiente, totp_habilitado, sesion_valida_desde, debe_cambiar_password) on profiles to finaquick_app;

-- Por default, PostgreSQL deja que CUALQUIER rol que pueda conectarse
-- a esta base de datos ejecute una función recién creada (privilegio
-- EXECUTE a PUBLIC), sin importar que sea SECURITY DEFINER. Ninguna de
-- las funciones de abajo hace nada peligroso solo por poder llamarlas
-- — cada una revisa por su cuenta, con usuario_actual()/es_admin(),
-- si quien la llama tiene permiso de verdad — pero dejarlas abiertas a
-- PUBLIC no tiene ninguna ventaja y sí ensancha innecesariamente la
-- superficie de ataque si algún día otro rol (no finaquick_app ni
-- finaquick_respaldo) se conecta a esta misma base de datos. Se
-- revoca explícitamente y se otorga solo al rol de aplicación.
revoke execute on function
  usuario_actual(),
  es_admin(),
  pertenece_a_org(uuid),
  puede_acceder_servicio(uuid),
  org_de_servicio(uuid),
  comparte_org_con(uuid),
  registrar_usuario(text, text, text, text),
  registrar_usuario_via_microsoft(text, text, text),
  crear_organizacion(text),
  eliminar_organizacion(uuid),
  eliminar_servicio(uuid),
  cambiar_rol(uuid, text),
  restablecer_password(uuid, text),
  obtener_credenciales_login(text),
  obtener_credenciales_login_por_id(uuid),
  sesion_valida_desde_de(uuid),
  registrar_intento_fallido(text),
  registrar_login_exitoso(text),
  registrar_intento_fallido_por_id(uuid),
  registrar_login_exitoso_por_id(uuid),
  confirmar_correo(uuid),
  restablecer_password_via_token(uuid, text, text),
  siguiente_contador(text)
from public;

-- Las seis primeras (usuario_actual, es_admin, pertenece_a_org,
-- puede_acceder_servicio, org_de_servicio, comparte_org_con) las usan
-- las políticas de seguridad a nivel de fila de arriba, evaluadas con
-- el rol de quien hace la consulta — finaquick_app necesita poder
-- ejecutarlas para que esas políticas funcionen. finaquick_respaldo NO
-- las necesita: se conecta con BYPASSRLS, así que nunca llega a
-- evaluar una política que las invoque.
grant execute on function
  usuario_actual(),
  es_admin(),
  pertenece_a_org(uuid),
  puede_acceder_servicio(uuid),
  org_de_servicio(uuid),
  comparte_org_con(uuid),
  registrar_usuario(text, text, text, text),
  registrar_usuario_via_microsoft(text, text, text),
  crear_organizacion(text),
  eliminar_organizacion(uuid),
  eliminar_servicio(uuid),
  cambiar_rol(uuid, text),
  restablecer_password(uuid, text),
  obtener_credenciales_login(text),
  obtener_credenciales_login_por_id(uuid),
  sesion_valida_desde_de(uuid),
  registrar_intento_fallido(text),
  registrar_login_exitoso(text),
  registrar_intento_fallido_por_id(uuid),
  registrar_login_exitoso_por_id(uuid),
  confirmar_correo(uuid),
  restablecer_password_via_token(uuid, text, text),
  siguiente_contador(text)
to finaquick_app;

-- Y en servidor/api/.env:
--   DATABASE_URL=postgresql://finaquick_app:cambia-esta-contrasena@localhost:5432/finaquick

-- ============================================================
-- Rol de respaldos — pg_dump necesita ver TODA la información sin que
-- RLS se la filtre (un respaldo incompleto es peor que no tener
-- respaldo: se ve como que sí hay copia de seguridad hasta el día que
-- hace falta restaurarla). finaquick_app a propósito NO sirve para
-- esto — algunas políticas (ver "archivos que enviaste o recibiste"
-- arriba) ni siquiera dejan ver más que lo propio siendo admin.
-- BYPASSRLS es el permiso mínimo exacto para esto — no hace falta
-- superusuario, ni ningún otro privilegio de administración del
-- servidor de PostgreSQL en sí. Cambia la contraseña de abajo antes
-- de usarlo en producción (el launcher lo hace solo).
-- ============================================================
do $$
begin
  if not exists (select from pg_roles where rolname = 'finaquick_respaldo') then
    create role finaquick_respaldo with login password 'cambia-esta-contrasena' nosuperuser bypassrls;
  end if;
end
$$;

grant usage on schema public to finaquick_respaldo;
grant select on all tables in schema public to finaquick_respaldo;
-- Para que tablas que se agreguen después también queden cubiertas
-- sin tener que acordarse de repetir el grant de arriba.
alter default privileges in schema public grant select on tables to finaquick_respaldo;

-- Y en servidor/api/.env:
--   DATABASE_URL_RESPALDO=postgresql://finaquick_respaldo:cambia-esta-contrasena@localhost:5432/finaquick
