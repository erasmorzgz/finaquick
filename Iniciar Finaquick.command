#!/bin/bash
# Doble clic para levantar TODO — base de datos, servidor propio y la
# app — de un solo golpe. No requiere Git ni saber nada de
# programación. Sí requiere tener instalados de antemano:
#   - Node.js (https://nodejs.org, versión LTS)
#   - PostgreSQL (brew install postgresql@16, o el instalador de
#     postgresql.org) — si no lo tienes, este script te avisa y solo
#     abre la parte visual, sin base de datos.
cd "$(dirname "$0")"

clear 2>/dev/null || true
echo "═══════════════════════════════════════"
echo "  Finaquick — iniciando todo en local"
echo "═══════════════════════════════════════"
echo ""

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Falta Node.js" message "Finaquick necesita Node.js para correr. Descárgalo (gratis) de nodejs.org, instala la versión LTS, y vuelve a hacer doble clic en este archivo." as critical' 2>/dev/null || \
    echo "Falta Node.js — descárgalo de https://nodejs.org (versión LTS) y vuelve a intentar."
  read -n 1 -s -r -p "Presiona cualquier tecla para cerrar..."
  exit 1
fi

# ── PostgreSQL: busca psql/createdb en el PATH normal, y si no, en las
# rutas típicas de Homebrew (que no se agregan solas al PATH). El "@*"
# revisa CUALQUIER versión instalada (postgresql@16, @17, @18...) en
# vez de una fija, para que siga funcionando con versiones futuras sin
# tener que actualizar este script cada vez — sin comillas a propósito,
# para que bash sí expanda el comodín. ──
PSQL=""
for candidato in psql /opt/homebrew/opt/postgresql@*/bin/psql /opt/homebrew/opt/postgresql/bin/psql /usr/local/opt/postgresql@*/bin/psql /usr/local/opt/postgresql/bin/psql; do
  if command -v "$candidato" >/dev/null 2>&1; then PSQL="$candidato"; break; fi
done
BINDIR=""
if [ -n "$PSQL" ]; then BINDIR="$(dirname "$(command -v "$PSQL" 2>/dev/null || echo "$PSQL")")"; fi

DB_LISTA=false

if [ -z "$PSQL" ]; then
  echo "─────────────────────────────────────────────────────"
  echo "  No encontré PostgreSQL instalado — solo se va a"
  echo "  abrir la parte visual, sin base de datos conectada."
  echo ""
  echo "  Para tenerlo todo: instala PostgreSQL"
  echo "  (brew install postgresql@16) y vuelve a abrir esto."
  echo "─────────────────────────────────────────────────────"
  echo ""
