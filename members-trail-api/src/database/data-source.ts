import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { config as loadEnv } from "dotenv";
import { ENTITIES } from "./entities/registry";

/* The CLI runs outside Nest, so it loads .env itself. */
loadEnv({ path: process.env.ENV_FILE ?? ".env" });

export const dataSourceOptions: DataSourceOptions = {
  type: "mysql",
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "members_trail",
  entities: [...ENTITIES],
  migrations: ["src/database/migrations/*.ts"],
  /* Migrations are the only way the schema changes. `synchronize` will happily
   * drop a column it doesn't recognise, which in a ledger is unrecoverable. */
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOGGING === "true" ? ["query", "error", "warn"] : ["error", "warn"],
  charset: "utf8mb4",
  timezone: "Z",
  extra: {
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 20),
    // Keeps DECIMAL as string end-to-end. Losing this reintroduces float
    // rounding into every balance read — see common/utils/money.ts.
    decimalNumbers: false,
  },
};

export default new DataSource(dataSourceOptions);
