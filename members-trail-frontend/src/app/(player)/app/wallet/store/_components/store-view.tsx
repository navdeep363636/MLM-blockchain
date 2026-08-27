"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2, Coins, Info, Landmark, Package, ShoppingBag, Sparkles, Store, Tag, Users,
} from "lucide-react";
import {
  Badge, Button, Callout, DetailRow, EmptyState, Modal, PillTabs, SegmentedControl,
  SkeletonCard, StatTile, useToast,
} from "@/components/ui";
import { RevealGroup, RevealItem, SpotlightCard } from "@/components/fx";
import { useBalances, useMarketListings, useStoreItems } from "@/lib/hooks/use-data";
import { usePurchaseStoreItem } from "@/lib/hooks/use-mutations";
import { humanMessage, isApiError } from "@/lib/api/errors";
import { MTT_SYMBOL } from "@/lib/web3";
import { cn, formatNumber, formatToken } from "@/lib/utils";
import type { MarketListing, StoreItem } from "@/types";
import { RelativeTime } from "../../../_components/time";

const RARITY: Record<StoreItem["rarity"], { label: string; tone: "neutral" | "info" | "brand" | "warning"; ring: string }> = {
  common: { label: "Common", tone: "neutral", ring: "ring-border-default" },
  rare: { label: "Rare", tone: "info", ring: "ring-[var(--series-2)]/45" },
  epic: { label: "Epic", tone: "brand", ring: "ring-[var(--series-7)]/45" },
  legendary: { label: "Legendary", tone: "warning", ring: "ring-[var(--series-4)]/50" },
};

/** Procedural item art — deterministic from the item's hue. */
function ItemArt({ hue, name, className }: { hue: number; name: string; className?: string }) {
  const h2 = (hue + 52) % 360;
  return (
    <div
      className={cn("relative grid aspect-square w-full place-items-center overflow-hidden", className)}
      style={{
        backgroundColor: `hsl(${hue} 32% 10%)`,
        backgroundImage:
          `radial-gradient(circle at 30% 25%, hsl(${hue} 78% 58% / 0.5), transparent 58%),` +
          `radial-gradient(circle at 72% 78%, hsl(${h2} 72% 52% / 0.4), transparent 60%)`,
      }}
      aria-hidden
    >
      <span
        className="size-1/3 rotate-45 rounded-lg"
        style={{
          background: `linear-gradient(140deg, hsl(${hue} 85% 66%), hsl(${h2} 75% 46%))`,
          boxShadow: `0 0 28px hsl(${hue} 85% 60% / 0.5)`,
        }}
      />
      <span className="absolute bottom-2 left-2 text-[10px] font-semibold uppercase tracking-wider text-white/60">
        {name.slice(0, 2)}
      </span>
    </div>
  );
}