else
  export PATH="$BINDIR:$PATH"

  if [ ! -f "servidor/api/.env" ]; then
    echo "Preparando la base de datos (solo la primera vez)..."

    # Con qué usuario de PostgreSQL conectarse. Con Homebrew (lo más
    # común en Mac) el superusuario suele ser el mismo usuario del
    # sistema operativo, sin contraseña — pero con el instalador de
    # postgresql.org (una alternativa real, ver LOCAL_SETUP.md) el
    # superusuario SIEMPRE se llama "postgres" y pide contraseña, sin
    # importar el usuario de macOS. Sin esto, psql/createdb intentarían
    # conectarse con el usuario del sistema (que no existe como rol de
    # PostgreSQL en ese caso) y se quedarían pidiendo una contraseña
    # que nunca iba a funcionar — el mismo hueco que sí se confirmó
    # real en Windows, probando la instalación de verdad ahí. "-w"
    # evita quedarse esperando una contraseña a ciegas — falla rápido
    # si hace falta una.
    export PGCONNECT_TIMEOUT=5
    if ! psql -d postgres -c "select 1" -w >/dev/null 2>&1; then
      export PGUSER=postgres
      if ! psql -d postgres -c "select 1" -w >/dev/null 2>&1; then
        echo ""
        echo "PostgreSQL pide la contraseña del superusuario \"postgres\""
        echo "(la que se puso al instalar PostgreSQL) para preparar la"
        echo "base de datos la primera vez."
        read -s -p "Contraseña de postgres: " PGPASSWORD
        export PGPASSWORD
        echo ""
        if ! psql -d postgres -c "select 1" -w >/dev/null 2>&1; then
          echo "No se pudo conectar a PostgreSQL con esa contraseña (o el"
          echo "servicio de PostgreSQL no está corriendo). Revisa la"
          echo "contraseña y vuelve a abrir esto, o hazlo a mano (ver"
          echo "LOCAL_SETUP.md, paso 1)."
          read -n 1 -s -r -p "Presiona cualquier tecla para cerrar..."
          exit 1
        fi
      fi
    fi

    # Genera credenciales propias para esta instalación — nunca las
    # mismas de relleno que trae el esquema.
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
    DB_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
    DB_PASSWORD_RESPALDO=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")

    if createdb finaquick_local 2>/dev/null; then
      echo "Base de datos 'finaquick_local' creada — aplicando esquema..."
      psql -d finaquick_local -f servidor/esquema_local.sql >/tmp/finaquick_esquema.log 2>&1 || {
        echo "Hubo un problema aplicando el esquema — revisa /tmp/finaquick_esquema.log"
      }
    else
      # Ya existía — pero de una versión ANTERIOR de Finaquick (de un
      # zip más viejo, probando esto antes) es indistinguible, desde
      # aquí, de una instalación real ya en uso: en ambos casos
      # "createdb" falla igual porque la base ya está ahí. Sin
      # preguntar, "no se toca su contenido" sonaba prudente, pero en
      # la práctica dejaba a alguien con una base vieja (le faltan
      # columnas/funciones que el código de hoy necesita) registrado
      # "con éxito" en la consola pero sin poder ni registrarse ni
      # guardar nada en la app — sin ningún aviso de por qué. Mejor
      # preguntar aquí mismo que fallar en silencio después.
      echo ""
      echo "La base de datos 'finaquick_local' ya existía."
      echo "Si vienes de una versión anterior de Finaquick (otro zip, otro intento) y no"
      echo "tienes datos reales ahí todavía, lo normal es borrarla y empezar de cero —"
      echo "si no, cosas como registrarte o guardar folios pueden fallar sin explicación,"
      echo "porque le faltan columnas o funciones que esta versión ya necesita."
      echo "Si esta base SÍ tiene información real que quieres conservar, contesta que no."
      read -p "¿Borrar 'finaquick_local' y crearla de nuevo? (s/N): " RESPUESTA_RESET
      if [ "$RESPUESTA_RESET" = "s" ] || [ "$RESPUESTA_RESET" = "S" ]; then
        dropdb finaquick_local
        createdb finaquick_local
        echo "Base de datos 'finaquick_local' recreada — aplicando esquema..."
        psql -d finaquick_local -f servidor/esquema_local.sql >/tmp/finaquick_esquema.log 2>&1 || {
          echo "Hubo un problema aplicando el esquema — revisa /tmp/finaquick_esquema.log"
        }
      else
        echo "Se deja tal cual — no se toca su contenido."
      fi
    fi

    # Como el registro es solo por invitación, hace falta crear la
    # primera cuenta — se pregunta aquí en vez de dejar algo de prueba
    # ya metido en el esquema (eso lo debe decidir quien lo instale, no
    # nosotros). Corre sin importar si la base de datos se acaba de
    # crear o ya existía de un intento anterior — lo único que de
    # verdad importa es que servidor/api/.env todavía no existe (osea,
    # "esto sigue sin quedar listo"), sin importar en qué paso se haya
    # quedado a medias la vez pasada.
    echo ""
    echo "Primera vez usando Finaquick — hay que crear la cuenta del primer administrador."
    # Sin esto, Finaquick queda corriendo por completo pero sin ninguna
    # forma de entrar — el registro es solo por invitación, y sin admin
    # no hay quien invite a nadie más después. Por eso insiste en vez
    # de saltarse el paso con un campo vacío (un Enter de más es fácil
    # que pase sin querer) — encontrado probando la instalación real.
    # Ctrl+C sigue siendo la salida para quien de plano prefiera
    # configurarlo después a mano (LOCAL_SETUP.md, paso 4).
    ADMIN_ORG=""
    while [ -z "$ADMIN_ORG" ]; do
      read -p "Nombre de la institución (ej. Universidad Anáhuac): " ADMIN_ORG
      if [ -z "$ADMIN_ORG" ]; then
        echo "El nombre de la institución no puede quedar vacío — Finaquick necesita al menos una cuenta de administrador para poder usarse. Vuelve a intentar, o cierra esta ventana (Ctrl+C) si prefieres configurarlo después a mano (ver LOCAL_SETUP.md, paso 4)."
      fi
    done
    ADMIN_CORREO=""
    while [ -z "$ADMIN_CORREO" ]; do
      read -p "Correo del primer administrador: " ADMIN_CORREO
      if [ -z "$ADMIN_CORREO" ]; then
        echo "El correo del administrador no puede quedar vacío — Finaquick necesita al menos una cuenta de administrador para poder usarse. Vuelve a intentar, o cierra esta ventana (Ctrl+C) si prefieres configurarlo después a mano (ver LOCAL_SETUP.md, paso 4)."
      fi
    done

    # El código de invitación es lo que de verdad prueba que quien se
    # registra es a quien se le dio ese código — sin esto, cualquiera
    # que conociera o adivinara este correo podía registrarlo primero.
    # Como aquí la misma persona que instala es quien va a registrarse,
    # no hace falta relayarlo a nadie más: solo hay que copiarlo del
    # mensaje de abajo al formulario de registro.
    ADMIN_TOKEN=$(openssl rand -hex 12)
    cat > /tmp/finaquick_bootstrap.sql <<'SQLEOF'
