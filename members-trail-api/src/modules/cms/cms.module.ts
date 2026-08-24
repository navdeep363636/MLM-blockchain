import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CmsContent, LegalDocument } from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { CmsController, CmsAdminController } from "./cms.controller";
import { CmsService } from "./cms.service";

/**
 * Legal document versioning and CMS content.
 *
 * Member-side acceptance lives in the users module, which owns the account
 * record; this module owns authoring, review and publication — the side that
 * needs four eyes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LegalDocument, CmsContent]), AuditModule],
  controllers: [CmsController, CmsAdminController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
