import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/* ============================================================================
 * The only unauthenticated data contract in the platform.
 *
 * The FRD forbids hard-coded marketing numbers on the landing page, which is
 * the entire reason this endpoint exists: the live-stats strip must be a
 * measurement, not a design decision. That cuts both ways — it also means this
 * response must never carry a figure the platform cannot stand behind, and must
 * never carry anything that identifies a member.
 * ========================================================================== */

export class PublicStatsResponse {
  @ApiProperty({ description: "Members with a validated session in the last 30 days" })
  activeMembers30d!: number;

  @ApiProperty({ description: "Registered members, excluding staff and closed accounts" })
  totalMembers!: number;

  @ApiProperty({ description: "MTT currently staked across all pools" })
  mttStaked!: string;

  @ApiProperty({ description: "Tournaments settled, all time" })
  tournamentsRun!: number;

  @ApiProperty({ description: "Games live on the platform right now" })
  gamesLive!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Share of released commission funded by reconciled revenue rather than the " +
      "reserve, as a percentage. Null when no commission has been released — " +
      "publishing 100% for 'we have paid nothing' would be a claim we cannot support.",
  })
  revenueFundedPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Released commission over reconciled net revenue for the current month, as " +
      "a percentage. The compliance figure the platform publishes voluntarily. " +
      "Null when there is no revenue to divide by.",
  })
  payoutRatioPct!: number | null;

  @ApiProperty({ description: "Points needed for one MTT under the active rate" })
  pointsPerMtt!: number;

  @ApiProperty({
    description:
      "When this snapshot was computed. Cached for a few minutes — a landing " +
      "page does not need second-accuracy, and an uncached public endpoint is a " +
      "free denial-of-service against the ledger.",
  })
  computedAt!: string;
}


/* ============================================================================
 * Registration policy, published.
 *
 * Every value here was a constant in the frontend bundle. That is a problem
 * specifically because these are POLICY: the restricted-jurisdiction list is a
 * compliance decision, the minimum ages are statutory, and the password rules
 * are enforced server-side. A copy in the bundle is a copy that drifts, and the
 * drift is invisible — the browser cheerfully accepts a registration the server
 * will refuse, or blocks one it would have allowed.
 *
 * Serving them means there is one answer, and the client is showing the same
 * rules the server is enforcing.
 * ========================================================================== */

export class PublicConfigResponse {
  @ApiProperty({
    isArray: true, type: String,
    description:
      "ISO 3166-1 alpha-2 codes that cannot register. Sanctions programmes, FATF " +
      "call-for-action jurisdictions, and territories with no lawful route for the " +
      "token model. The server refuses these regardless of what any client shows.",
  })
  restrictedJurisdictions!: string[];

  @ApiProperty({ description: "Minimum onboarding age where no local statute raises it" })
  globalMinimumAge!: number;

  @ApiProperty({
    description:
      "Jurisdictions whose statutory minimum is above the global floor, as " +
      "country code to age. A jurisdiction may raise the minimum, never lower it.",
  })
  jurisdictionMinimumAge!: Record<string, number>;

  @ApiProperty({ description: "Password policy, as enforced" })
  password!: {
    minLength: number;
    maxLength: number;
    /** Human-readable rules, in the order a form should display them. */
    rules: string[];
  };

  @ApiProperty({ description: "Legal documents a new member must accept, by slug" })
  requiredLegalDocuments!: string[];

  @ApiProperty({
    description:
      "The live referral plan, as published. The public referral page and the " +
      "earnings calculator need these rates, and a copy compiled into a browser " +
      "bundle would keep quoting last quarter's plan after Finance changed it — " +
      "which for a commission rate is a claim, not a stale cache.",
  })
  referral!: {
    /** Level to rate in basis points, in order. Empty when no plan is active. */
    levels: { level: number; rateBps: number }[];
    /** Spend types that earn commission at all. */
    eligibleTypes: string[];
    maxDepth: number;
    monthlyCapAbsoluteMtt: string;
    monthlyCapMultiplier: number;
    monthlyCapBaseMtt: string;
    minAccountAgeDays: number;
    minGameplaySessions: number;
  };

  @ApiProperty({
    description:
      "Points-to-MTT conversion, as published: the active rate and the per-member " +
      "caps. The caps are what a member's converter must show BEFORE they type an " +
      "amount, so they are not authenticated.",
  })
  conversion!: {
    pointsPerMtt: number;
    perUserDailyPoints: string;
    perUserMonthlyPoints: string;
    minimumPoints: string;
  };
}
