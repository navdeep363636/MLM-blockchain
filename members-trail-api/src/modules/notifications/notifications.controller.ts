import { Body, Controller, Get, HttpCode, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import { OkResponse, type Paginated } from "@/common/dto";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "./notifications.service";
import {
  BroadcastRequest, MarkReadRequest, NotificationListQuery, NotificationResponse,
  PreferencesResponse, UnreadCountResponse, UpdatePreferencesRequest,
} from "./dto/notifications.dto";

/* ============================================================================
 * Notifications, player side (FRD N-01).
 * ========================================================================== */

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "The member's notifications, newest first" })
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: NotificationListQuery,
  ): Promise<Paginated<NotificationResponse>> {
    return this.notifications.list(user.id, q);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Unread totals overall and per kind, for the bell badge" })
  @ApiOkResponse({ type: UnreadCountResponse })
  unread(@CurrentUser() user: AuthUser): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(user.id);
  }

  @Patch("read")
  @ApiOperation({ summary: "Mark specific notifications read" })
  @ApiOkResponse({ type: OkResponse })
  async markRead(
    @CurrentUser() user: AuthUser,
    @Body() dto: MarkReadRequest,
  ): Promise<OkResponse & { updated: number }> {
    const updated = await this.notifications.markRead(user.id, dto.ids);
    return { ok: true, updated };
  }

  @Patch("read-all")
  @ApiOperation({ summary: "Mark every notification read" })
  @ApiOkResponse({ type: OkResponse })
  async markAllRead(@CurrentUser() user: AuthUser): Promise<OkResponse & { updated: number }> {
    const updated = await this.notifications.markAllRead(user.id);
    return { ok: true, updated };
  }

  @Get("preferences")
  @ApiOperation({
    summary: "Channel preferences",
    description:
      "`alwaysDelivered` lists the kinds that cannot be muted — security alerts. Everything is " +
      "recorded in-app regardless of channel settings.",
  })
  @ApiOkResponse({ type: PreferencesResponse })
  preferences(@CurrentUser() user: AuthUser): Promise<PreferencesResponse> {
    return this.notifications.preferences(user.id);
  }

  @Patch("preferences")
  @ApiOperation({
    summary: "Update channel preferences",
    description: "Attempts to mute security notifications are ignored, not stored.",
  })
  @ApiOkResponse({ type: PreferencesResponse })
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePreferencesRequest,
  ): Promise<PreferencesResponse> {
    return this.notifications.updatePreferences(user.id, dto);
  }
}

/* ============================================================================
 * Notification administration (FRD AD-10).
 * ========================================================================== */

@ApiTags("admin: notifications")
@StaffOnly("support", "super_admin")
@Controller("admin/notifications")
export class NotificationsAdminController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Post("broadcast")
  @HttpCode(202)
  @RequirePermissions("notifications:write")
  @ApiOperation({
    summary: "Send a system or promotional notification to a list of members",
    description:
      "Limited to the `system` and `promo` kinds: a broadcast must not be able to impersonate a " +
      "security or transaction alert. Promotional sends respect each member's marketing consent.",
  })
  async broadcast(
    @Body() dto: BroadcastRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<{ queued: number; recipients: number }> {
    const queued = await this.notifications.notifyMany(dto.userIds, {
      kind: dto.kind,
      title: dto.title,
      body: dto.body,
      href: dto.href ?? null,
    });

    await this.audit.recordOrThrow({
      actorId: actor.id,
      action: "notification.broadcast",
      targetType: "notification",
      after: { kind: dto.kind, title: dto.title, recipients: dto.userIds.length, queued },
      reason: dto.reason,
      ip,
    });

    return { queued, recipients: dto.userIds.length };
  }

  @Get("failed-deliveries")
  @ApiOperation({
    summary: "Deliveries that failed, for the ops dashboard",
    description: "A silent send failure looks exactly like a member not reading their email. This is the difference.",
  })
  failed() {
    return this.notifications.failedDeliveries();
  }
}
