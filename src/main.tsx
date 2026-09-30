import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./lib/auth/AuthProvider";
import { OrgProvider } from "./lib/theme/OrgProvider";
import { NotificationsProvider } from "./lib/notifications/NotificationsProvider";
import { AvisosProvider } from "./lib/avisos/AvisosProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <NotificationsProvider>
            <AvisosProvider>
              <App />
            </AvisosProvider>
          </NotificationsProvider>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
