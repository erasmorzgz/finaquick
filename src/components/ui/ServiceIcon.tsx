import { Building2 } from "lucide-react";
import { ICON_REGISTRY } from "./serviceIcons";
export function ServiceIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICON_REGISTRY[name] ?? Building2;
  return <Icon size={size} className={className} strokeWidth={1.75} />;
}
