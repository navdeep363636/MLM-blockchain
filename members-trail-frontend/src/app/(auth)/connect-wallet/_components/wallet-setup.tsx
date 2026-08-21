"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Wallet,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, Modal, Steps, useToast,
} from "@/components/ui";
import { WalletConnectButton } from "@/components/web3";
import { useWallet } from "@/lib/hooks/use-web3";
import { IS_TESTNET, MTT_SYMBOL } from "@/lib/web3";
import { cn, copyToClipboard, shortenAddress } from "@/lib/utils";

type Mode = "choose" | "external" | "custodial";

/* Illustrative only — a real custodial wallet is generated server-side inside an
 * HSM/MPC service and the seed is never assembled in the browser. */
const DEMO_SEED = [
  "harbor", "velvet", "quantum", "ladder", "orbit", "saffron",
  "trellis", "mosaic", "gravel", "pioneer", "cinder", "walnut",
];
const DEMO_ADDRESS = "0x8401927F4D9d9Ff475D555E057De4E2c563cd9F6";

export function WalletSetup() {
  const toast = useToast();
  const { address, isConnected, wrongNetwork, chainName } = useWallet();
  const [mode, setMode] = useState<Mode>("choose");
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedRevealed, setSeedRevealed] = useState(false);
  const [ack, setAck] = useState({ backed: false, understood: false });
  const [created, setCreated] = useState(false);

  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) toast.success(`${what} copied`);
  };

  return (
    <div>
      <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={3} className="mb-8" />

      {mode === "choose" && (
        <div className="space-y-4">
          <button
            onClick={() => setMode("external")}
            className="group flex w-full items-start gap-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_40%,var(--border-default))]"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
              <Wallet className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold text-text-primary">
                  Connect an external wallet
                </span>
                <Badge tone="good" dot>Recommended</Badge>
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-text-muted">
                MetaMask, Trust Wallet, Rabby or anything WalletConnect supports. You keep your own
                keys — we never hold them, and we can&apos;t move your {MTT_SYMBOL} without a signature
                from you.
              </span>
            </span>
          </button>

          <button
            onClick={() => setMode("custodial")}
            className="group flex w-full items-start gap-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_40%,var(--border-default))]"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-3 text-text-secondary">
              <KeyRound className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold text-text-primary">
                  Use a platform wallet
                </span>
                <Badge tone="neutral">No app needed</Badge>
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-text-muted">
                We generate a wallet for you, with keys managed by an HSM/MPC key-management service
                — never stored in plaintext. Simpler to start with; you&apos;re trusting our custody.
              </span>
            </span>
          </button>

          <Callout tone="warning" title="This choice is hard to undo" icon={<AlertTriangle />}>
            <p className="mt-1">
              Once a wallet address is linked to your KYC-verified identity it can&apos;t be changed
              without re-verification. That&apos;s an anti-fraud control — it stops someone who
              compromises your account from redirecting your withdrawals.
            </p>
          </Callout>

          <p className="text-center text-sm">
            <Link href="/app" className="text-text-muted underline underline-offset-2 hover:text-text-primary">
              Set this up later
            </Link>
          </p>
        </div>
      )}

      {mode === "external" && (
        <div className="space-y-5">
          <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <Wallet className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-text-primary">
                  Connect your wallet
                </h2>
                <p className="text-xs text-text-muted">
                  BNB Smart Chain {IS_TESTNET ? "Testnet" : "Mainnet"}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <WalletConnectButton />
            </div>

            {isConnected && (
              <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Connected address
                    </p>
                    <p className="font-mono-num mt-1 truncate text-sm text-text-primary">
                      {shortenAddress(address, 8)}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => copy(address ?? "", "Address")}
                    icon={<Copy className="size-3.5" />}
                  >
                    Copy
                  </Button>
                </div>
                {wrongNetwork ? (
                  <Callout tone="critical" title="Wrong network" icon={<AlertTriangle />} className="mt-3">
                    <p className="mt-1">
                      Your wallet is on {chainName ?? "another chain"}. Switch to BNB Smart Chain
                      {IS_TESTNET ? " Testnet" : ""} before linking, or the address won&apos;t be usable
                      for {MTT_SYMBOL}.
                    </p>
                  </Callout>
                ) : (
                  <Badge tone="good" className="mt-3" icon={<CheckCircle2 className="size-3.5" />}>
                    Ready to link
                  </Badge>
                )}
              </div>
            )}

            <Button
              fullWidth
              size="lg"
              className="mt-5"
              disabled={!isConnected || wrongNetwork}
              onClick={() => {
                toast.success("Wallet linked", "This address is now your MTT destination.");
                window.location.href = "/app";
              }}
            >
              Link this address and finish
            </Button>
          </div>

          <Callout tone="info" title="We only ever ask for a signature" icon={<ShieldCheck />}>
            <p className="mt-1">
              Connecting grants us read access to your public address — nothing more. Every action
              that moves your tokens requires you to sign a transaction in your own wallet, where you
              can see exactly what you&apos;re approving. We will never ask for your seed phrase.
            </p>
          </Callout>

          <button
            onClick={() => setMode("choose")}
            className="w-full text-center text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            Back to wallet options
          </button>
        </div>
      )}

      {mode === "custodial" && (
        <div className="space-y-5">
          {!created ? (
            <>
              <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface-3 text-text-secondary">
                    <KeyRound className="size-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-text-primary">
                      Generate a platform wallet
                    </h2>
                    <p className="text-xs text-text-muted">Keys held in an HSM/MPC service</p>
                  </div>
                </div>

                <ul className="mt-5 space-y-3">
                  {[
                    ["Keys are never in plaintext", "Generated and held inside a key-management service. They are not in our application database, and no engineer can read them."],
                    ["You get a recovery phrase, once", "Shown a single time at creation. Write it down offline. We cannot show it to you again, and support cannot recover it for you."],
                    ["You can migrate later", "Move to a self-custody wallet whenever you want — though changing your linked address after KYC needs re-verification."],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2.5">
                      <Lock className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
                      <p className="text-sm leading-relaxed text-text-secondary">
                        <span className="font-medium text-text-primary">{t}.</span> {d}
                      </p>
                    </li>
                  ))}
                </ul>

                <Button fullWidth size="lg" className="mt-5" onClick={() => setSeedOpen(true)}>
                  Generate wallet
                </Button>
              </div>

              <button
                onClick={() => setMode("choose")}
                className="w-full text-center text-sm text-text-muted transition-colors hover:text-text-primary"
              >
                Back to wallet options
              </button>
            </>
          ) : (
            <div className="rounded-[var(--radius-panel)] border border-good-500/30 bg-surface-1 p-6 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
                <CheckCircle2 className="size-7" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Wallet created</h2>
              <p className="font-mono-num mt-3 break-all rounded-xl border border-border-subtle bg-surface-inset px-3 py-2 text-xs text-text-secondary">
                {DEMO_ADDRESS}
              </p>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
                This is your {MTT_SYMBOL} destination address. Conversions and staking rewards land
                here.
              </p>
              <Button href="/app" fullWidth size="lg" className="mt-6">Finish and go to dashboard</Button>
            </div>
          )}
        </div>
      )}

      {/* Seed backup — shown exactly once */}
      <Modal
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        title="Back up your recovery phrase"
        description="This is the only time it will ever be displayed."
        icon={<AlertTriangle className="size-5" />}
        size="md"
        hideClose
        footer={
          <>
            <Button variant="ghost" onClick={() => { setSeedOpen(false); setSeedRevealed(false); setAck({ backed: false, understood: false }); }}>
              Cancel
            </Button>
            <Button
              disabled={!ack.backed || !ack.understood || !seedRevealed}
              onClick={() => { setSeedOpen(false); setCreated(true); toast.success("Wallet created", "Your address is linked to your account."); }}
            >
              I&apos;ve saved it — continue
            </Button>
          </>
        }
      >
        <Callout tone="critical" title="Anyone with this phrase controls the wallet" icon={<AlertTriangle />}>
          <p className="mt-1">
            Write it on paper and store it somewhere private. Do not screenshot it, do not put it in
            a password manager note synced to the cloud, and never type it into any website — including
            this one. Members Trail support will never ask for it.
          </p>
        </Callout>

        <div className="relative mt-4">
          <div className={cn("grid grid-cols-3 gap-2", !seedRevealed && "blur-sm select-none")}>
            {DEMO_SEED.map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-1.5 rounded-lg border border-border-subtle bg-surface-inset px-2.5 py-2"
              >
                <span className="tnum text-[10px] text-text-muted">{i + 1}</span>
                <span className="font-mono-num text-xs text-text-primary">{w}</span>
              </div>
            ))}
          </div>
          {!seedRevealed && (
            <button
              onClick={() => setSeedRevealed(true)}
              className="absolute inset-0 grid place-items-center rounded-xl bg-surface-0/40"
            >
              <span className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary ring-1 ring-border-strong">
                <Eye className="size-4" /> Reveal phrase
              </span>
            </button>
          )}
        </div>

        {seedRevealed && (
          <div className="mt-3 flex justify-between gap-2">
            <button
              onClick={() => setSeedRevealed(false)}
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
            >
              <EyeOff className="size-3.5" /> Hide
            </button>
            <button
              onClick={() => copy(DEMO_SEED.join(" "), "Recovery phrase")}
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
            >
              <Copy className="size-3.5" /> Copy (not recommended)
            </button>
          </div>
        )}

        <div className="mt-5 space-y-3 border-t border-border-subtle pt-4">
          <Checkbox
            checked={ack.backed}
            onCheckedChange={(v) => setAck((a) => ({ ...a, backed: v }))}
            label="I have written down all 12 words, in order, offline."
          />
          <Checkbox
            checked={ack.understood}
            onCheckedChange={(v) => setAck((a) => ({ ...a, understood: v }))}
            label="I understand this phrase cannot be shown again and that support cannot recover it for me."
          />
        </div>
      </Modal>
    </div>
  );
}
