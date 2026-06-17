import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AgentMode =
  | "assistant-only"
  | "side-by-side"
  | "immersive"
  | "basic-website";

export const AGENT_MODES: { id: AgentMode; label: string }[] = [
  { id: "basic-website", label: "Native Storefront" },
  { id: "assistant-only", label: "Sidecar assistant" },
  { id: "side-by-side", label: "Side by side assistant" },
  { id: "immersive", label: "Immersive" },
];

export type DemoViewportMode = "desktop" | "mobile";

type AgentModeContextValue = {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  viewportMode: DemoViewportMode;
  setViewportMode: (mode: DemoViewportMode) => void;
};

const AgentModeContext = createContext<AgentModeContextValue | undefined>(undefined);

export function AgentModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AgentMode>("assistant-only");
  const [viewportMode, setViewportMode] = useState<DemoViewportMode>(() => {
    if (typeof window === "undefined") return "desktop";
    const saved = window.localStorage.getItem("agent-demo-viewport-mode");
    return saved === "mobile" ? "mobile" : "desktop";
  });

  const value = useMemo(
    () => ({ mode, setMode, viewportMode, setViewportMode }),
    [mode, viewportMode],
  );

  return <AgentModeContext.Provider value={value}>{children}</AgentModeContext.Provider>;
}

export function useAgentMode(): AgentModeContextValue {
  const ctx = useContext(AgentModeContext);
  if (!ctx) {
    throw new Error("useAgentMode must be used within an AgentModeProvider");
  }
  return ctx;
}
