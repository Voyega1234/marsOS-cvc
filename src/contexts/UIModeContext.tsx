"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { UIMode } from "@/types";

interface UIModeContextValue {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
}

const UIModeContext = createContext<UIModeContextValue>({ mode: "simple", setMode: () => {} });

export function UIModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UIMode>("simple");

  useEffect(() => {
    const saved = localStorage.getItem("ui-mode") as UIMode | null;
    if (saved === "simple" || saved === "professional") setModeState(saved);
  }, []);

  function setMode(m: UIMode) {
    setModeState(m);
    localStorage.setItem("ui-mode", m);
  }

  return <UIModeContext.Provider value={{ mode, setMode }}>{children}</UIModeContext.Provider>;
}

export function useUIMode() {
  return useContext(UIModeContext);
}
