#!/usr/bin/env bash
# Verifica que la instalación de Finaquick esté aislada del resto de
# las bases de datos del mismo servidor de PostgreSQL — pensado para
# el equipo de sistemas, para correr una sola vez después de instalar,
# especialmente si este PostgreSQL también aloja otras bases de datos
# de la institución (no uno dedicado solo a esto).
#
# Uso:
#   ./verificar-aislamiento-bd.sh nombre_de_la_base_de_datos
#
# Necesita conectarse como superusuario (el mismo rol usado para
# aplicar esquema_local.sql) — no como finaquick_app.
set -e

BD="${1:?Uso: ./verificar-aislamiento-bd.sh nombre_de_la_base_de_datos}"

echo "=========================================================="
echo "1. Atributos de los roles de esta aplicación"
echo "=========================================================="
echo "Ninguna de las dos filas de abajo debe decir 't' (verdadero) en"
echo "rolsuper, rolcreatedb o rolcreaterole — si alguna lo dice, alguien"
echo "le dio a este rol más privilegios de los que necesita."
echo ""
psql -d "$BD" -c "
  select rolname, rolsuper, rolcreatedb, rolcreaterole
  from pg_roles
  where rolname in ('finaquick_app', 'finaquick_respaldo');
"

echo "=========================================================="
echo "2. A qué otras bases de datos de este mismo servidor se puede"
echo "   conectar finaquick_app"
echo "=========================================================="
echo "Por default de PostgreSQL, CUALQUIER rol puede conectarse a"
echo "CUALQUIER base de datos del mismo servidor, a menos que se le"
echo "quite ese permiso explícitamente — conectarse no es lo mismo que"
echo "poder leer datos (para eso hacen falta permisos aparte sobre cada"
echo "tabla, que finaquick_app no tiene en ninguna otra base), pero es"
echo "más superficie de la necesaria si este servidor de PostgreSQL es"
echo "compartido con otras bases de datos de la institución."
echo ""
echo "Bases de datos en este servidor y quién puede conectarse:"
psql -d "$BD" -c "
  select
    datname as base_de_datos,
    coalesce(datacl::text, '(default: cualquiera puede conectarse)') as permisos_de_conexion
  from pg_database
  where datname not in ('template0', 'template1');
"
echo ""
echo "Si aparece alguna base de datos QUE NO SEA '$BD' con conexión"
echo "abierta por default, y esa base es de otro sistema de la"
echo "institución (no de prueba), lo más simple es correr, conectado a"
echo "ESA otra base:"
echo ""
echo "  revoke connect on database nombre_de_esa_otra_base from public;"
echo ""
echo "(Deja intacto el acceso de su propia aplicación, que ya tiene su"
echo "propio rol con permiso explícito — esto solo le cierra la puerta"
echo "a cualquier OTRO rol del servidor, incluido finaquick_app.)"
echo ""
echo "La alternativa más simple y más segura, si es viable: usar un"
echo "servidor de PostgreSQL dedicado solo a Finaquick, sin ninguna"
echo "otra base de datos de la institución en el mismo servidor."
