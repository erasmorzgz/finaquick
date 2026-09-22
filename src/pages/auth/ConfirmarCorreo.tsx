import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import * as db from "../../lib/db";

export default function ConfirmarCorreo() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setError("Este enlace no trae la información necesaria.");
      return;
    }
    db.confirmarCorreo(token)
      .then(() => setEstado("listo"))
      .catch((err) => {
        setEstado("error");
        setError(err instanceof Error ? err.message : "No se pudo confirmar el correo.");
      });
  }, [token]);

  return (
    <AuthLayout>
      {estado === "cargando" && <p className="text-center text-sm text-[var(--color-text-secondary)]">Confirmando tu correo…</p>}

      {estado === "listo" && (
        <div className="text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-green-500" />
          <h1 className="text-xl font-extrabold text-[var(--color-text-primary)]">Correo confirmado</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Ya puedes cerrar esta pantalla e iniciar sesión normalmente.</p>
          <Link to="/login" className="mt-5 inline-block font-bold text-[var(--color-text-primary)] hover:underline">
            Ir a iniciar sesión
          </Link>
        </div>
      )}

      {estado === "error" && (
        <div className="text-center">
          <h1 className="text-xl font-extrabold text-[var(--color-text-primary)]">No se pudo confirmar</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{error}</p>
          <Link to="/login" className="mt-5 inline-block font-bold text-[var(--color-text-primary)] hover:underline">
            Ir a iniciar sesión
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
