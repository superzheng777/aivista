import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import type { Environment } from "../config/environment.js";
import type { DatabaseSchema } from "./database.types.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<DatabaseSchema>;

  constructor(config: ConfigService<Environment, true>) {
    this.db = new Kysely<DatabaseSchema>({
      dialect: new MysqlDialect({
        pool: createPool({
          host: config.get("AIVISTA_DB_HOST", { infer: true }) ?? "127.0.0.1",
          port: config.get("AIVISTA_DB_PORT", { infer: true }),
          database: config.get("AIVISTA_DB_NAME", { infer: true }) ?? "aivista",
          user: config.get("AIVISTA_DB_USERNAME", { infer: true }) ?? "",
          password: config.get("AIVISTA_DB_PASSWORD", { infer: true }) ?? "",
          connectionLimit: 10,
          supportBigNumbers: true,
          bigNumberStrings: true,
          timezone: "Z",
        }),
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
