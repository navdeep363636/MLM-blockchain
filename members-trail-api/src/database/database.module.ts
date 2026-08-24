import { Global, Module } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { appConfig, dbConfig } from "@/config/configuration";
import { ENTITIES } from "./entities/registry";
import { LedgerService } from "./ledger/ledger.service";

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [dbConfig.KEY, appConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>, app: ConfigType<typeof appConfig>) => ({
        type: "mysql" as const,
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.database,
        entities: [...ENTITIES],
        migrations: ["dist/database/migrations/*.js"],
        /* Migrations only. `synchronize` can drop a column it doesn't recognise,
         * which in a financial ledger is unrecoverable. */
        synchronize: db.synchronize && !app.isProd,
        migrationsRun: false,
        logging: db.logging ? (["query", "error", "warn"] as const) : (["error", "warn"] as const),
        charset: "utf8mb4",
        timezone: "Z",
        /* Fail fast rather than hanging a request behind an exhausted pool. */
        extra: {
          connectionLimit: db.poolSize,
          /* Keeps DECIMAL as string end-to-end. Turning this on silently
           * reintroduces float rounding into every balance. */
          decimalNumbers: false,
          waitForConnections: true,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10_000,
          ...(db.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
        },
        maxQueryExecutionTime: 1_000,   // logs slow queries
        retryAttempts: app.isTest ? 1 : 10,
        retryDelay: 3_000,
        autoLoadEntities: false,
      }),
    }),
  ],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class DatabaseModule {}
