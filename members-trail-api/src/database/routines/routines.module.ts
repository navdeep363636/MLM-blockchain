import { Global, Module } from "@nestjs/common";
import { DbRoutinesService } from "./db-routines.service";

/**
 * Global, like the database module itself.
 *
 * Twelve feature modules use these views and procedures. Importing this module
 * into each of them would add twelve lines of wiring that say nothing — the
 * service is infrastructure, in the same class as the DataSource it wraps.
 */
@Global()
@Module({
  providers: [DbRoutinesService],
  exports: [DbRoutinesService],
})
export class RoutinesModule {}
