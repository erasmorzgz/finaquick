-- Actualiza una base de datos YA instalada (creada con una versión
-- anterior de esquema_local.sql) para el formato completo de la
-- requisición de compra y la conciliación del corte de caja con Getnet.
-- Se puede correr más de una vez sin problema. Una instalación nueva no
-- lo necesita: esquema_local.sql ya trae todo esto.
--
--   psql -v ON_ERROR_STOP=1 -d finaquick_local -f servidor/actualizar_esquema_20260930.sql
--
-- Córrelo con el mismo usuario que aplicó esquema_local.sql (dueño de
-- las tablas), no con finaquick_app.

alter table profiles add column if not exists sello_url text;
alter table organizations add column if not exists encabezado_documentos text;
alter table services add column if not exists referencia_getnet text;

alter table requisiciones add column if not exists departamento text;
alter table requisiciones add column if not exists motivo text;
alter table requisiciones add column if not exists articulos jsonb not null default '[]'::jsonb;
alter table requisiciones add column if not exists destinatario_id uuid references profiles(id) on delete set null;
alter table requisiciones add column if not exists enviada_en timestamptz;
alter table requisiciones add column if not exists firma_solicitante text;
alter table requisiciones add column if not exists sello_solicitante text;
alter table requisiciones add column if not exists sello_resolucion text;

drop policy if exists "admin resuelve requisiciones de su organización" on requisiciones;
drop policy if exists "admin o destinatario resuelve requisiciones de su organización" on requisiciones;
create policy "admin o destinatario resuelve requisiciones de su organización" on requisiciones
  for update using (
    puede_acceder_servicio(service_id)
    and (es_admin() or destinatario_id = usuario_actual() or solicitado_por = usuario_actual())
  );

create table if not exists cierres_caja (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  fecha date not null,
  referencia text,
  archivo_nombre text,
  archivo_hash text,
  total_sistema numeric(12,2) not null,
  total_getnet numeric(12,2) not null,
  diferencia numeric(12,2) not null,
  movimientos_sistema integer not null default 0,
  movimientos_getnet integer not null default 0,
  detalle jsonb not null default '{}'::jsonb,
  estado text not null check (estado in ('aprobado', 'no_aprobado', 'aprobado_con_diferencia')),
  observacion text,
  aprobado_por uuid references profiles(id) on delete set null,
  creado_por uuid references profiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  enviado_en timestamptz,
  unique (service_id, fecha)
);
alter table cierres_caja enable row level security;
alter table cierres_caja force row level security;
drop policy if exists "ver cierres de servicios a los que tienes acceso" on cierres_caja;
create policy "ver cierres de servicios a los que tienes acceso" on cierres_caja
  for select using (puede_acceder_servicio(service_id));
drop policy if exists "conciliar cierres con acceso completo al servicio" on cierres_caja;
create policy "conciliar cierres con acceso completo al servicio" on cierres_caja
  for insert with check (
    creado_por = usuario_actual()
    and (
      es_admin() or exists (
        select 1 from service_access
        where service_id = cierres_caja.service_id and user_id = usuario_actual() and solo_consulta = false
      )
    )
  );
drop policy if exists "actualizar cierres con acceso completo al servicio" on cierres_caja;
create policy "actualizar cierres con acceso completo al servicio" on cierres_caja
  for update using (
    es_admin() or exists (
      select 1 from service_access
      where service_id = cierres_caja.service_id and user_id = usuario_actual() and solo_consulta = false
    )
  );

grant select, insert, update, delete on cierres_caja to finaquick_app;
grant update (nombre, telefono, foto_url, firma_url, sello_url, bio, password_hash, totp_secret, totp_secret_pendiente, totp_habilitado, sesion_valida_desde, debe_cambiar_password) on profiles to finaquick_app;
grant select on cierres_caja to finaquick_respaldo;

-- ¿Puede esta persona recibir una requisición de este servicio para
-- revisarla? Un administrador (su rol es de toda la instalación); finanzas solo si tiene acceso
-- completo al servicio y sigue en la organización. Es SECURITY DEFINER
-- porque quien envía (personal) no puede leer el acceso de otra persona.
create or replace function es_destinatario_valido(p_user_id uuid, p_service_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not puede_acceder_servicio(p_service_id) then
    return false;
  end if;
  return exists (
    select 1 from profiles p
    where p.id = p_user_id
      and (
        p.rol = 'admin'
        or (p.rol = 'finanzas' and exists (
          select 1
          from service_access sa
          join services s on s.id = sa.service_id
          join org_members om on om.org_id = s.org_id and om.user_id = sa.user_id
          where sa.service_id = p_service_id and sa.user_id = p.id and sa.solo_consulta = false
        ))
      )
  );
end;
$$;
revoke execute on function es_destinatario_valido(uuid, uuid) from public;
grant execute on function es_destinatario_valido(uuid, uuid) to finaquick_app;
