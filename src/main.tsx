import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./lib/auth/AuthContext";
import { OrgProvider } from "./lib/theme/OrgContext";
import { NotificationsProvider } from "./lib/notifications/NotificationsContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
