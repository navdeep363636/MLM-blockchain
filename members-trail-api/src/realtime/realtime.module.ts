import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * Socket.IO gateway.
 *
 * Depends on nothing but JWT (global) and Redis (global): the gateway listens to
 * domain events on the in-process bus, so no feature module has to know that
 * sockets exist. That direction is what keeps realtime from becoming a second,
 * divergent copy of the domain logic.
 *
 * Horizontal scale comes from the Redis adapter installed in main.ts — a member
 * connected to one instance still receives an event published on another.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
