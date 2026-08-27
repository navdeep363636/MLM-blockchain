/* Shared visual step sequence: Play → Points → MTT → Stake → Withdraw.
 * Static (server-safe). The expandable version lives in how-it-works/_components. */

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui";
import { HoloCard, RevealGroup, RevealItem } from "@/components/fx";
import { cn } from "@/lib/utils";
import { IconTile } from "./feature-card";

export interface FlowStep {
  n: number;
  title: string;
  summary: string;
  icon: React.ReactNode;
  optional?: boolean;
}

export function StepFlow({ steps, className }: { steps: FlowStep[]; className?: string }) {
  return (
    <div className="scene relative">
      <RevealGroup className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
        {steps.map((s, i) => (
          <RevealItem key={s.n} className="h-full">
            <HoloCard max={5} lift={18} className="h-full rounded-[var(--radius-card)]">
              <div
                className={cn(
                  "group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface-1 p-5",
                  "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
                  "holo transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-tide)]",
                  "hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-default))]",
                  "hover:[box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]",
                  s.optional ? "border-dashed border-border-default" : "border-border-subtle",
                )}
              >
                {/* The step number, set large and low-contrast behind the copy.
                    It is the depth cue that says "this card is one of four". */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-4 -right-1 select-none font-display text-[5.5rem] font-bold leading-none text-border-subtle/70
                             transition-[transform,color] duration-[var(--dur-slow)] ease-[var(--ease-tide)]
                             group-hover:-translate-y-1 group-hover:text-[color-mix(in_oklab,var(--accent)_18%,transparent)]"
                >
                  {String(s.n).padStart(2, "0")}
                </span>

                <div className="relative flex items-center justify-between gap-3">
                  <IconTile>{s.icon}</IconTile>
                  <span className="tnum font-display text-sm font-semibold tracking-widest text-text-muted">
                    STEP {String(s.n).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="relative mt-4 flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-text-primary">
                  {s.title}
                  {s.optional && <Badge tone="neutral">Optional</Badge>}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-text-secondary">{s.summary}</p>

                {i < steps.length - 1 && (
                  <ArrowRight
                    aria-hidden
                    className="absolute -right-3 top-1/2 hidden size-5 -translate-y-1/2 text-border-strong
                               transition-[transform,color] duration-[var(--dur-base)] group-hover:translate-x-0.5 group-hover:text-[var(--accent)] lg:block"
                  />
                )}
              </div>
            </HoloCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
