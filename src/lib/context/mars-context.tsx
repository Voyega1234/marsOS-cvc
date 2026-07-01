"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type MarsMode = "front" | "workspace";

interface MarsContextValue {
  mode: MarsMode;
  setMode: (m: MarsMode) => void;
  enterWorkspace: () => void;
  enterFront: () => void;
  // When set, MarsFrontChat will open this session (or null = new chat) on mount
  pendingSessionId: string | null | undefined; // undefined = no pending action
  triggerNewChat: () => void;
  triggerOpenSession: (id: string) => void;
  clearPending: () => void;
}

const MarsContext = createContext<MarsContextValue>({
  mode: "front",
  setMode: () => {},
  enterWorkspace: () => {},
  enterFront: () => {},
  pendingSessionId: undefined,
  triggerNewChat: () => {},
  triggerOpenSession: () => {},
  clearPending: () => {},
});

export function MarsProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<MarsMode>(() => {
    if (typeof window === "undefined") return "front";
    return (sessionStorage.getItem("mars_mode") as MarsMode) ?? "front";
  });

  // undefined = no action pending; null = open new chat; string = open session id
  const [pendingSessionId, setPendingSessionId] = useState<string | null | undefined>(undefined);

  function setMode(m: MarsMode) {
    sessionStorage.setItem("mars_mode", m);
    setModeState(m);
  }

  return (
    <MarsContext.Provider
      value={{
        mode,
        setMode,
        enterWorkspace: () => setMode("workspace"),
        enterFront: () => setMode("front"),
        pendingSessionId,
        triggerNewChat: () => {
          setPendingSessionId(null);
          setMode("front");
        },
        triggerOpenSession: (id: string) => {
          setPendingSessionId(id);
          setMode("front");
        },
        clearPending: () => setPendingSessionId(undefined),
      }}
    >
      {children}
    </MarsContext.Provider>
  );
}

export function useMars() {
  return useContext(MarsContext);
}
