"use client";

import { forwardRef, useId, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================================================================
 * Inputs are the one family in the system that reads as PRESSED IN rather than
 * raised: the shadow is on the inside, the top edge is dark instead of lit.
 * That is the whole convention — anything you can put something into looks
 * carved out, anything that acts on the world looks raised. It means a form is
 * legible as a form before a single label is read.
 * ========================================================================== */
const fieldBase =
  "w-full rounded-xl border border-border-default bg-surface-inset px-3.5 text-sm text-text-primary " +
  "[box-shadow:inset_0_1px_3px_-1px_rgb(0_0_0_/_0.4),inset_0_0_0_1px_rgb(0_0_0_/_0.06)] " +
  "placeholder:text-text-muted " +
  "transition-[border-color,box-shadow,background-color] duration-[var(--dur-quick)] ease-[var(--ease-tide)] " +
  "hover:border-border-strong " +
  /* On focus the field fills with light and lifts to flush — the caret's
     arrival is confirmed by the surface, not only by the ring. */
  "focus:border-[var(--accent)] focus:bg-surface-3 focus:outline-none " +
  "focus:[box-shadow:0_0_0_4px_var(--accent-soft),inset_0_1px_0_0_var(--rim-light)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Field({
  label, hint, error, required, children, htmlFor, className,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | false | null;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-medium text-text-secondary">
          {label}
          {required && <span className="text-[var(--accent)]">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-critical-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | false | null;
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, suffix, className, id, required, ...props }, ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted [&>svg]:size-4">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          className={cn(
            fieldBase, "h-11",
            icon && "pl-10",
            suffix && "pr-20",
            error && "border-critical-500 focus:border-critical-500 focus:[box-shadow:0_0_0_4px_color-mix(in_oklab,var(--color-critical-500)_18%,transparent)]",
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-text-muted">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
});

export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={show ? "text" : "password"} className={cn("pr-11", props.className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className={cn(
          "absolute right-3 text-text-muted transition-colors hover:text-text-primary",
          props.label ? "top-[2.35rem]" : "top-1/2 -translate-y-1/2",
        )}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: React.ReactNode; hint?: React.ReactNode; error?: string | false | null }
>(function Textarea({ label, hint, error, className, id, required, ...props }, ref) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={tid}>
      <textarea ref={ref} id={tid} className={cn(fieldBase, "min-h-24 resize-y py-2.5", className)} {...props} />
    </Field>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | false | null;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, id, required, ...props }, ref,
) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={sid}>
      <div className="relative">
        <select
          ref={ref}
          id={sid}
          className={cn(fieldBase, "h-11 cursor-pointer appearance-none pr-10", className)}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      </div>
    </Field>
  );
});

export function SearchInput({
  value, onValueChange, placeholder = "Search…", className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, "h-10 pl-10")}
      />
    </div>
  );
}

export function Checkbox({
  label, checked, onCheckedChange, className, disabled, id,
}: {
  label?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <button
        type="button"
        role="checkbox"
        id={cid}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-all duration-200",
          checked
            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
            : "border-border-strong bg-surface-inset [box-shadow:inset_0_1px_2px_-1px_rgb(0_0_0_/_0.4)] hover:border-[var(--accent)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {checked && <Check className="size-3 stroke-[3]" />}
      </button>
      {label && (
        <label htmlFor={cid} className="cursor-pointer text-sm leading-snug text-text-secondary">
          {label}
        </label>
      )}
    </div>
  );
}

export function Switch({
  checked, onCheckedChange, label, description, disabled, className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      {(label || description) && (
        <div className="min-w-0">
          {label && <p className="text-sm font-medium text-text-primary">{label}</p>}
          {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : "Toggle"}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
          checked
            ? "bg-[linear-gradient(180deg,var(--accent-hover),var(--accent))] [box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.28),0_0_14px_-2px_var(--accent-ring)]"
            : "bg-surface-inset ring-1 ring-border-strong [box-shadow:inset_0_1px_3px_-1px_rgb(0_0_0_/_0.45)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-transform duration-300 ease-[var(--ease-spring)]",
            "[box-shadow:0_1px_2px_rgb(0_0_0_/_0.45),inset_0_-1px_1px_rgb(0_0_0_/_0.12)]",
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value, onValueChange, min = 0, max = 100, step = 1, label, formatValue, className,
}: {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: React.ReactNode;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-text-secondary">{label}</span>
          <span className="tnum text-sm font-semibold text-text-primary">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        aria-label={typeof label === "string" ? label : "Slider"}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
          [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_var(--accent)]
          [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110
          [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--surface-3) ${pct}%)`,
        }}
      />
    </div>
  );
}

/** Segmented radio group — used for withdrawal type, timeframes, filters. */
export function SegmentedControl<T extends string>({
  value, onValueChange, options, className, size = "md",
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-2xl border border-border-subtle bg-surface-inset p-1",
        "[box-shadow:inset_0_1px_3px_-1px_rgb(0_0_0_/_0.4)]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg font-medium transition-all duration-200",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              active
                ? "bg-[linear-gradient(180deg,var(--accent-hover),var(--accent))] text-white " +
                  "[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.3),0_6px_16px_-8px_color-mix(in_oklab,var(--accent)_75%,transparent)]"
                : "text-text-muted hover:bg-surface-2 hover:text-text-primary",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
