import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { Deposit, Transaction, User, WalletAddress, Withdrawal } from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { WalletController } from "./wallet.controller";
import { WalletAdminController } from "./wallet.admin.controller";
import { WalletService } from "./wallet.service";
import { WithdrawalService } from "./withdrawal.service";
import { DepositService } from "./deposit.service";

/**
 * Wallet: balances, addresses, transactions, deposits and withdrawals.
 *
 * Three services rather than one because the compliance surface of a withdrawal
 * has nothing in common with reading a balance, and mixing them would make the
 * payout rules harder to review than they already are.
 *
 * All three are exported: the withdrawal and webhook processors in src/queues
 * drive the lifecycle transitions, which are deliberately not HTTP routes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, WalletAddress, Withdrawal, Deposit, User]),
    BullModule.registerQueue({ name: Queues.Withdrawal }),
    AuditModule,
    EconomyConfigModule,
  ],
  controllers: [WalletController, WalletAdminController],
  providers: [WalletService, WithdrawalService, DepositService],
  exports: [WalletService, WithdrawalService, DepositService],
})
export class WalletModule {}
