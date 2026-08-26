"use client";

import { useState } from "react";
import {
  Banknote, Building2, CheckCircle2, Copy, CreditCard, Info, Landmark, ShieldCheck,
  Smartphone, TriangleAlert, Wallet,
} from "lucide-react";
import {
  Badge, Button, Callout, DataTable, DetailRow, Input, Modal, SegmentedControl,
  StatusPill, useToast, type Column,
} from "@/components/ui";
import { useBalances, useTransactions } from "@/lib/hooks/use-data";
import { useCreateDeposit } from "@/lib/hooks/use-mutations";
import { humanMessage } from "@/lib/api/errors";
import { MTT_SYMBOL } from "@/lib/web3";
import { copyToClipboard, formatCurrency, formatDate, formatToken } from "@/lib/utils";
import type { Transaction } from "@/types";
import { RelativeTime } from "../../../_components/time";

type Method = "card" | "upi" | "bank" | "crypto";

const METHODS: { value: Method; label: string; icon: React.ReactNode; note: string; settle: string }[] = [
  { value: "card", label: "Card", icon: <CreditCard className="size-3.5" />, note: "Visa, Mastercard, RuPay", settle: "Instant on gateway confirmation" },
  { value: "upi", label: "UPI", icon: <Smartphone className="size-3.5" />, note: "India only", settle: "Usually under 2 minutes" },
  { value: "bank", label: "Bank transfer", icon: <Building2 className="size-3.5" />, note: "NEFT / IMPS / wire", settle: "1–2 business days" },
  { value: "crypto", label: "Crypto", icon: <Wallet className="size-3.5" />, note: "BNB or USDT on BSC", settle: "After block confirmations" },
];

const PRESETS = [500, 1_000, 2_500, 5_000];
const DEPOSIT_ADDRESS = "0x8401927F4D9d9Ff475D555E057De4E2c563cd9F6";

