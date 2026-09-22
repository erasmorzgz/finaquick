import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ServiceProvider, useService } from "./lib/service/ServiceContext";
import { RequireAuth, RequireRole, RequireService, FullscreenSpinner } from "./lib/auth/Guards";
import { useAuth } from "./lib/auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { ServiceIcon } from "./components/ui/ServiceIcon";

// Cada página se carga bajo demanda: la ruta que el usuario visita es la
// única que baja al navegador, en vez de un solo bundle con todo (incluida
// la librería de gráficas, que solo hace falta en Finanzas).
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const MicrosoftCompletado = lazy(() => import("./pages/auth/MicrosoftCompletado"));
const OlvidePassword = lazy(() => import("./pages/auth/OlvidePassword"));
const RestablecerPassword = lazy(() => import("./pages/auth/RestablecerPassword"));
const ConfirmarCorreo = lazy(() => import("./pages/auth/ConfirmarCorreo"));
const ServicePicker = lazy(() => import("./pages/ServicePicker"));
const NewTicket = lazy(() => import("./pages/tickets/NewTicket"));
const History = lazy(() => import("./pages/tickets/History"));
const Activity = lazy(() => import("./pages/tickets/Activity"));
const Credits = lazy(() => import("./pages/tickets/Credits"));
const CashClose = lazy(() => import("./pages/tickets/CashClose"));
const Requisiciones = lazy(() => import("./pages/tickets/Requisiciones"));
const Profile = lazy(() => import("./pages/profile/Profile"));
const FinanceDashboard = lazy(() => import("./pages/finance/FinanceDashboard"));
const GlobalSearch = lazy(() => import("./pages/finance/GlobalSearch"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));

function Root() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/app/servicios" : "/login"} replace />;
}

function TicketShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { servicioActual } = useService();
  return (
    <AppShell
      title={title}
      subtitle={
        servicioActual ? (
          <>
            <ServiceIcon name={servicioActual.icono} size={14} /> {servicioActual.nombre}
          </>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}

export default function App() {
  return (
    <ServiceProvider>
      <Suspense fallback={<FullscreenSpinner />}>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Register />} />
          <Route path="/microsoft/completado" element={<MicrosoftCompletado />} />
          <Route path="/olvide-password" element={<OlvidePassword />} />
          <Route path="/restablecer-password" element={<RestablecerPassword />} />
          <Route path="/confirmar-correo" element={<ConfirmarCorreo />} />

          <Route
            path="/app/servicios"
            element={
              <RequireAuth>
                <ServicePicker />
              </RequireAuth>
            }
          />

          <Route
            path="/app/nuevo"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Nuevo folio">
                    <NewTicket />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />
          <Route
            path="/app/historial"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Historial">
                    <History />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />
          <Route
            path="/app/actividad"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Actividad">
                    <Activity />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />
          <Route
            path="/app/creditos"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Créditos">
                    <Credits />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />
          <Route
            path="/app/requisiciones"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Requisiciones">
                    <Requisiciones />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />
          <Route
            path="/app/cierre-caja"
            element={
              <RequireAuth>
                <RequireService>
                  <TicketShell title="Cierre de caja">
                    <CashClose />
                  </TicketShell>
                </RequireService>
              </RequireAuth>
            }
          />

          <Route
            path="/app/finanzas"
            element={
              <RequireAuth>
                <RequireRole roles={["admin", "finanzas"]}>
                  <AppShell title="Finanzas" subtitle="Desempeño financiero de todos los servicios">
                    <FinanceDashboard />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />

          <Route
            path="/app/buscar"
            element={
              <RequireAuth>
                <RequireRole roles={["admin", "finanzas"]}>
                  <AppShell title="Buscar folio" subtitle="En todos los servicios de tu organización">
                    <GlobalSearch />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />

          <Route
            path="/app/admin"
            element={
              <RequireAuth>
                <RequireRole roles={["admin"]}>
                  <AppShell title="Configuración" subtitle="Personaliza cada servicio y administra usuarios">
                    <AdminSettings />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />

          <Route
            path="/app/perfil"
            element={
              <RequireAuth>
                <AppShell title="Mi perfil">
                  <Profile />
                </AppShell>
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ServiceProvider>
  );
}
