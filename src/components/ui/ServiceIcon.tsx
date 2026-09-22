import {
  Stethoscope,
  Ruler,
  Brain,
  Salad,
  Building2,
  Scale,
  Camera,
  Palette,
  Wrench,
  BookOpen,
  Dumbbell,
  Landmark,
  Briefcase,
  Code2,
  Scissors,
  PawPrint,
  Sparkles,
  Music,
  type LucideIcon,
} from "lucide-react";

// Íconos dibujados (un solo trazo, consistente) en vez de emoji — el emoji
// como "sistema de íconos" es un atajo que se nota. Cada servicio guarda
// una clave (`icono`) que se resuelve aquí a un ícono real de la librería.
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  ruler: Ruler,
  brain: Brain,
  salad: Salad,
  building: Building2,
  scale: Scale,
  camera: Camera,
  palette: Palette,
  wrench: Wrench,
  book: BookOpen,
  dumbbell: Dumbbell,
  landmark: Landmark,
  briefcase: Briefcase,
  code: Code2,
  scissors: Scissors,
  paw: PawPrint,
  sparkles: Sparkles,
  music: Music,
};

export function ServiceIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICON_REGISTRY[name] ?? Building2;
  return <Icon size={size} className={className} strokeWidth={1.75} />;
}
