import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/* ============================================================================
 * Dashboard analytics contracts.
 *
 * Every series here is keyed by `periodKey` (`YYYY-MM`) and carries a
 * human-readable `label` alongside it. The key is what a caller filters and
 * sorts on; the label is what an axis prints. Sending only the label would force
 * the browser to parse "Aug 26" back into a date to sort it, which is how charts
 * end up in the wrong order in a different locale.
 *
 * Money is a string in every field, for the same reason it is a string
 * everywhere else in this API: these are DECIMAL(36,18) values and a JSON number
 * would silently round them. Percentages are numbers, because a percentage is a
 * derived display figure and nobody settles accounts with one.
 * ========================================================================== */

export class MonthsQuery {
  @ApiPropertyOptional({
    minimum: 1, maximum: 60, default: 12,
    description: "How many trailing periods to return. Clamped server-side.",
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60)
  months: number = 12;
}

export class RevenueByStreamPoint {
  @ApiProperty({ example: "2026-08" }) periodKey!: string;
  @ApiProperty({ example: "Aug 26" }) label!: string;
  @ApiProperty({ description: "Net revenue by stream, reconciled only" })
  iap!: string;
  @ApiProperty() tournament!: string;
  @ApiProperty() marketplace!: string;
  @ApiProperty() advertising!: string;
  @ApiProperty() subscription!: string;
  @ApiProperty({ description: "Sum of the five streams" }) total!: string;
  @ApiProperty({
    description:
      "Net revenue in the period that has not been reconciled yet. Reported " +
      "separately rather than folded into the streams — a total that mixes " +
      "money that arrived with money that might is not a revenue figure.",
  })
  unreconciled!: string;
}

export class PayoutVsInflowPoint {
  @ApiProperty() periodKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: "Reconciled Treasury inflow, MTT" }) inflow!: string;
  @ApiProperty({ description: "Confirmed transfers to the commission pool, MTT" })
  commission!: string;
  @ApiProperty({ description: "Confirmed transfers to the staking pools, MTT" })
  staking!: string;
  @ApiProperty({ description: "Confirmed transfers to the reserve, MTT" }) reserve!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Pool transfers over reconciled inflow, as a percentage. Null when there " +
      "was no inflow — 0% would read as healthy when the truth is unknown.",
  })
  outflowRatioPct!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Released commission over reconciled net revenue, as a percentage. This is " +
      "the compliance line. Not summable with outflowRatioPct — commission is " +
      "paid FROM the pool transfer, so adding them counts the same money twice.",
  })
  commissionRatioPct!: number | null;
}

export class StakingTvlPoint {
  @ApiProperty() periodKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: "Cumulative net staked principal at period end, MTT" })
  tvl!: string;
  @ApiProperty({ description: "Distinct members with an open position at period end" })
  stakers!: number;
  @ApiProperty({ description: "Principal staked during the period, MTT" }) staked!: string;
  @ApiProperty({ description: "Principal unstaked during the period, MTT" }) unstaked!: string;
}

export class KycFunnelStage {
  @ApiProperty({ example: "Tier 1 approved" }) stage!: string;
  @ApiProperty() count!: number;
  @ApiProperty({
    description:
      "Share of the first stage, as a percentage. The first stage is always 100 " +
      "— a funnel measured against anything else is not a funnel.",
  })
  ofTopPct!: number;
}

export class CohortRetentionPoint {
  @ApiProperty() periodKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: "Members who signed up in this period" }) cohort!: number;
  @ApiPropertyOptional({ nullable: true, description: "Returned on day 1, %. Null until the window has elapsed." })
  d1!: number | null;
  @ApiPropertyOptional({ nullable: true }) d7!: number | null;
  @ApiPropertyOptional({ nullable: true }) d30!: number | null;
  @ApiProperty({
    description:
      "True when the cohort is younger than the widest window, so d30 is not yet " +
      "answerable. A partial cohort plotted as a drop is a reporting bug, not a churn signal.",
  })
  partial!: boolean;
}
