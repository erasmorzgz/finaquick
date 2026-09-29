// Adaptado de beUI (beui.dev) — licencia MIT, ver LICENCIAS_DE_TERCEROS.md.
import { createContext } from "react";

export type MessageSide = "start" | "end";

export const MessageSideContext = createContext<MessageSide | undefined>(
  undefined,
);
