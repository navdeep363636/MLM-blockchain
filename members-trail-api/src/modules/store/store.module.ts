import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import {
  MarketListing, PointsLedgerEntry, StoreItem, Transaction, User, UserInventoryItem,
} from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { TreasuryModule } from "@/modules/treasury/treasury.module";
import { StoreController } from "./store.controller";
import { StoreAdminController } from "./store.admin.controller";
import { StoreService } from "./store.service";

/**
 * Store, inventory and marketplace.
 *
 * Imports TreasuryModule because an MTT store purchase is revenue and a
 * marketplace fee is revenue — both go through the one definition of revenue in
 * this system rather than a second, parallel one.
 *
 * Exported for the listing-expiry cron.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreItem, UserInventoryItem, MarketListing, Transaction, PointsLedgerEntry, User,
    ]),
    BullModule.registerQueue({ name: Queues.Commission }),
    AuditModule,
    EconomyConfigModule,
    TreasuryModule,
  ],
  controllers: [StoreController, StoreAdminController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
