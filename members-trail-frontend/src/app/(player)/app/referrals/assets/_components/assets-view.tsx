"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban, Check, Copy, Download, FileText, Image as ImageIcon, PlaySquare,
  ShieldCheck, TriangleAlert, X,
} from "lucide-react";
import {
  Badge, Button, Callout, PillTabs, useToast,
} from "@/components/ui";
import { RevealGroup, RevealItem, SpotlightCard } from "@/components/fx";
import { useReferralSummary } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";

type Kind = "banner" | "social" | "video" | "copy";

interface Asset {
  id: string;
  kind: Kind;
  name: string;
  spec: string;
  hue: number;
  ratio: string;
}

const ASSETS: Asset[] = [
  { id: "AS-1", kind: "banner", name: "Leaderboard banner", spec: "728 × 90 · PNG, SVG", hue: 24, ratio: "aspect-[728/90]" },
  { id: "AS-2", kind: "banner", name: "Medium rectangle", spec: "300 × 250 · PNG, SVG", hue: 40, ratio: "aspect-[300/250]" },
  { id: "AS-3", kind: "banner", name: "Wide skyscraper", spec: "300 × 600 · PNG", hue: 12, ratio: "aspect-[300/600]" },
  { id: "AS-4", kind: "social", name: "Instagram square", spec: "1080 × 1080 · PNG", hue: 200, ratio: "aspect-square" },
  { id: "AS-5", kind: "social", name: "Story / Reel", spec: "1080 × 1920 · PNG", hue: 288, ratio: "aspect-[9/16]" },
  { id: "AS-6", kind: "social", name: "X / Twitter card", spec: "1200 × 675 · PNG", hue: 160, ratio: "aspect-[16/9]" },
  { id: "AS-7", kind: "video", name: "Gameplay montage", spec: "15s · 1080p MP4", hue: 96, ratio: "aspect-video" },
  { id: "AS-8", kind: "video", name: "How it works explainer", spec: "45s · 1080p MP4", hue: 340, ratio: "aspect-video" },
];

/** Pre-approved captions. None contains an income, earnings or return claim. */
const CAPTIONS: { id: string; label: string; text: string }[] = [
  {
    id: "C-1",
    label: "Short and neutral",
    text: "I've been playing skill games on Members Trail. Free to join, no deposit needed — take a look if you're curious.",
  },
  {
    id: "C-2",
    label: "Game-focused",
    text: "If you like puzzle and strategy games, Members Trail runs ranked events where everyone gets the same board and the same rules. Free entry available.",
  },
  {
    id: "C-3",
    label: "For the sceptical",
    text: "Members Trail publishes where its reward money comes from — real platform revenue, with the funding split shown on-chain. Worth a read even if you don't play.",
  },
  {
    id: "C-4",
    label: "Tournament shout",
    text: "Weekly ranked tournaments on Members Trail. Prize splits and rules are published before entry, and there are free-entry events too.",
  },
];

const RULES_OK = [
  "Describe the games, the formats and how Points work.",
  "Say that joining is free and that no deposit is required.",
  "Link to the tokenomics, Risk Disclosure or transparency reports.",
  "Share your own honest experience of playing, without figures.",
];

const RULES_NOT = [
  "State or imply guaranteed, fixed or typical earnings.",
  "Present your own commission screenshots as achievable results.",
  "Use \"passive income\", \"financial freedom\" or investment framing.",
  "Suggest that recruiting is required to earn or withdraw.",
  "Claim Members Trail is an investment, or promise a return on MTT.",
];

function AssetArt({ hue, ratio, label }: { hue: number; ratio: string; label: string }) {
  const h2 = (hue + 48) % 360;
  return (
    <div
      className={cn("relative w-full overflow-hidden", ratio)}
      style={{
        backgroundColor: `hsl(${hue} 30% 10%)`,
        backgroundImage:
          `radial-gradient(circle at 22% 28%, hsl(${hue} 80% 58% / 0.5), transparent 60%),` +
          `radial-gradient(circle at 78% 76%, hsl(${h2} 72% 50% / 0.42), transparent 62%)`,
      }}
      aria-hidden
    >
      <div className="absolute inset-0 grid place-items-center">
        <span className="rounded-lg bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/85 backdrop-blur-sm">
          Members Trail
        </span>
      </div>
      <span className="absolute bottom-1.5 right-2 text-[9px] font-medium text-white/45">{label}</span>
    </div>
  );
}

