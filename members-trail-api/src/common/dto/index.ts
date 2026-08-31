import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsISO8601, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min,
} from "class-validator";

/* ============================================================================
 * Shared request/response shapes. Every list endpoint uses the same pagination
 * contract so the frontend has one helper rather than twelve.
 * ========================================================================== */

export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit: number = 25;

  @ApiPropertyOptional({ description: "Column to sort by. Whitelisted per endpoint." })
  @IsOptional() @IsString() @MaxLength(40)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["ASC", "DESC"], default: "DESC" })
  @IsOptional() @IsIn(["ASC", "DESC"] as const)
  sortDir: "ASC" | "DESC" = "DESC";

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class DateRangeQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: "ISO-8601 inclusive lower bound" })
  @IsOptional() @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: "ISO-8601 inclusive upper bound" })
  @IsOptional() @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: "Free-text search, applied to whitelisted columns" })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}

export class PageMeta {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() pages!: number;
  @ApiProperty() hasNext!: boolean;
  @ApiProperty() hasPrev!: boolean;
}

export class Paginated<T> {
  @ApiProperty({ isArray: true }) data!: T[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

export function paginate<T>(data: T[], total: number, q: PaginationQuery): Paginated<T> {
  const pages = Math.max(1, Math.ceil(total / q.limit));
  return {
    data,
    meta: {
      total,
      page: q.page,
      limit: q.limit,
      pages,
      hasNext: q.page < pages,
      hasPrev: q.page > 1,
    },
  };
}

/**
 * Guards against SQL injection through a sort parameter. An allowlist is the
 * only safe way to accept a column name — there is no escaping that makes an
 * arbitrary identifier safe.
 */
export function safeSort(
  requested: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  return requested && allowed.includes(requested) ? requested : fallback;
}

export class IdParam {
  @ApiProperty()
  @IsString() @MaxLength(64)
  id!: string;
}

export class OkResponse {
  @ApiProperty({ example: true }) ok!: boolean;
  @ApiPropertyOptional() message?: string;
}
