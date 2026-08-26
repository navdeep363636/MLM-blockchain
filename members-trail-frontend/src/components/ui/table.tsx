"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Return a comparable value to enable sorting on this column. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  /** Hide below the given breakpoint to keep mobile tables readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

const hideMap = {
  sm: "hidden sm:table-cell", md: "hidden md:table-cell",
  lg: "hidden lg:table-cell", xl: "hidden xl:table-cell",
} as const;

export function DataTable<T>({
  columns, rows, keyOf, empty, loading, pageSize = 0, onRowClick, className, dense,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, index: number) => string;
  empty?: { title: string; description?: string; action?: React.ReactNode };
  loading?: boolean;
  /** 0 disables pagination. */
  pageSize?: number;
  onRowClick?: (row: T) => void;
  className?: string;
  dense?: boolean;
  caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const out = [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort, columns]);

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pageCount - 1);
  const visible = pageSize > 0 ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" },
    );

  const pad = dense ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className={cn("w-full", className)}>
      {/* The scroll container is also the depth boundary: a wide table scrolls
          inside its own frame rather than pushing the page sideways. */}
      <div className="overflow-x-auto rounded-[var(--radius-card)]">
        <table className="w-full min-w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border-default bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface-2)_55%,transparent),transparent)]">
              {columns.map((c) => {
                const sortable = !!c.sortValue;
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      pad, "whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-text-muted",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      c.hideBelow && hideMap[c.hideBelow],
                      c.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "inline-flex items-center gap-1.5 transition-colors hover:text-text-primary",
                          active && "text-[var(--accent-hover)]",
                          c.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                        ) : (
                          <ArrowDown className="size-3 opacity-25" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: pageSize || 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    {columns.map((c) => (
                      <td key={c.key} className={cn(pad, c.hideBelow && hideMap[c.hideBelow])}>
                        <Skeleton className="h-4 w-full max-w-28" />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row, i) => (
                  <tr
                    key={keyOf(row, i)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "group/row relative border-b border-border-subtle last:border-0",
                      "transition-colors duration-[var(--dur-quick)] ease-[var(--ease-tide)]",
                      /* A tilt on a table row is motion sickness. The row hover
                         treatment is therefore flat: a warm wash, a lit left
                         edge, and the first cell nudging in by 2px — enough to
                         track your place across a wide table without the page
                         moving under you. */
                      onRowClick
                        ? "cursor-pointer hover:bg-[color-mix(in_oklab,var(--accent)_5%,var(--surface-2))]"
                        : "hover:bg-surface-2/60",
                    )}
                  >
                    {columns.map((c, ci) => (
                      <td
                        key={c.key}
                        className={cn(
                          pad, "relative text-text-secondary align-middle",
                          ci === 0 &&
                            "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-center before:scale-y-0 " +
                            "before:rounded-full before:bg-[var(--accent)] before:transition-transform before:duration-300 " +
                            "before:ease-[var(--ease-tide)] group-hover/row:before:scale-y-100 " +
                            "transition-[padding] duration-[var(--dur-quick)] group-hover/row:pl-[calc(var(--spacing)*4+2px)]",
                          c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                          c.hideBelow && hideMap[c.hideBelow],
                          c.className,
                        )}
                      >
                        {c.cell(row, current * (pageSize || 0) + i)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!loading && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <span
            className="grid size-14 place-items-center rounded-full bg-surface-2 text-text-muted
                       ring-1 ring-inset ring-border-subtle
                       [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e2)]"
          >
            <Inbox className="size-6" />
          </span>
          <p className="text-sm font-medium text-text-primary">{empty?.title ?? "Nothing here yet"}</p>
          {empty?.description && <p className="max-w-sm text-sm text-text-muted">{empty.description}</p>}
          {empty?.action && <div className="mt-2">{empty.action}</div>}
        </div>
      )}

      {pageSize > 0 && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
          <p className="tnum text-xs text-text-muted">
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={current === 0}
              aria-label="Previous page"
              className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="tnum px-2 text-xs font-medium text-text-secondary">
              {current + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={current >= pageCount - 1}
              aria-label="Next page"
              className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
