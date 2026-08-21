"use client";

import { useMemo, useState } from "react";
import { Calculator, Info, TriangleAlert } from "lucide-react";
import { Badge, Callout, CapMeter, InfoHint, SegmentedControl, Slider } from "@/components/ui";
import { formatToken } from "@/lib/utils";
import { commissionConfig } from "@/lib/mock/admin";

const TRIGGERS = [
  { value: "iap", label: "In-app purchase" },
  { value: "tournament_entry", label: "Tournament entry" },
  { value: "subscription", label: "Premium Pass" },
] as const;

/**
 * Illustrative commission calculator (FRD R-03). Deliberately shows the cap
 * biting and states that the result is not a projection of earnings.
 */
export function CommissionCalculator() {
  const [spend, setSpend] = useState(3_000);
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]["value"]>("iap");
  const [ownSpend, setOwnSpend] = useState(1_200);
  const [alreadyEarned, setAlreadyEarned] = useState(1_800);

  const rates = commissionConfig.levels;

  const monthlyCap = useMemo(
    () =>
      Math.min(
        commissionConfig.monthlyCapAbsolute,
        commissionConfig.monthlyCapMultiplier * ownSpend + commissionConfig.monthlyCapBase,
      ),
    [ownSpend],
  );

  const rows = useMemo(() => {
    let running = alreadyEarned;
    return rates.map((l) => {
      const gross = (spend * l.ratePct) / 100;
      const headroom = Math.max(0, monthlyCap - running);
      const paid = Math.min(gross, headroom);
      running += paid;
      return { level: l.level, ratePct: l.ratePct, gross, paid, capped: gross - paid };
    });
  }, [spend, rates, monthlyCap, alreadyEarned]);

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalCapped = totalGross - totalPaid;

  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1">
      <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
          <Calculator className="size-5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Worked example</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Change the inputs to see exactly how a commission is derived — and where the cap stops it.
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Transaction type
            </p>
            <SegmentedControl
              value={trigger}
              onValueChange={setTrigger}
              size="sm"
              options={TRIGGERS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Only these three real-money events are eligible. Points conversions, staking deposits
              and stake principal are never commissionable.
            </p>
          </div>

          <Slider
            label="Referred player's eligible spend"
            value={spend}
            onValueChange={setSpend}
            min={100}
            max={20_000}
            step={100}
            formatValue={(v) => `₹${formatToken(v, 0)}`}
          />

          <Slider
            label="Your own trailing 3-month average spend"
            value={ownSpend}
            onValueChange={setOwnSpend}
            min={0}
            max={12_000}
            step={100}
            formatValue={(v) => `₹${formatToken(v, 0)}`}
          />

          <Slider
            label="Commission you've already earned this month"
            value={alreadyEarned}
            onValueChange={setAlreadyEarned}
            min={0}
            max={monthlyCap}
            step={100}
            formatValue={(v) => `₹${formatToken(v, 0)}`}
          />

          <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Your monthly cap
                <InfoHint>
                  min( absolute cap ₹{formatToken(commissionConfig.monthlyCapAbsolute, 0)},
                  {" "}{commissionConfig.monthlyCapMultiplier} × your own average monthly spend
                  + ₹{formatToken(commissionConfig.monthlyCapBase, 0)} base allowance )
                </InfoHint>
              </p>
              <p className="tnum text-sm font-semibold text-text-primary">₹{formatToken(monthlyCap, 0)}</p>
            </div>
            <CapMeter
              className="mt-3"
              used={Math.min(alreadyEarned + totalPaid, monthlyCap)}
              cap={monthlyCap}
              unit="₹"
              label="After this transaction"
            />
          </div>
        </div>

        <div>
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            <table className="w-full text-sm">
              <caption className="sr-only">Commission by referral level for the entered spend</caption>
              <thead>
                <tr className="border-b border-border-default bg-surface-inset">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Level</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Rate</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Calculated</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Payable</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.level} className="border-b border-border-subtle last:border-0">
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: `var(--series-${r.level})` }}
                        />
                        <span className="font-medium text-text-primary">Level {r.level}</span>
                      </span>
                    </td>
                    <td className="tnum px-3 py-3 text-right text-text-secondary">{r.ratePct}%</td>
                    <td className="tnum px-3 py-3 text-right text-text-secondary">₹{formatToken(r.gross)}</td>
                    <td className="tnum px-3 py-3 text-right font-semibold text-text-primary">
                      ₹{formatToken(r.paid)}
                      {r.capped > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-warning-400">capped</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-inset">
                  <td colSpan={2} className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Total across 3 levels
                  </td>
                  <td className="tnum px-3 py-3 text-right text-text-secondary">₹{formatToken(totalGross)}</td>
                  <td className="tnum px-3 py-3 text-right font-semibold text-[var(--accent-hover)]">
                    ₹{formatToken(totalPaid)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {totalCapped > 0 && (
            <Callout tone="warning" title="The cap is doing its job" icon={<TriangleAlert />} className="mt-4">
              <p className="mt-1">
                ₹{formatToken(totalCapped)} of the calculated commission is not payable because it
                would exceed your monthly cap. Capped amounts are not carried over to next month.
              </p>
            </Callout>
          )}

          <Callout tone="info" title="How this gets funded" icon={<Info />} className="mt-4">
            <p className="mt-1">
              Even inside your cap, a commission is only credited if the commission pool has been
              funded from reconciled revenue. If the pool is short, the entry queues and pays once
              the next Treasury deposit lands. The distributor contract reverts rather than
              overpaying — that check is on-chain, not a policy.
            </p>
          </Callout>

          <p className="mt-4 text-xs leading-relaxed text-text-muted">
            <Badge tone="neutral" className="mr-1.5">Illustration only</Badge>
            These figures are arithmetic on inputs you chose. They are not a projection, forecast or
            representation of what you will earn. Most participants in any referral programme earn
            little or nothing.
          </p>
        </div>
      </div>
    </div>
  );
}
