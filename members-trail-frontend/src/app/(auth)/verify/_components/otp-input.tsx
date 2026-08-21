"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Six-box OTP field. Handles paste, backspace-to-previous and arrow keys, and
 * exposes a single string upward so callers don't manage per-digit state.
 */
export function OtpInput({
  value, onChange, length = 6, autoFocus = true, invalid, disabled, label = "Verification code",
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setDigit = (i: number, d: string) => {
    const next = value.split("");
    next[i] = d;
    const joined = next.join("").slice(0, length);
    onChange(joined);
    if (d && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!digits) return;
    onChange(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={onPaste}>
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={`Digit ${i + 1} of ${length}`}
            value={value[i] ?? ""}
            onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => onKeyDown(i, e)}
            className={cn(
              "tnum size-12 rounded-xl border bg-surface-3 text-center text-lg font-semibold text-text-primary",
              "transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-4 sm:size-14",
              invalid
                ? "border-critical-500 focus:border-critical-500 focus:ring-critical-500/15"
                : "border-border-default focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]",
              disabled && "opacity-50",
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}
