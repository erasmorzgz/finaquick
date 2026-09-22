-- Datos de demostración basados en el catálogo real de Servicios
-- Profesionales de la Universidad Anáhuac Veracruz (campus Xalapa):
-- https://www.anahuac.mx/veracruz/xalapa/servicios/servicios-profesionales
-- Servicios, categorías, procedimientos con precio y folios de ejemplo
-- (algunos pagados, algunos a crédito) sobre la organización que ya
-- exista. Se puede correr varias veces sin duplicar — si algo ya existe
-- con ese nombre, lo salta; los folios de demo llevan el prefijo DEMO- y
-- se reemplazan cada vez que se corre.

do $$
declare
  v_org_id uuid;
  v_admin_id uuid;
  v_serv_psico uuid;
  v_serv_fiscal uuid;
  v_serv_capital uuid;
  v_serv_dental uuid;
begin
  select id into v_org_id from public.organizations order by nombre limit 1;
  if v_org_id is null then
    raise exception 'No hay ninguna organización todavía — crea una primero desde la app.';
  end if;

  select id into v_admin_id from public.profiles where rol = 'admin' order by creado_en limit 1;
  if v_admin_id is null then
    raise exception 'Todavía no existe ninguna cuenta de admin — regístrate primero en la app.';
  end if;

  -- Servicios (Servicios de Salud y Consultoría y Desarrollo de
  -- Negocios del catálogo real, más Clínica Dental — origen de esta
  -- app, sin página propia en el catálogo actual pero afín a
  -- Radiología Craneofacial).
  insert into public.services (org_id, nombre, icono, campo_persona_label, campo_id_label, campo_categoria_label, cierre_caja_label, features, activo)
  select v_org_id, 'Centro de Atención Psicológica', 'Brain', 'Paciente', 'Expediente', 'Tipo de sesión', 'Cierre de caja', '{"creditos": true, "cierreCaja": true, "requiereId": true, "esDerechoClinica": false}'::jsonb, true
  where not exists (select 1 from public.services where org_id = v_org_id and nombre = 'Centro de Atención Psicológica');

  insert into public.services (org_id, nombre, icono, campo_persona_label, campo_id_label, campo_categoria_label, cierre_caja_label, features, activo)
  select v_org_id, 'Asesoría Fiscal y Contable', 'Calculator', 'Cliente', 'RFC', 'Tipo de trámite', 'Cierre de caja', '{"creditos": true, "cierreCaja": true, "requiereId": true, "esDerechoClinica": false}'::jsonb, true
  where not exists (select 1 from public.services where org_id = v_org_id and nombre = 'Asesoría Fiscal y Contable');

  insert into public.services (org_id, nombre, icono, campo_persona_label, campo_id_label, campo_categoria_label, cierre_caja_label, features, activo)
  select v_org_id, 'Consultoría en Capital Humano', 'Users', 'Empresa', 'Contacto', 'Tipo de servicio', 'Cierre de caja', '{"creditos": true, "cierreCaja": true, "requiereId": false, "esDerechoClinica": false}'::jsonb, true
  where not exists (select 1 from public.services where org_id = v_org_id and nombre = 'Consultoría en Capital Humano');

  insert into public.services (org_id, nombre, icono, campo_persona_label, campo_id_label, campo_categoria_label, cierre_caja_label, features, activo)
  select v_org_id, 'Clínica Dental Universitaria', 'Smile', 'Paciente', 'Expediente clínico', 'Tipo de tratamiento', 'Cierre de caja', '{"creditos": true, "cierreCaja": true, "requiereId": true, "esDerechoClinica": true}'::jsonb, true
  where not exists (select 1 from public.services where org_id = v_org_id and nombre = 'Clínica Dental Universitaria');

  select id into v_serv_psico from public.services where org_id = v_org_id and nombre = 'Centro de Atención Psicológica';
  select id into v_serv_fiscal from public.services where org_id = v_org_id and nombre = 'Asesoría Fiscal y Contable';
  select id into v_serv_capital from public.services where org_id = v_org_id and nombre = 'Consultoría en Capital Humano';
  select id into v_serv_dental from public.services where org_id = v_org_id and nombre = 'Clínica Dental Universitaria';

  -- Categorías
  insert into public.categorias (service_id, nombre)
  select v_serv_psico, t.x from (values ('Terapia individual'), ('Terapia de pareja'), ('Evaluación psicométrica')) as t(x)
  where not exists (select 1 from public.categorias c where c.service_id = v_serv_psico and c.nombre = t.x);

  insert into public.categorias (service_id, nombre)
  select v_serv_fiscal, t.x from (values ('Declaraciones'), ('Contabilidad'), ('Auditoría')) as t(x)
  where not exists (select 1 from public.categorias c where c.service_id = v_serv_fiscal and c.nombre = t.x);

  insert into public.categorias (service_id, nombre)
  select v_serv_capital, t.x from (values ('Reclutamiento'), ('Capacitación'), ('Clima laboral')) as t(x)
  where not exists (select 1 from public.categorias c where c.service_id = v_serv_capital and c.nombre = t.x);

  insert into public.categorias (service_id, nombre)
  select v_serv_dental, t.x from (values ('Diagnóstico y prevención'), ('Ortodoncia'), ('Cirugía oral')) as t(x)
  where not exists (select 1 from public.categorias c where c.service_id = v_serv_dental and c.nombre = t.x);

  -- Procedimientos con precio
  insert into public.procedimientos (service_id, nombre, precio)
  select v_serv_psico, t.x, t.p from (values
    ('Sesión individual', 450),
    ('Sesión de pareja', 600),
    ('Batería psicométrica', 800)
  ) as t(x, p)
  where not exists (select 1 from public.procedimientos pr where pr.service_id = v_serv_psico and pr.nombre = t.x);

  insert into public.procedimientos (service_id, nombre, precio)
  select v_serv_fiscal, t.x, t.p from (values
    ('Declaración mensual', 850),
    ('Declaración anual', 2200),
    ('Auditoría preventiva', 3500)
  ) as t(x, p)
  where not exists (select 1 from public.procedimientos pr where pr.service_id = v_serv_fiscal and pr.nombre = t.x);

  insert into public.procedimientos (service_id, nombre, precio)
  select v_serv_capital, t.x, t.p from (values
    ('Proceso de reclutamiento', 2500),
    ('Taller de capacitación', 1800),
    ('Diagnóstico de clima laboral', 2000)
  ) as t(x, p)
  where not exists (select 1 from public.procedimientos pr where pr.service_id = v_serv_capital and pr.nombre = t.x);

  insert into public.procedimientos (service_id, nombre, precio)
  select v_serv_dental, t.x, t.p from (values
    ('Consulta y limpieza dental', 350),
    ('Resina dental', 500),
    ('Extracción simple', 600),
    ('Ortodoncia (mensualidad)', 900),
    ('Radiografía dental', 250)
  ) as t(x, p)
  where not exists (select 1 from public.procedimientos pr where pr.service_id = v_serv_dental and pr.nombre = t.x);

  -- Folios de demo — se reemplazan cada vez que se corre este script.
  delete from public.tickets where folio like 'DEMO-%';

  -- Las formas de pago de aquí en adelante son exactamente las tres que
  -- ofrece la interfaz (ver FormaPago en src/lib/db/types.ts) — antes
  -- esta demo usaba 'efectivo', 'tarjeta' y 'transferencia' en
  -- minúsculas, que el cierre de caja no reconocía: el total del día
  -- sumaba esos folios, pero no aparecían en el desglose por forma de
  -- pago. 'transferencia'
  -- no es una forma de pago que la interfaz sepa mostrar todavía —
  -- aceptarla es una decisión de la institución, no algo que se decida
  -- aquí — así que estos folios de ejemplo se repartieron entre las
  -- tres que sí existen hoy.
  insert into public.tickets (service_id, folio, nombre, identificador, tipo_usuario, categoria, procedimientos, total, estado, forma_pago, creado_por, fecha)
  values
    (v_serv_psico, 'DEMO-0001', 'Sofía Martínez Reyes', 'EXP-0451', 'Externo', 'Terapia individual', '[{"nombre":"Sesión individual","costo":450}]'::jsonb, 450, 'pagado', 'Tarjeta de crédito', v_admin_id, now() - interval '25 days'),
    (v_serv_psico, 'DEMO-0002', 'Carlos y Ana Domínguez', 'EXP-0452', 'Externo', 'Terapia de pareja', '[{"nombre":"Sesión de pareja","costo":600}]'::jsonb, 600, 'pagado', 'Efectivo', v_admin_id, now() - interval '15 days'),
    (v_serv_psico, 'DEMO-0003', 'Luis Fernando Pérez', 'EXP-0453', 'Externo', 'Evaluación psicométrica', '[{"nombre":"Batería psicométrica","costo":800}]'::jsonb, 800, 'credito', null, v_admin_id, now() - interval '3 days'),
    (v_serv_fiscal, 'DEMO-0004', 'Comercializadora del Golfo SA', 'RFC1234567AB', 'Externo', 'Declaraciones', '[{"nombre":"Declaración mensual","costo":850}]'::jsonb, 850, 'pagado', 'Tarjeta de débito', v_admin_id, now() - interval '20 days'),
    (v_serv_fiscal, 'DEMO-0005', 'Panadería La Espiga', 'RFC7654321CD', 'Externo', 'Declaraciones', '[{"nombre":"Declaración anual","costo":2200}]'::jsonb, 2200, 'pagado', 'Tarjeta de crédito', v_admin_id, now() - interval '10 days'),
    (v_serv_fiscal, 'DEMO-0006', 'Talleres Hernández', 'RFC1122334EF', 'Externo', 'Auditoría', '[{"nombre":"Auditoría preventiva","costo":3500}]'::jsonb, 3500, 'credito', null, v_admin_id, now() - interval '2 days'),
    (v_serv_capital, 'DEMO-0007', 'Grupo Inmobiliario Costera', 'contacto@gicostera.mx', 'Externo', 'Reclutamiento', '[{"nombre":"Proceso de reclutamiento","costo":2500}]'::jsonb, 2500, 'pagado', 'Tarjeta de crédito', v_admin_id, now() - interval '12 days'),
    (v_serv_capital, 'DEMO-0008', 'Café Central', 'contacto@cafecentral.mx', 'Externo', 'Capacitación', '[{"nombre":"Taller de capacitación","costo":1800}]'::jsonb, 1800, 'pagado', 'Efectivo', v_admin_id, now() - interval '1 days'),
    (v_serv_dental, 'DEMO-0009', 'Regina Torres Vidal', 'EXP-D-1201', 'Externo', 'Diagnóstico y prevención', '[{"nombre":"Consulta y limpieza dental","costo":350}]'::jsonb, 350, 'pagado', 'Efectivo', v_admin_id, now() - interval '22 days'),
    (v_serv_dental, 'DEMO-0010', 'Jorge Alberto Cruz', 'EXP-D-1202', 'Externo', 'Diagnóstico y prevención', '[{"nombre":"Resina dental","costo":500},{"nombre":"Radiografía dental","costo":250}]'::jsonb, 750, 'pagado', 'Tarjeta de débito', v_admin_id, now() - interval '14 days'),
    (v_serv_dental, 'DEMO-0011', 'Valeria Nuñez Ortega', 'EXP-D-1203', 'Externo', 'Ortodoncia', '[{"nombre":"Ortodoncia (mensualidad)","costo":900}]'::jsonb, 900, 'pagado', 'Tarjeta de crédito', v_admin_id, now() - interval '8 days'),
    (v_serv_dental, 'DEMO-0012', 'Ricardo Salas Medina', 'EXP-D-1204', 'Externo', 'Cirugía oral', '[{"nombre":"Extracción simple","costo":600}]'::jsonb, 600, 'credito', null, v_admin_id, now() - interval '5 days');

end $$;
