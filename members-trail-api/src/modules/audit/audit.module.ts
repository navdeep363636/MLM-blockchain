import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLog } from "@/database/entities";
import { AuditService } from "./audit.service";

/**
 * Shared audit-trail writer. Imported by any feature module that performs a
 * sensitive action; deliberately tiny and dependency-free so importing it
 * cannot create a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