export function StoreView() {
  const { data: items, isLoading } = useStoreItems();
  const { data: listings } = useMarketListings();
  const { data: balances } = useBalances();
  const toast = useToast();
  const purchase = usePurchaseStoreItem();

  const [surface, setSurface] = useState<"store" | "market">("store");
  const [category, setCategory] = useState("all");
  const [buying, setBuying] = useState<StoreItem | null>(null);
  const [bidding, setBidding] = useState<MarketListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [owned, setOwned] = useState<Record<string, boolean>>({});

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(items.map((i) => i.category)))],
    [items],
  );

  const shown = items.filter((i) => category === "all" || i.category === category);
  const isOwned = (i: StoreItem) => owned[i.id] ?? i.owned ?? false;

  const canAfford = (i: StoreItem) =>
    i.priceMtt != null ? balances.mttAvailable >= i.priceMtt : balances.points >= (i.pricePoints ?? 0);

  const buy = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      await purchase.mutateAsync({
        itemId: buying.id,
        /* Which balance to spend. An item can be priced in both, and letting the
         * server choose would sometimes spend MTT when the member expected to
         * spend Points. */
        payWith: buying.priceMtt != null ? "mtt" : "points",
      });
      setOwned((o) => ({ ...o, [buying.id]: true }));
      toast.success("Purchase complete", `${buying.name} added to your inventory.`);
      setBuying(null);
    } catch (err) {
      toast.error(
        isApiError(err) && err.code === "INSUFFICIENT_BALANCE"
          ? "Not enough balance"
          : "Purchase failed",
        humanMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Points balance" value={balances.points} icon={<Sparkles />} deltaLabel="Spendable on Points-priced items" compact />
        <StatTile label={`${MTT_SYMBOL} available`} value={balances.mttAvailable} decimals={2} icon={<Coins />} deltaLabel="Spendable on MTT-priced items" compact />
        <StatTile label="Items owned" value={items.filter(isOwned).length} icon={<Package />} deltaLabel={`of ${items.length} in the catalog`} compact />
      </div>

      <Callout tone="info" title="Marketplace fees fund the Treasury" icon={<Landmark />} className="mt-5">
        <p className="mt-1">
          A published share of peer-to-peer marketplace fee revenue flows into the Revenue Treasury,
          which is what funds staking rewards and referral commissions. Trading here contributes to
          the same pool that pays everyone out.
        </p>
      </Callout>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={surface}
          onValueChange={setSurface}
          options={[
            { value: "store", label: "Store", icon: <Store className="size-3.5" /> },
            { value: "market", label: "P2P marketplace", icon: <Users className="size-3.5" /> },
          ]}
        />
        {surface === "store" && (
          <PillTabs
            value={category}
            onValueChange={setCategory}
            items={categories.map((c) => ({
              value: c,
              label: c === "all" ? "All items" : c.charAt(0).toUpperCase() + c.slice(1),
              count: c === "all" ? items.length : items.filter((i) => i.category === c).length,
            }))}
          />
        )}
      </div>

      {surface === "store" ? (
        isLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-72" />)}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            className="mt-6 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
            icon={<ShoppingBag />}
            title="Nothing in this category"
            description="Try a different category — the catalog rotates each season."
          />
        ) : (
          <RevealGroup className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((i) => {
              /* Falls back rather than indexing blind: a rarity the API adds
                 before this map knows about it left `r` undefined and threw on
                 `r.ring`, blanking the whole catalogue. An unfamiliar rarity
                 should render as an ordinary item, not as no items at all. */
              const r = RARITY[i.rarity] ?? RARITY.common;
              const mine = isOwned(i);
              const affordable = canAfford(i);
              return (
                <RevealItem key={i.id}>
                  <SpotlightCard
                    className={cn(
                      "flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 ring-1 ring-inset",
                      r.ring,
                    )}
                  >
                    <div className="relative">
                      <ItemArt hue={i.hue} name={i.name} />
                      <div className="absolute left-2.5 top-2.5">
                        <Badge tone={r.tone}>{r.label}</Badge>
                      </div>
                      {mine && (
                        <div className="absolute right-2.5 top-2.5">
                          <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>Owned</Badge>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="text-sm font-semibold text-text-primary">{i.name}</h3>
                      <p className="mt-1 flex-1 text-xs leading-relaxed text-text-muted">{i.description}</p>
                      <p className="tnum mt-3 text-sm font-semibold text-text-primary">
                        {i.priceMtt != null
                          ? `${formatToken(i.priceMtt)} ${MTT_SYMBOL}`
                          : `${formatNumber(i.pricePoints ?? 0)} Points`}
                      </p>
                      <Button
                        size="sm"
                        fullWidth
                        className="mt-3"
                        variant={mine ? "outline" : "primary"}
                        disabled={mine || !affordable}
                        onClick={() => setBuying(i)}
                      >
                        {mine ? "In inventory" : affordable ? "Buy" : "Insufficient balance"}
                      </Button>
                    </div>
                  </SpotlightCard>
                </RevealItem>
              );
            })}
          </RevealGroup>
        )
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              {listings.length} active listings from other players
            </p>
            <Button size="sm" variant="outline" icon={<Tag className="size-3.5" />}>
              List an item for sale
            </Button>
          </div>

          <RevealGroup className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => {
              const r = RARITY[l.rarity];
              return (
                <RevealItem key={l.id}>
                  <SpotlightCard className="flex h-full gap-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4">
                    <ItemArt hue={l.hue} name={l.itemName} className="size-20 shrink-0 rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate text-sm font-semibold text-text-primary">{l.itemName}</h3>
                        <Badge tone={r.tone}>{r.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        {l.sellerLabel} · listed <RelativeTime date={l.listedAt} />
                      </p>
                      <p className="tnum mt-auto pt-2 text-sm font-semibold text-text-primary">
                        {formatToken(l.askMtt)} {MTT_SYMBOL}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button size="xs" onClick={() => setBidding(l)}>Buy now</Button>
                        <Button size="xs" variant="ghost" onClick={() => setBidding(l)}>Make offer</Button>
                      </div>
                    </div>
                  </SpotlightCard>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </>
      )}

      {/* Store purchase */}
      <Modal
        open={!!buying}
        onClose={() => setBuying(null)}
        title="Confirm purchase"
        icon={<ShoppingBag className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuying(null)}>Cancel</Button>
            <Button loading={busy} onClick={buy}>Confirm purchase</Button>
          </>
        }
      >
        {buying && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <ItemArt hue={buying.hue} name={buying.name} className="size-24 shrink-0 rounded-xl" />
              <div className="min-w-0">
                <Badge tone={RARITY[buying.rarity].tone}>{RARITY[buying.rarity].label}</Badge>
                <h3 className="mt-2 text-sm font-semibold text-text-primary">{buying.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{buying.description}</p>
              </div>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow
                label="Price"
                value={
                  buying.priceMtt != null
                    ? `${formatToken(buying.priceMtt)} ${MTT_SYMBOL}`
                    : `${formatNumber(buying.pricePoints ?? 0)} Points`
                }
              />
              <DetailRow
                label="Balance after"
                value={
                  buying.priceMtt != null
                    ? `${formatToken(balances.mttAvailable - buying.priceMtt)} ${MTT_SYMBOL}`
                    : `${formatNumber(balances.points - (buying.pricePoints ?? 0))} Points`
                }
              />
              <DetailRow label="Category" value={buying.category} />
            </div>
            <Callout tone="info" title="Consumables aren't refundable" icon={<Info />}>
              <p className="mt-1">
                Boosts and energy refills are consumed on use and can&apos;t be refunded once
                activated. Cosmetics stay in your inventory and can be listed on the P2P marketplace.
              </p>
            </Callout>
          </div>
        )}
      </Modal>

      {/* Marketplace */}
      <Modal
        open={!!bidding}
        onClose={() => setBidding(null)}
        title="Marketplace purchase"
        icon={<Users className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBidding(null)}>Cancel</Button>
            <Button
              onClick={() => {
                toast.success("Offer submitted", "The seller has 24 hours to accept.");
                setBidding(null);
              }}
            >
              Submit
            </Button>
          </>
        }
      >
        {bidding && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Item" value={bidding.itemName} />
              <DetailRow label="Seller" value={bidding.sellerLabel} />
              <DetailRow label="Asking price" value={`${formatToken(bidding.askMtt)} ${MTT_SYMBOL}`} />
              <DetailRow label="Marketplace fee" value="Deducted from the seller's proceeds" />
            </div>
            <Callout tone="info" title="Fees feed the Treasury" icon={<Landmark />}>
              <p className="mt-1">
                A published share of the marketplace fee on this trade is allocated to the Revenue
                Treasury, which funds staking rewards and referral commissions across the platform.
              </p>
            </Callout>
          </div>
        )}
      </Modal>
    </>
  );
}
