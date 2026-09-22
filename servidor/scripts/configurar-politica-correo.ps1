# Restringe el permiso de Microsoft Graph "Mail.Send" de esta
# aplicación a un solo buzón — sin esto, el permiso alcanza por
# default para enviar correo a nombre de CUALQUIER cuenta del tenant
# de Microsoft 365 de la institución, no solo la configurada en
# MICROSOFT_CORREO_ENVIO (ver SECURITY.md y LOCAL_SETUP.md, sección 4).
#
# Requiere el módulo de PowerShell de Exchange Online y una cuenta con
# permisos de administrador global o de Exchange — correrlo una sola
# vez, después de haber completado el registro de la aplicación en
# Microsoft Entra ID (LOCAL_SETUP.md, secciones 3 y 4).
#
# Uso:
#   1. Completa las dos variables de abajo.
#   2. Ejecuta este script completo en PowerShell.

# --- Completar antes de ejecutar ---
$AppId = "PEGA-AQUI-EL-MICROSOFT_CLIENT_ID"
$BuzonPermitido = "notificaciones@institucion.mx"  # el mismo valor que MICROSOFT_CORREO_ENVIO
# ------------------------------------

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
    Write-Host "Instalando el módulo de administración de Exchange Online (una sola vez)..."
    Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force
}

Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline

New-ApplicationAccessPolicy `
    -AppId $AppId `
    -PolicyScopeGroupId $BuzonPermitido `
    -AccessRight RestrictAccess `
    -Description "Finaquick: solo puede enviar correo desde este buzón, no desde ningún otro del tenant."

Write-Host ""
Write-Host "Política creada. Verificando que quedó bien configurada..."
Write-Host ""

# Debe decir "Granted" para el buzón permitido...
Write-Host "Prueba contra el buzón permitido ($BuzonPermitido) — debe decir 'Granted':"
Test-ApplicationAccessPolicy -AppId $AppId -Identity $BuzonPermitido

Write-Host ""
Write-Host "Prueba contra un buzón cualquiera de la institución — debe decir 'Denied'."
Write-Host "Reemplaza el correo de abajo por el de alguien más de la institución y corre:"
Write-Host '  Test-ApplicationAccessPolicy -AppId "' $AppId '" -Identity "otra.persona@institucion.mx"'

Disconnect-ExchangeOnline -Confirm:$false
