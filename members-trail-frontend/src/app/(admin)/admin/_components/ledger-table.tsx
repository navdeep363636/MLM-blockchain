"use client";

/* Ledger wrapper — a titled panel around a DataTable. Every admin table on the
 * platform goes through here so captions, density and empty states match. */

import { DataTable, type Column } from "@/components/ui";
import { Panel } from "./panel";

export function LedgerTable<T>({
  title, description, icon, action, columns, rows, keyOf, caption, loading, pageSize = 12,
  onRowClick, empty, footnote, dense = true, className, tone,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, index: number) => string;
  /** sr-only table caption — mandatory. */
  caption: string;
  loading?: boolean;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string; action?: React.ReactNode };
  footnote?: React.ReactNode;
  dense?: boolean;
  className?: string;
  tone?: "default" | "critical" | "warning";
}) {
  return (
    <Panel
      title={title}
      description={description}
      icon={icon}
      action={action}
      footnote={footnote}
      padded={false}
      className={className}
      tone={tone}
    >
      <DataTable
        columns={columns}
        rows={rows}
        keyOf={keyOf}
        caption={caption}
        loading={loading}
        pageSize={pageSize}
        onRowClick={onRowClick}
        empty={empty}
        dense={dense}
      />
    </Panel>
  );
}
