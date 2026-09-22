import { useEffect, useState } from "react";
import { AuthLayout } from "./AuthLayout";
import { Button } from "../../components/ui/Button";

// A donde Microsoft (vía servidor/api/src/microsoft.ts) redirige de
// vuelta después de iniciar sesión. Cuatro casos: llegó bien y ya hay
// cookie de sesión completa (recarga completa, no navigate() de React
// Router, para que AuthContext arranque de cero y la recoja); la
// cuenta tiene 2FA activo y el servidor mandó un tokenPre en vez de la
// cookie (se manda a /login, que ya sabe pedir el código con ese mismo
// token — mismo flujo que el login normal con 2FA, ver Login.tsx);
// reauth2fa, cuando esto no fue un login sino una reautenticación para
// activar 2FA en una cuenta sin contraseña propia (se manda de vuelta
// al perfil, que sabe terminar la configuración con ese token — ver
// Profile.tsx); o Microsoft/el servidor mandaron ?error=... y lo
// mostramos aquí.
export default function MicrosoftCompletado() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      setError(err);
      return;
    }
    // tokenPre/reauth2fa viajan en el fragmento (#), no en la URL
    // normal — el navegador nunca los manda a ningún servidor, así que
    // solo se leen aquí mismo, del lado del cliente.
    const fragmento = new URLSearchParams(window.location.hash.slice(1));
    const tokenPre = fragmento.get("tokenPre");
    if (tokenPre) {
      window.location.href = `/login#tokenPre=${encodeURIComponent(tokenPre)}`;
      return;
    }
    const reauth2fa = fragmento.get("reauth2fa");
    if (reauth2fa) {
      window.location.href = `/app/perfil#reauth2fa=${encodeURIComponent(reauth2fa)}`;
      return;
    }
    window.location.href = "/";
  }, []);

  return (
    <AuthLayout>
      {error ? (
        <div className="text-center">
          <h1 className="text-xl font-extrabold text-[var(--color-text-primary)]">No se pudo iniciar sesión</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{error}</p>
          <Button className="mt-5" fullWidth onClick={() => (window.location.href = "/login")}>
            Volver a intentar
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-[var(--color-text-secondary)]">Completando inicio de sesión…</p>
      )}
    </AuthLayout>
  );
}
