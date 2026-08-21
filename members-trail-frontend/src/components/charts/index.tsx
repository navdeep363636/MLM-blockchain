"use client";

/* ============================================================================
 * Chart system. Built on Recharts, themed against the semantic CSS roles in
 * globals.css. The categorical palette (--series-1..8) is validated for
 * colour-vision deficiency; series are assigned in slot order and never cycled.
 *
 * Rules enforced here so callers can't get them wrong:
 *   - one y-axis only (no dual-axis charts)
 *   - a legend whenever there are >= 2 series
 *   - a table view toggle on every frame (the relief rule for low-contrast
 *     slots, and the accessibility fallback)
 *   - recessive grid and axes, thin marks, tabular figures
 *   - a hover layer by default
 * ========================================================================== */

import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { cn, formatCompact, formatNumber } from "@/lib/utils";

export const SERIES_VARS = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
] as const;

/** Slot order is the CVD-safety mechanism — index in, never modulo-cycle past 8. */
export const seriesColor = (i: number) => SERIES_VARS[Math.min(i, SERIES_VARS.length - 1)];

export const SEQ_VARS = [
  "var(--seq-100)", "var(--seq-200)", "var(--seq-300)",
  "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-650)",
] as const;

const axisProps = {
  stroke: "var(--axis-line)",
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/* ------------------------------- Tooltip --------------------------------- */

interface TipPayload { name?: string; value?: number; color?: string; dataKey?: string | number }

function ChartTooltip({
  active, payload, label, valueFormatter, labelFormatter,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  valueFormatter?: (v: number) => string;
  labelFormatter?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  const fmt = valueFormatter ?? ((v: number) => formatNumber(v, { maximumFractionDigits: 2 }));
  return (
    <div className="rounded-xl border border-border-default bg-surface-2/95 px-3 py-2 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.85)] backdrop-blur">
      {label != null && (
        <p className="mb-1.5 text-xs font-medium text-text-muted">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            {/* value wears a text token, never the series colour */}
            <span className="tnum font-semibold text-text-primary">{fmt(Number(p.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ ChartFrame ------------------------------- */

export interface SeriesDef {
  key: string;
  label: string;
  /** Override the palette slot. Use only for status-meaning series. */
  color?: string;
}

export function ChartFrame({
  title, description, action, children, data, series, xKey, valueFormatter,
  className, height = 280, footnote, allowTable = true,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Passing data+series+xKey enables the table view toggle. */
  data?: Record<string, unknown>[];
  series?: SeriesDef[];
  xKey?: string;
  valueFormatter?: (v: number) => string;
  className?: string;
  height?: number;
  footnote?: React.ReactNode;
  allowTable?: boolean;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const canTable = allowTable && !!data && !!series && !!xKey;
  const fmt = valueFormatter ?? ((v: number) => formatNumber(v, { maximumFractionDigits: 2 }));

  return (
    <div className={cn("rounded-[var(--radius-card)] border border-border-subtle bg-surface-1", className)}>
      {(title || action || canTable) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {action}
            {canTable && (
              <button
                onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
                aria-label={view === "chart" ? "Show data as table" : "Show chart"}
                title={view === "chart" ? "Show data as table" : "Show chart"}
                className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                {view === "chart" ? <Table2 className="size-4" /> : <LineIcon className="size-4" />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Legend — always present for >= 2 series, so identity is never colour-alone */}
      {series && series.length >= 2 && view === "chart" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-2">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="size-2 rounded-[2px]" style={{ background: s.color ?? seriesColor(i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {view === "chart" ? (
        <div className="px-2 pb-3" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-72 overflow-auto px-5 pb-4">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="border-b border-border-default">
                <th className="py-2 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {xKey}
                </th>
                {series!.map((s) => (
                  <th key={s.key} className="py-2 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="py-2 text-text-secondary">{String(row[xKey!])}</td>
                  {series!.map((s) => (
                    <td key={s.key} className="tnum py-2 text-right text-text-primary">
                      {fmt(Number(row[s.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footnote && <p className="border-t border-border-subtle px-5 py-2.5 text-xs text-text-muted">{footnote}</p>}
    </div>
  );
}

/* ------------------------------ Chart types ------------------------------ */

/** Area trend — change over time. Crosshair + tooltip by default. */
export function AreaTrend({
  data, series, xKey, valueFormatter, stacked, height = 280, ...frame
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  valueFormatter?: (v: number) => string;
  stacked?: boolean;
  height?: number;
} & Omit<Parameters<typeof ChartFrame>[0], "children" | "data" | "series" | "xKey" | "height">) {
  return (
    <ChartFrame data={data} series={series} xKey={xKey} valueFormatter={valueFormatter} height={height} {...frame}>
      <AreaChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 4 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color ?? seriesColor(i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => formatCompact(Number(v))} width={46} />
        <Tooltip
          content={<ChartTooltip valueFormatter={valueFormatter} />}
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "4 4" }}
        />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "1" : undefined}
            stroke={s.color ?? seriesColor(i)}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
            dot={false}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function LineSeries({
  data, series, xKey, valueFormatter, height = 280, ...frame
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  valueFormatter?: (v: number) => string;
  height?: number;
} & Omit<Parameters<typeof ChartFrame>[0], "children" | "data" | "series" | "xKey" | "height">) {
  return (
    <ChartFrame data={data} series={series} xKey={xKey} valueFormatter={valueFormatter} height={height} {...frame}>
      <LineChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => formatCompact(Number(v))} width={46} />
        <Tooltip
          content={<ChartTooltip valueFormatter={valueFormatter} />}
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "4 4" }}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? seriesColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

/** Bars — magnitude comparison. 4px rounded data-ends, anchored to baseline. */
export function BarSeries({
  data, series, xKey, valueFormatter, stacked, horizontal, height = 280, ...frame
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  xKey: string;
  valueFormatter?: (v: number) => string;
  stacked?: boolean;
  horizontal?: boolean;
  height?: number;
} & Omit<Parameters<typeof ChartFrame>[0], "children" | "data" | "series" | "xKey" | "height">) {
  return (
    <ChartFrame data={data} series={series} xKey={xKey} valueFormatter={valueFormatter} height={height} {...frame}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 14, left: 4, bottom: 4 }}
        barGap={2}
        barCategoryGap="22%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v) => formatCompact(Number(v))} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} tickFormatter={(v) => formatCompact(Number(v))} width={46} />
          </>
        )}
        <Tooltip
          content={<ChartTooltip valueFormatter={valueFormatter} />}
          cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "1" : undefined}
            fill={s.color ?? seriesColor(i)}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            /* 2px surface gap between stacked segments and adjacent bars */
            stroke="var(--surface-1)"
            strokeWidth={stacked ? 2 : 0}
            maxBarSize={horizontal ? 22 : 48}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Donut — part-to-whole for a small number of slices (allocation buckets). */
export function DonutBreakdown({
  data, valueFormatter, height = 280, innerLabel, innerValue, ...frame
}: {
  data: { name: string; value: number; color?: string }[];
  valueFormatter?: (v: number) => string;
  height?: number;
  innerLabel?: string;
  innerValue?: string;
} & Omit<Parameters<typeof ChartFrame>[0], "children" | "data" | "series" | "xKey" | "height">) {
  const series = useMemo<SeriesDef[]>(
    () => data.map((d, i) => ({ key: d.name, label: d.name, color: d.color ?? seriesColor(i) })),
    [data],
  );
  const tableData = useMemo(() => data.map((d) => ({ Bucket: d.name, [d.name]: d.value })), [data]);

  return (
    <ChartFrame
      data={tableData}
      series={series}
      xKey="Bucket"
      valueFormatter={valueFormatter}
      height={height}
      {...frame}
    >
      <PieChart>
        <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="88%"
          paddingAngle={2}
          stroke="var(--surface-1)"
          strokeWidth={2}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? seriesColor(i)} />
          ))}
        </Pie>
        {(innerLabel || innerValue) && (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
            {innerValue && (
              <tspan x="50%" dy="-0.2em" className="tnum" fill="var(--text-primary)" fontSize="18" fontWeight="650">
                {innerValue}
              </tspan>
            )}
            {innerLabel && (
              <tspan x="50%" dy="1.5em" fill="var(--text-muted)" fontSize="11">
                {innerLabel}
              </tspan>
            )}
          </text>
        )}
      </PieChart>
    </ChartFrame>
  );
}

/** Inline sparkline — no axes, no legend, no tooltip. For stat tiles only. */
export function Sparkline({
  data, dataKey = "value", color = "var(--series-1)", height = 36, className,
}: {
  data: Record<string, unknown>[];
  dataKey?: string;
  color?: string;
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${dataKey}-${color.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${dataKey}-${color.replace(/\W/g, "")})`}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export { Legend };
