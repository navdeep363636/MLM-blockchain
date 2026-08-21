"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      className={cn(
        "relative grid size-10 place-items-center overflow-hidden rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary",
        className,
      )}
    >
      <Sun className={cn("absolute size-4 transition-all duration-400", resolved === "light" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0")} />
      <Moon className={cn("absolute size-4 transition-all duration-400", resolved === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
    </button>
  );
}
