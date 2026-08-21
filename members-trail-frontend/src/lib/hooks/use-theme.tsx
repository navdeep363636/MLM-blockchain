"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

interface Ctx {
  theme: Theme;
  resolved: "dark" | "light";
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<Ctx | null>(null);
const KEY = "mt-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark-first: the platform is a gaming product and ships dark by default.
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    setThemeState(stored);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const next = theme === "system" ? (media.matches ? "light" : "dark") : theme;
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(KEY, t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  return <ThemeCtx.Provider value={{ theme, resolved, setTheme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) return { theme: "dark" as Theme, resolved: "dark" as const, setTheme: () => {}, toggle: () => {} };
  return c;
}
