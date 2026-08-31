import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { PaginationQuery } from "@/common/dto";
import type { TicketCategory, TicketPriority, TicketStatus } from "@/database/entities";

/* ============================================================================
 * Support DTOs (FRD N-02).
 *
 * `financialDispute` is a RESPONSE field only — never an input. A member cannot
 * mark their own ticket as a financial dispute to jump the queue, and cannot
 * avoid the label to keep a withdrawal complaint away from compliance. The
 * server derives it from the category.
 * ========================================================================== */

export const TICKET_CATEGORIES: TicketCategory[] = [
  "account", "kyc", "withdrawal", "commission", "gameplay", "technical", "other",
];
export const TICKET_STATUSES: TicketStatus[] = [
  "open", "pending_user", "escalated", "resolved", "closed",
];
export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export class CreateTicketRequest {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200)
  subject!: string;

  @ApiProperty({ enum: TICKET_CATEGORIES })
  @IsIn(TICKET_CATEGORIES)
  category!: TicketCategory;

  @ApiProperty({ description: "The member's opening message" })
  @IsString() @MinLength(10) @MaxLength(5_000)
  body!: string;

  @ApiPropertyOptional({
    description: "Reference of the disputed item, e.g. a withdrawal or commission ref",
  })
  @IsOptional() @IsString() @MaxLength(64)
  disputedRef?: string;
}

export class AddMessageRequest {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5_000)
  body!: string;
}

export class AgentReplyRequest extends AddMessageRequest {
  @ApiPropertyOptional({
    default: false,
    description: "Internal notes are never returned on the player-facing endpoint",
  })
  @IsOptional() @IsBoolean()
  internal?: boolean;
}

export class TicketMessageResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["user", "agent", "system"] }) authorRole!: "user" | "agent" | "system";
  @ApiProperty({ description: "\"You\", \"Support\" or \"System\" — agent identities are not exposed" })
  authorLabel!: string;
  @ApiProperty() body!: string;
  @ApiProperty() createdAt!: string;
}

export class TicketResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) category!: TicketCategory;
  @ApiProperty({ enum: TICKET_STATUSES }) status!: TicketStatus;
  @ApiProperty({ enum: TICKET_PRIORITIES }) priority!: TicketPriority;
  @ApiProperty({
    description: "Server-derived. Financial disputes are routed to compliance-trained agents.",
  })
  financialDispute!: boolean;
  @ApiProperty({ description: "When a first response is due" }) slaDueAt!: string;
  @ApiProperty({ description: "True when the SLA has been missed and no reply has been sent" })
  slaBreached!: boolean;
  @ApiPropertyOptional({ nullable: true }) firstResponseAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) disputedRef!: string | null;
  @ApiPropertyOptional({ nullable: true }) satisfactionRating!: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() messageCount!: number;
}

export class TicketDetailResponse extends TicketResponse {
  @ApiProperty({ type: [TicketMessageResponse] }) messages!: TicketMessageResponse[];
}

export class TicketQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional() @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TICKET_CATEGORIES })
  @IsOptional() @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;
}

export class RateTicketRequest {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  rating!: number;
}

/* --------------------------------- admin ---------------------------------- */

export class AdminTicketQuery extends TicketQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  userId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: "Only financial disputes" })
  @IsOptional() @IsBoolean()
  financialOnly?: boolean;

  @ApiPropertyOptional({ description: "Only tickets past their SLA with no first response" })
  @IsOptional() @IsBoolean()
  breachedOnly?: boolean;
}

export class AssignTicketRequest {
  @ApiProperty({ description: "Agent to assign" })
  @IsUUID()
  assigneeId!: string;
}

export class ResolveTicketRequest {
  @ApiProperty({ description: "Resolution summary shown to the member" })
  @IsString() @MinLength(10) @MaxLength(2_000)
  resolution!: string;
}

export class SetPriorityRequest {
  @ApiProperty({ enum: TICKET_PRIORITIES })
  @IsIn(TICKET_PRIORITIES)
  priority!: TicketPriority;

  @ApiProperty({ description: "Why the priority changed" })
  @IsString() @MinLength(5) @MaxLength(500)
  reason!: string;
}

export class SlaReportResponse {
  @ApiProperty() open!: number;
  @ApiProperty() escalated!: number;
  @ApiProperty({ description: "Open tickets past their SLA with no first response" })
  breached!: number;
  @ApiProperty({ description: "Financial disputes still open" }) openFinancialDisputes!: number;
  @ApiProperty({ description: "Median minutes to first response over the last 30 days" })
  medianFirstResponseMinutes!: number | null;
  @ApiProperty({ description: "Mean satisfaction over the last 30 days, 1–5" })
  meanSatisfaction!: number | null;
}