export function AssetsView() {
  const { data: summary } = useReferralSummary();
  const toast = useToast();
  const [kind, setKind] = useState<Kind | "all">("all");

  const shown = ASSETS.filter((a) => kind === "all" || a.kind === kind);

  const copyCaption = async (text: string) => {
    const withLink = `${text}\n\n${summary.link}`;
    try {
      await navigator.clipboard.writeText(withLink);
      toast.success("Caption copied", "Your referral link is appended.");
    } catch {
      toast.error("Couldn't copy", "Select the text and copy it manually.");
    }
  };

  return (
    <>
      <Callout tone="warning" title="These assets are pre-approved. Your own wording may not be." icon={<ShieldCheck />} className="mb-5">
        <p className="mt-1">
          Everything here has been reviewed to contain no income or earnings claims. Using it as-is
          keeps you compliant with the{" "}
          <Link href="/legal/referral-terms">Referral Program Terms</Link>. Writing your own
          copy is allowed, but unsubstantiated income claims can cost you the programme and any
          pending commission.
        </p>
      </Callout>

      {/* Compliance rules — the most important content on this page */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-good-500/30 bg-surface-1 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-good-500/12 text-good-400">
              <Check className="size-4" />
            </span>
            <h2 className="text-sm font-semibold text-text-primary">You may say</h2>
          </div>
          <ul className="mt-3.5 space-y-2.5">
            {RULES_OK.map((r) => (
              <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                <Check className="mt-0.5 size-4 shrink-0 text-good-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[var(--radius-card)] border border-critical-500/30 bg-surface-1 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-critical-500/12 text-critical-400">
              <Ban className="size-4" />
            </span>
            <h2 className="text-sm font-semibold text-text-primary">You must never say</h2>
          </div>
          <ul className="mt-3.5 space-y-2.5">
            {RULES_NOT.map((r) => (
              <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                <X className="mt-0.5 size-4 shrink-0 text-critical-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Captions */}
      <h2 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Pre-approved captions</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {CAPTIONS.map((c) => (
          <div key={c.id} className="flex flex-col rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="neutral">{c.label}</Badge>
              <Badge tone="good" dot>Approved</Badge>
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-text-secondary">&ldquo;{c.text}&rdquo;</p>
            <Button
              size="xs"
              variant="secondary"
              className="mt-3 self-start"
              onClick={() => copyCaption(c.text)}
              icon={<Copy className="size-3.5" />}
            >
              Copy with my link
            </Button>
          </div>
        ))}
      </div>

      {/* Asset library */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Asset library</h2>
        <PillTabs
          value={kind}
          onValueChange={(v) => setKind(v as Kind | "all")}
          items={[
            { value: "all", label: "All", count: ASSETS.length },
            { value: "banner", label: "Banners", count: ASSETS.filter((a) => a.kind === "banner").length },
            { value: "social", label: "Social", count: ASSETS.filter((a) => a.kind === "social").length },
            { value: "video", label: "Video", count: ASSETS.filter((a) => a.kind === "video").length },
          ]}
        />
      </div>

      <RevealGroup className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => (
          <RevealItem key={a.id}>
            <SpotlightCard className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
              <div className="grid max-h-56 place-items-center overflow-hidden bg-surface-inset p-4">
                <div className="w-full max-w-[15rem]">
                  <AssetArt hue={a.hue} ratio={a.ratio} label={a.spec.split(" · ")[0]} />
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-text-primary">{a.name}</h3>
                    <p className="mt-0.5 text-xs text-text-muted">{a.spec}</p>
                  </div>
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 text-text-muted">
                    {a.kind === "video" ? <PlaySquare className="size-3.5" /> : a.kind === "copy" ? <FileText className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                  </span>
                </div>
                <div className="mt-3 flex gap-2 pt-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    fullWidth
                    icon={<Download className="size-3.5" />}
                    onClick={() => toast.info("Download queued", `${a.name} will download with your code embedded.`)}
                  >
                    Download
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => copyCaption(CAPTIONS[0].text)}
                    icon={<Copy className="size-3.5" />}
                  >
                    Caption
                  </Button>
                </div>
              </div>
            </SpotlightCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <Callout tone="critical" title="What happens if you make income claims" icon={<TriangleAlert />} className="mt-6">
        <p className="mt-1">
          Unsubstantiated earnings claims are the single most common reason referral programmes attract
          regulatory action — which is why we treat them as a breach rather than a style issue. A first
          instance means removal of your assets and a warning; repeated or egregious claims mean removal
          from the programme and forfeiture of pending commission. If you&apos;re unsure whether a phrase
          is acceptable, ask support before you post it.
        </p>
      </Callout>
    </>
  );
}
