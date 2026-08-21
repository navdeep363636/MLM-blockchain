"use client";

/* Who is operating the back-office, and what time is it. Both are seams:
 * in production the staff member comes from the admin session cookie and the
 * clock from the server. Nothing here is hard-coded — the staff record is
 * resolved out of the staff directory hook. */

import { useEffect, useState } from "react";
import { useStaff } from "@/lib/hooks/use-data";
import { REFERENCE_NOW } from "@/lib/utils";
import type { StaffMember } from "@/types";

export interface Session {
  me: StaffMember | undefined;
  colleagues: StaffMember[];
  /** Staff who may act as the second pair of eyes: active, 2FA on, not me. */
  approvers: StaffMember[];
  isLoading: boolean;
}

export function useSession(): Session {
  const { data: staff, isLoading } = useStaff();
  const me = staff.find((s) => s.role === "finance_admin" && s.active) ?? staff[0];
  const colleagues = staff.filter((s) => s.id !== me?.id);
  return {
    me,
    colleagues,
    approvers: colleagues.filter((s) => s.active && s.twoFactorEnabled),
    isLoading,
  };
}

/**
 * Ticking clock for SLA countdowns.
 *
 * Seeded with REFERENCE_NOW rather than Date.now(): a lazy `useState(() =>
 * Date.now())` initialiser still runs during the server render, so the server
 * and client produce different countdown text and hydration fails. Starting
 * from a shared constant makes the first render identical in both
 * environments, then the effect switches to the real clock and ticks.
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(REFERENCE_NOW);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