export function DepositView() {
  const { data: balances } = useBalances();
  const { data: txs } = useTransactions();
  const toast = useToast();
  const createDeposit = useCreateDeposit();

  const [method, setMethod] = useState<Method>("card");
  const [amount, setAmount] = useState(1_000);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const active = METHODS.find((m) => m.value === method)!;
  const deposits = txs.filter((t) => t.type === "deposit");

  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: "Date",
      cell: (t) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(t.date, true)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={t.date} /></span>
        </span>
      ),
      sortValue: (t) => t.date,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (t) => (
        <span className="tnum font-medium text-text-primary">
          {t.amountFiat != null ? formatCurrency(t.amountFiat) : `${formatToken(Math.abs(t.amountMtt))} ${MTT_SYMBOL}`}
        </span>
      ),
      sortValue: (t) => t.amountFiat ?? Math.abs(t.amountMtt),
    },
    { key: "status", header: "Status", align: "right", cell: (t) => <StatusPill status={t.status} /> },
    {
      key: "ref",
      header: "Ref",
      align: "right",
      hideBelow: "md",
      cell: (t) => <span className="font-mono-num text-xs text-text-muted">{t.id}</span>,
    },
  ];

  const start = async () => {
    setBusy(true);
    try {
      /* Creates a payment INTENT. The deposit is not credited here and must not
       * appear as though it were — the provider's webhook is what settles it, and
       * the screen says "pending" until that arrives. */
      await createDeposit.mutateAsync({
        method,
        amountFiat: String(amount),
        currency: "INR",
      });
      setConfirmOpen(false);
      setPending(true);
    } catch (err) {
      toast.error("Couldn't start that deposit", humanMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Callout tone="info" title="What a deposit is for" icon={<Info />} className="mb-5">
        <p className="mt-1">
          Deposits buy Point boosts, tournament credits and store items. They are{" "}
          <strong className="text-text-primary">not</strong> a stake, an investment or a deposit that
          earns yield — Members Trail never pays returns on money you put in. Staking rewards come
          from platform revenue, and gameplay earning requires no deposit at all.
        </p>
      </Callout>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
              <Banknote className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Add funds</h2>
              <p className="text-xs text-text-muted">Choose a payment method</p>
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Method</p>
            <SegmentedControl
              value={method}
              onValueChange={setMethod}
              size="sm"
              options={METHODS.map((m) => ({ value: m.value, label: m.label, icon: m.icon }))}
            />
            <p className="mt-2 text-xs text-text-muted">
              {active.note} · {active.settle}
            </p>
          </div>

          {method === "crypto" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Deposit address (BSC / BEP-20)
                </p>
                <p className="font-mono-num mt-2 break-all text-sm text-text-secondary">{DEPOSIT_ADDRESS}</p>
                <Button
                  size="xs"
                  variant="ghost"
                  className="mt-2"
                  icon={<Copy className="size-3.5" />}
                  onClick={async () => {
                    if (await copyToClipboard(DEPOSIT_ADDRESS)) toast.success("Address copied");
                  }}
                >
                  Copy address
                </Button>
              </div>
              <Callout tone="critical" title="BEP-20 only" icon={<TriangleAlert />}>
                <p className="mt-1">
                  Send only BNB or USDT on BNB Smart Chain to this address. Tokens sent on any other
                  network are unrecoverable. Deposits are credited only after the required block
                  confirmations and reconciliation — never on a screenshot.
                </p>
              </Callout>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Amount</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold text-text-muted">₹</span>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={amount}
                    onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                    aria-label="Deposit amount"
                    className="tnum w-full bg-transparent font-display text-3xl font-semibold tracking-tight text-text-primary outline-none"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setAmount(p)}
                      className={
                        amount === p
                          ? "rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white"
                          : "rounded-lg bg-surface-3 px-2.5 py-1 text-xs font-medium text-text-secondary ring-1 ring-inset ring-border-default transition-colors hover:ring-border-strong"
                      }
                    >
                      ₹{p.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>
              </div>

              {method === "bank" && (
                <Input
                  label="Your reference (optional)"
                  placeholder="Shown on your bank statement"
                  hint="Helps us reconcile your transfer faster if the sender name differs."
                />
              )}

              <Button
                fullWidth
                size="lg"
                disabled={amount < 100}
                onClick={() => setConfirmOpen(true)}
              >
                Continue to payment
              </Button>
              {amount < 100 && (
                <p className="text-center text-xs text-text-muted">Minimum deposit is ₹100.</p>
              )}
            </div>
          )}

          <Callout tone="warning" title="Nothing credits on client confirmation" icon={<ShieldCheck />} className="mt-5">
            <p className="mt-1">
              Every deposit is reconciled against the payment gateway&apos;s webhook or settlement data
              before your balance changes. If a payment succeeds at your bank but the callback hasn&apos;t
              arrived, the deposit shows as processing until reconciliation completes.
            </p>
          </Callout>
        </div>

        <div className="space-y-5">
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <Landmark className="size-4" />
              </span>
              <h3 className="text-sm font-semibold text-text-primary">Your deposit funds the Treasury</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              A published share of net revenue from purchases flows into the Revenue Treasury — the
              pool that funds staking rewards and referral commissions for everyone. That is the
              mechanism by which player payouts stay solvent: they come from spending on the platform,
              not from new members joining.
            </p>
            <dl className="mt-4 border-t border-border-subtle pt-1">
              <DetailRow label="In-app purchases" value="30% of net to Treasury" />
              <DetailRow label="Tournament rake" value="20% of net" />
              <DetailRow label="Subscriptions" value="30% of net" />
            </dl>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
            <div className="border-b border-border-subtle px-5 py-4">
              <h3 className="text-sm font-semibold text-text-primary">Deposit history</h3>
              <p className="mt-0.5 text-xs text-text-muted">Status reflects gateway reconciliation, not submission.</p>
            </div>
            <DataTable
              columns={columns}
              rows={deposits}
              keyOf={(t) => t.id}
              pageSize={6}
              dense
              caption="Your deposit history"
              empty={{ title: "No deposits yet", description: "You never need to deposit to earn — gameplay and staking are free to access." }}
            />
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm payment"
        description="You'll be redirected to our PCI-DSS compliant processor."
        icon={<CreditCard className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={start}>Proceed to payment</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Method" value={active.label} />
            <DetailRow label="Amount" value={formatCurrency(amount, "INR")} />
            <DetailRow label="Settlement" value={active.settle} />
            <DetailRow label="Processor" value="PCI-DSS compliant gateway" />
          </div>
          <Callout tone="info" title="We never see your card details" icon={<ShieldCheck />}>
            <p className="mt-1">
              Card data is captured by the processor, not by Members Trail. We receive only a token
              and a settlement reference.
            </p>
          </Callout>
        </div>
      </Modal>

      <Modal
        open={pending}
        onClose={() => setPending(false)}
        title="Deposit processing"
        icon={<CheckCircle2 className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" href="/app/wallet/history">View history</Button>
            <Button onClick={() => setPending(false)}>Done</Button>
          </>
        }
      >
        <div className="py-2 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning-500/12 text-warning-400">
            <Info className="size-7" />
          </span>
          <p className="mt-4 font-semibold text-text-primary">Awaiting gateway confirmation</p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
            {formatCurrency(amount, "INR")} via {active.label}. Your balance updates once the
            processor callback is reconciled — {active.settle.toLowerCase()}.
          </p>
          <Badge tone="warning" className="mt-4" dot>Processing</Badge>
        </div>
      </Modal>
    </>
  );
}
