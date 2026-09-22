import { useEffect } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";
import { useOrg } from "../../lib/theme/OrgContext";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { org } = useOrg();

  useEffect(() => {
    document.title = org?.nombre ? `${title} · ${org.nombre}` : `${title} · Finaquick`;
    return () => {
      document.title = "Finaquick";
    };
  }, [title, org?.nombre]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-page)] print:h-auto print:w-auto print:overflow-visible print:block">
      <Sidebar />
      <div className="ambient-glow flex min-h-0 min-w-0 flex-1 flex-col print:block print:min-h-0">
        <Topbar title={title} subtitle={subtitle} />
        <MobileNav />
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin print:overflow-visible print:h-auto">
          <div className="mx-auto w-full max-w-6xl px-5 py-6 md:px-8 md:py-8 print:max-w-none print:p-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
