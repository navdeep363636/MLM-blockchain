"use client";

/* One filter row, reused by every queue and ledger in the back office. */

import { RotateCcw } from "lucide-react";
import { Button, SearchInput, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface FilterSpec {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}

export function FilterBar({
  search, onSearchChange, searchPlaceholder = "Search…", filters = [], children,
  onReset, shown, total, unit = "records", className,
}: {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  filters?: FilterSpec[];
  children?: React.ReactNode;
  onReset?: () => void;
  shown?: number;
  total?: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 px-4 py-3.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-3">
        {onSearchChange && (
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Search</label>
            <SearchInput
              value={search ?? ""}
              onValueChange={onSearchChange}
              placeholder={searchPlaceholder}
            />
          </div>
        )}
        {filters.map((f) => (
          <div key={f.label} className={cn("w-full sm:w-44", f.className)}>
            <Select
              label={f.label}
              value={f.value}
              onChange={(e) => f.onChange(e.target.value)}
              options={f.options}
              className="h-10"
            />
          </div>
        ))}
        {children}
        {onReset && (
          <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
      {shown != null && total != null && (
        <p className="mt-3 text-xs text-text-muted">
          Showing <span className="tnum font-semibold text-text-secondary">{shown}</span> of{" "}
          <span className="tnum">{total}</span> {unit}
        </p>
      )}
    </div>
  );
}
