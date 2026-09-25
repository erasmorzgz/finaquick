@echo off
setlocal enabledelayedexpansion
title Finaquick
cd /d "%~dp0"

echo ===========================================
echo   Finaquick - iniciando todo en local
echo ===========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Falta Node.js. Descargalo gratis de https://nodejs.org ^(version LTS^) e instalalo.
    echo Despues, vuelve a hacer doble clic en este archivo.
    pause
    exit /b 1
)

rem -- Busca psql en el PATH normal y, si no esta ahi, en las carpetas
rem -- tipicas del instalador oficial de postgresql.org (que normalmente
rem -- si se agrega solo al PATH, pero por si acaso no haya sido asi).
rem -- Revisa CUALQUIER version instalada ahi (no una lista fija de
rem -- numeros) para que siga funcionando con versiones futuras de
rem -- PostgreSQL sin tener que actualizar este script cada vez. --
set DB_LISTA=0
where psql >nul 2>nul
if %errorlevel% neq 0 (
    for /d %%v in ("C:\Program Files\PostgreSQL\*") do (
        if exist "%%v\bin\psql.exe" (
            set "PATH=%%v\bin;%PATH%"
            goto :pg_encontrado
        )
    )
)
:pg_encontrado
where psql >nul 2>nul
if %errorlevel% neq 0 (
    echo -------------------------------------------------------
    echo   No encontre PostgreSQL instalado - solo se va a
    echo   abrir la parte visual, sin base de datos conectada.
    echo.
    echo   Instala PostgreSQL ^(postgresql.org/download/windows^)
    echo   y vuelve a abrir esto para tenerlo todo.
    echo -------------------------------------------------------
    echo.
) else (
    if not exist "servidor\api\.env" (
        echo Preparando la base de datos ^(solo la primera vez^)...

        rem -- Con que usuario de PostgreSQL conectarse. En Mac
        rem -- (Homebrew) el superusuario suele ser el mismo usuario del
        rem -- sistema operativo, sin contrasena -- pero en Windows (el
        rem -- instalador de postgresql.org, casi universal ahi) el
        rem -- superusuario SIEMPRE se llama "postgres" y pide
        rem -- contrasena, sin importar el nombre de quien inicio sesion
        rem -- en Windows. Sin esto, psql/createdb intentaban conectarse
        rem -- con el usuario de Windows (que no existe en PostgreSQL) y
        rem -- se quedaban pidiendo una contrasena que nunca iba a
        rem -- funcionar -- encontrado probando la instalacion real en
        rem -- Windows. "-w" evita que cada intento se quede esperando
        rem -- una contrasena a ciegas -- falla rapido si hace falta una.
        set "PGCONNECT_TIMEOUT=5"
        psql -d postgres -c "select 1" -w >nul 2>nul
        if !errorlevel! neq 0 (
            set PGUSER=postgres
            psql -d postgres -c "select 1" -w >nul 2>nul
            if !errorlevel! neq 0 (
                echo.
                echo PostgreSQL pide la contrasena del superusuario "postgres"
                echo ^(la que se puso al instalar PostgreSQL^) para preparar
                echo la base de datos la primera vez.
                set /p PGPASSWORD="Contrasena de postgres: "
                psql -d postgres -c "select 1" -w >nul 2>nul
                if !errorlevel! neq 0 (
                    echo.
                    echo No se pudo conectar a PostgreSQL con esa contrasena
                    echo ^(o el servicio de PostgreSQL no esta corriendo^).
                    echo Revisa la contrasena y vuelve a abrir esto, o hazlo
                    echo a mano ^(ver LOCAL_SETUP.md, paso 1^).
                    pause
                    exit /b 1
                )
            )
        )

        rem -- Genera credenciales propias para esta instalacion con
        rem -- aleatoriedad de verdad (crypto.randomBytes de Node, no
        rem -- %RANDOM%, que no sirve para esto), via un script
        rem -- temporal en vez de "node -e" en linea, para no pelear
        rem -- con como cmd anida comillas dentro de un bloque. --
        set "GENJS=%TEMP%\finaquick_gen_secreto.js"
        echo console.log^(require^('crypto'^).randomBytes^(Number^(process.argv[2]^)^).toString^('hex'^)^) > "!GENJS!"

        for /f "delims=" %%s in ('node "!GENJS!" 48') do set JWT_SECRET=%%s
        for /f "delims=" %%s in ('node "!GENJS!" 24') do set DB_PASSWORD=%%s
        for /f "delims=" %%s in ('node "!GENJS!" 24') do set DB_PASSWORD_RESPALDO=%%s
        del "!GENJS!" >nul 2>nul

        createdb finaquick_local 2>nul
        rem -- "!errorlevel!" (con expansion tardia), no "%errorlevel%" --
        rem -- esta linea vive dentro del mismo bloque ^(...^) que createdb,
        rem -- y cmd.exe lee TODO el bloque de una vez antes de correr
        rem -- ninguna linea de adentro -- %errorlevel% se habria quedado
        rem -- con el valor de ANTES de que createdb corriera, no con el
        rem -- resultado real de createdb. Encontrado revisando el
        rem -- archivo letra por letra, no corriendolo (no hay Windows
        rem -- aqui) -- mismo motivo por el que el resto del archivo ya
        rem -- usa "!errorlevel!" en casos parecidos.
        if !errorlevel! equ 0 (
            echo Base de datos 'finaquick_local' creada - aplicando esquema...
            psql -d finaquick_local -f servidor\esquema_local.sql > "%TEMP%\finaquick_esquema.log" 2>&1
        ) else (
            rem -- Ya existia -- pero de una version ANTERIOR de Finaquick,
            rem -- de un zip mas viejo probando esto antes, es
            rem -- indistinguible desde aqui de una instalacion real ya
            rem -- en uso: en ambos casos "createdb" falla igual porque la
            rem -- base ya esta ahi. Sin preguntar, "no se toca su
            rem -- contenido" sonaba prudente, pero en la practica dejaba
            rem -- a alguien con una base vieja, sin las columnas o
            rem -- funciones que el codigo de hoy necesita, "listo" en
            rem -- esta consola pero sin poder ni registrarse ni guardar
            rem -- nada en la app -- sin ningun aviso de por que. Mejor
            rem -- preguntar aqui mismo que fallar en silencio despues.
            rem -- Sin parentesis en estos comentarios a proposito -- cmd.exe
            rem -- cuenta parentesis caracter por caracter para encontrar el
            rem -- cierre de un bloque de llaves, incluso dentro de un "rem",
            rem -- y uno sin escapar aqui rompia el bloque entero.
            echo.
            echo La base de datos 'finaquick_local' ya existia.
            echo Si vienes de una version anterior de Finaquick ^(otro zip, otro intento^) y no
            echo tienes datos reales ahi todavia, lo normal es borrarla y empezar de cero --
            echo si no, cosas como registrarte o guardar folios pueden fallar sin explicacion,
            echo porque le faltan columnas o funciones que esta version ya necesita.
            echo Si esta base SI tiene informacion real que quieres conservar, contesta que no.
            set "RESPUESTA_RESET="
            set /p RESPUESTA_RESET="Borrar 'finaquick_local' y crearla de nuevo? (s/N): "
            if /i "!RESPUESTA_RESET!"=="s" (
                dropdb finaquick_local
                createdb finaquick_local
                echo Base de datos 'finaquick_local' recreada - aplicando esquema...
                psql -d finaquick_local -f servidor\esquema_local.sql > "%TEMP%\finaquick_esquema.log" 2>&1
            ) else (
                echo Se deja tal cual - no se toca su contenido.
            )
        )

        rem -- Como el registro es solo por invitacion, hace falta crear
        rem -- la primera cuenta -- se pregunta aqui en vez de dejar algo
        rem -- de prueba ya metido en el esquema (eso lo debe decidir
        rem -- quien lo instale, no nosotros). Corre sin importar si la
        rem -- base de datos se acaba de crear o ya existia de un intento
        rem -- anterior -- lo unico que de verdad importa es que
        rem -- servidor\api\.env todavia no existe (osea, "esto sigue sin
        rem -- quedar listo"), sin importar en que paso se haya quedado a
        rem -- medias la vez pasada.
        echo.
        echo Primera vez usando Finaquick - hay que crear la cuenta del primer administrador.
        rem -- Sin esto, Finaquick queda corriendo por completo pero sin
        rem -- ninguna forma de entrar -- el registro es solo por
        rem -- invitacion, y sin admin no hay quien invite a nadie mas
        rem -- despues. Por eso insiste en vez de saltarse el paso con
        rem -- un campo vacio (un Enter de mas es facil que pase sin
        rem -- querer) -- encontrado probando la instalacion real.
        rem -- Ctrl+C sigue siendo la salida para quien de plano
        rem -- prefiera configurarlo despues a mano (LOCAL_SETUP.md,
        rem -- paso 4).
        call :preguntar_admin_org
        call :preguntar_admin_correo

        rem -- El codigo de invitacion es lo que de verdad prueba que
        rem -- quien se registra es a quien se le dio ese codigo - sin
        rem -- esto, cualquiera que conociera o adivinara este correo
        rem -- podia registrarlo primero. Como aca la misma persona que
        rem -- instala es quien va a registrarse, no hace falta
        rem -- relayarlo a nadie mas.
        set "GENJS=%TEMP%\finaquick_gen_secreto.js"
        echo console.log^(require^('crypto'^).randomBytes^(Number^(process.argv[2]^)^).toString^('hex'^)^) > "!GENJS!"
        for /f "delims=" %%s in ('node "!GENJS!" 12') do set ADMIN_TOKEN=%%s
        del "!GENJS!" >nul 2>nul

        rem -- Node arma el SQL (en UTF-8) en vez de pasarle el nombre a
        rem -- psql con -v: segun la pagina de codigos de la consola, un
        rem -- nombre con acento llegaba mal, las dos inserciones fallaban,
        rem -- y sin ON_ERROR_STOP psql igual salia "bien" -- la
        rem -- instalacion decia "Listo" sin haber creado la invitacion.
        node servidor\api\scripts\sql-invitacion-inicial.js "!ADMIN_ORG!" "!ADMIN_CORREO!" "!ADMIN_TOKEN!" "%TEMP%\finaquick_bootstrap.sql"
        set PGCLIENTENCODING=UTF8
        psql -d finaquick_local -v ON_ERROR_STOP=1 -f "%TEMP%\finaquick_bootstrap.sql" > "%TEMP%\finaquick_bootstrap.log" 2>&1
        set BOOTSTRAP_RESULTADO=!errorlevel!
        set PGCLIENTENCODING=
        if !BOOTSTRAP_RESULTADO! equ 0 (
            echo Listo - ya puedes registrarte en la app ^(boton Registrate^).
            echo Codigo de invitacion ^(pidelo tambien en el formulario de registro^): !ADMIN_TOKEN!
            echo.
            echo Para ver la app ya con folios y servicios de ejemplo cargados ^(util para
            echo revisarla, no para uso real^): registrate primero con lo de arriba, y
            echo despues corre "cd servidor\api" y luego "npm run demo" ^(ver LOCAL_SETUP.md, paso 5^).
        ) else (
            echo No se pudo crear la invitacion del administrador - el detalle esta en %TEMP%\finaquick_bootstrap.log.
            echo Para reintentar: borra el archivo servidor\api\.env y vuelve a abrir este archivo ^(o hazlo a mano, ver LOCAL_SETUP.md, paso 4^).
        )
        del "%TEMP%\finaquick_bootstrap.sql" >nul 2>nul

        psql -d finaquick_local -c "alter role finaquick_app password '!DB_PASSWORD!';" >nul 2>nul
        psql -d finaquick_local -c "alter role finaquick_respaldo password '!DB_PASSWORD_RESPALDO!';" >nul 2>nul

        (
            echo DATABASE_URL=postgresql://finaquick_app:!DB_PASSWORD!@localhost:5432/finaquick_local
            echo DATABASE_URL_RESPALDO=postgresql://finaquick_respaldo:!DB_PASSWORD_RESPALDO!@localhost:5432/finaquick_local
            echo JWT_SECRET=!JWT_SECRET!
            echo PORT=4000
            echo ORIGEN_PERMITIDO=http://localhost:5173,http://localhost:5183
            echo FRONTEND_URL=http://localhost:5173
        ) > servidor\api\.env

        echo servidor\api\.env generado con credenciales propias de esta instalacion.
        echo ^(Para conectar el login de Microsoft, edita ese archivo - ver LOCAL_SETUP.md^)
    )
    set DB_LISTA=1
)

if not exist node_modules (
    echo Preparando el frontend ^(solo la primera vez, tarda unos minutos^)...
    call npm install
)

if not exist .env.local (
    if exist demo.env copy demo.env .env.local >nul
)

if "!DB_LISTA!"=="1" (
    if not exist "servidor\api\node_modules" (
        echo Preparando el servidor ^(solo la primera vez^)...
        pushd servidor\api
        call npm install
        popd
    )
    echo Iniciando el servidor...
    start "Finaquick - servidor" /min /D "%~dp0servidor\api" cmd /c "npm run dev"
    timeout /t 2 /nobreak >nul
)

echo.
echo Abriendo Finaquick en tu navegador en cuanto este listo...
echo ^(Para cerrarlo del todo: presiona Ctrl+C aqui, y cierra tambien la otra ventana del servidor^)
echo.

rem -- Espera a que el frontend realmente conteste antes de abrir el
rem -- navegador, en vez de adivinar unos segundos fijos a ciegas. Se
rem -- genera como script aparte para no pelear con comillas anidadas. --
set "ABRIRBAT=%TEMP%\finaquick_abrir.bat"
(
    echo @echo off
    echo where curl ^>nul 2^>nul
    echo if errorlevel 1 ^(timeout /t 4 /nobreak ^>nul ^& start http://localhost:5173 ^& exit /b 0^)
    echo set intentos=0
    echo :intento
    echo set /a intentos+=1
    echo curl -s -o nul -m 1 http://localhost:5173
    echo if not errorlevel 1 ^(start http://localhost:5173 ^& exit /b 0^)
    echo if %%intentos%% geq 30 ^(start http://localhost:5173 ^& exit /b 0^)
    echo timeout /t 1 /nobreak ^>nul
    echo goto intento
) > "!ABRIRBAT!"
start "" /min cmd /c "!ABRIRBAT!"

call npm run dev
goto :eof

rem ================================================================
rem Subrutinas -- todo lo de arriba termina en "goto :eof" antes de
rem llegar aqui, asi que esto nunca se ejecuta por accidente durante
rem el flujo normal.
rem ================================================================

:preguntar_admin_org
set "ADMIN_ORG="
set /p ADMIN_ORG="Nombre de la institucion (ej. Universidad Anahuac): "
if "!ADMIN_ORG!"=="" (
    echo El nombre de la institucion no puede quedar vacio -- Finaquick necesita al menos una cuenta de administrador para poder usarse. Vuelve a intentar, o cierra esta ventana ^(Ctrl+C^) si prefieres configurarlo despues a mano ^(ver LOCAL_SETUP.md, paso 4^).
    goto preguntar_admin_org
)
goto :eof

:preguntar_admin_correo
set "ADMIN_CORREO="
set /p ADMIN_CORREO="Correo del primer administrador: "
if "!ADMIN_CORREO!"=="" (
    echo El correo del administrador no puede quedar vacio -- Finaquick necesita al menos una cuenta de administrador para poder usarse. Vuelve a intentar, o cierra esta ventana ^(Ctrl+C^) si prefieres configurarlo despues a mano ^(ver LOCAL_SETUP.md, paso 4^).
    goto preguntar_admin_correo
)
goto :eof