insert into organizations (nombre, color_primario) values (:'org_nombre', '#3a3a3a') returning id \gset
insert into invitaciones (correo, org_id, rol, token) values (:'admin_correo', :'id', 'admin', :'admin_token');
SQLEOF
    if psql -d finaquick_local -v org_nombre="$ADMIN_ORG" -v admin_correo="$ADMIN_CORREO" -v admin_token="$ADMIN_TOKEN" -f /tmp/finaquick_bootstrap.sql >/tmp/finaquick_bootstrap.log 2>&1; then
      echo "Listo — ya puedes registrarte en la app con ese correo (botón \"Regístrate\")."
      echo "Código de invitación (pídelo también en el formulario de registro): $ADMIN_TOKEN"
      echo ""
      echo "Para ver la app ya con folios y servicios de ejemplo cargados (útil para"
      echo "revisarla, no para uso real): regístrate primero con lo de arriba, y"
      echo "después corre \"cd servidor/api && npm run demo\" (ver LOCAL_SETUP.md, paso 5)."
    else
      echo "No se pudo crear la invitación automática — revisa /tmp/finaquick_bootstrap.log, o hazlo a mano (ver LOCAL_SETUP.md, paso 4)."
    fi
    rm -f /tmp/finaquick_bootstrap.sql

    psql -d finaquick_local -c "alter role finaquick_app password '$DB_PASSWORD';" >/dev/null 2>&1 || true
    psql -d finaquick_local -c "alter role finaquick_respaldo password '$DB_PASSWORD_RESPALDO';" >/dev/null 2>&1 || true

    mkdir -p servidor/api
    cat > servidor/api/.env <<EOF
DATABASE_URL=postgresql://finaquick_app:${DB_PASSWORD}@localhost:5432/finaquick_local
DATABASE_URL_RESPALDO=postgresql://finaquick_respaldo:${DB_PASSWORD_RESPALDO}@localhost:5432/finaquick_local
JWT_SECRET=${JWT_SECRET}
PORT=4000
ORIGEN_PERMITIDO=http://localhost:5173,http://localhost:5183
FRONTEND_URL=http://localhost:5173
EOF
    echo "servidor/api/.env generado con credenciales propias de esta instalación."
    echo "(Para conectar el login de Microsoft, edita ese archivo — ver LOCAL_SETUP.md)"
  fi

  DB_LISTA=true
fi

if [ ! -d node_modules ]; then
  echo "Preparando el frontend (solo la primera vez, tarda unos minutos)..."
  npm install --silent
fi

if [ ! -f .env.local ] && [ -f demo.env ]; then
  cp demo.env .env.local
fi

if [ "$DB_LISTA" = true ]; then
  if [ ! -d servidor/api/node_modules ]; then
    echo "Preparando el servidor (solo la primera vez)..."
    (cd servidor/api && npm install --silent)
  fi
  echo "Iniciando el servidor..."
  (cd servidor/api && npm run dev > /tmp/finaquick_servidor.log 2>&1 &)
  sleep 2
fi

echo ""
echo "Abriendo Finaquick en tu navegador..."
echo "(Para cerrarlo, vuelve a esta ventana y presiona Ctrl+C)"
echo ""

# Espera a que Vite imprima la URL real (el puerto puede variar) y
# abre el navegador justo ahí, en vez de adivinar el puerto.
npm run dev 2>&1 | tee /tmp/finaquick-dev.log &
DEV_PID=$!

for i in $(seq 1 30); do
  URL=$(grep -o 'http://localhost:[0-9]*' /tmp/finaquick-dev.log | head -1)
  if [ -n "$URL" ]; then
    open "$URL"
    break
  fi
  sleep 1
done

wait $DEV_PID
