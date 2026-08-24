import { Global, Module } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import Redis from "ioredis";
import { redisConfig } from "@/config/configuration";
import { REDIS_CLIENT, RedisService, buildRedisOptions } from "./redis.service";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (cfg: ConfigType<typeof redisConfig>) => new Redis(buildRedisOptions(cfg)),
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
