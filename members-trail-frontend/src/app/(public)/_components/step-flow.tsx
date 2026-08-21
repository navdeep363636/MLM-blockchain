/* Shared visual step sequence: Play → Points → MTT → Stake → Withdraw.
 * Static (server-safe). The expandable version lives in how-it-works/_components. */

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
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
    <RevealGroup className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {steps.map((s, i) => (
        <RevealItem key={s.n} className="h-full">
          <div
            className={cn(
              "relative flex h-full flex-col rounded-[var(--radius-card)] border bg-surface-1 p-5",
              s.optional
                ? "border-dashed border-border-default"
                : "border-border-subtle",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <IconTile>{s.icon}</IconTile>
              <span className="tnum font-display text-3xl font-semibold text-border-strong">
                {String(s.n).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-4 flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-text-primary">
              {s.title}
              {s.optional && <Badge tone="neutral">Optional</Badge>}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{s.summary}</p>

            {i < steps.length - 1 && (
              <ArrowRight
                aria-hidden
                className="absolute -right-3 top-1/2 hidden size-5 -translate-y-1/2 text-border-strong lg:block"
              />
            )}
          </div>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
