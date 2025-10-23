import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Database } from "bun:sqlite";

export interface MigrationRunner {
  runMigrations: () => Promise<void>;
}

export interface MigrationRunnerDeps {
  dbPath: string;
  schemaPath?: string;
  logger?: Pick<typeof console, "info" | "error">;
}

export function createMigrationRunner({
  dbPath,
  schemaPath,
  logger,
}: MigrationRunnerDeps): MigrationRunner {
  const resolvedSchemaPath =
    schemaPath ?? resolve(process.cwd(), "src/database/schema.sql");

  return {
    async runMigrations() {
      mkdirSync(dirname(dbPath), { recursive: true });
      const schemaSql = await readSchema(resolvedSchemaPath);
      const db = new Database(dbPath);

      try {
        db.exec("PRAGMA foreign_keys = ON;");
        db.exec("BEGIN;");
        db.exec(schemaSql);
        db.exec("COMMIT;");
        logger?.info?.("Database migrations applied");
      } catch (rawError) {
        db.exec("ROLLBACK;");
        const message =
          rawError instanceof Error ? rawError.message : String(rawError);
        logger?.error?.(`Database migration failed: ${message}`);
        throw new Error("Failed to apply database migrations", {
          cause: rawError,
        });
      } finally {
        db.close();
      }
    },
  };
}

async function readSchema(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (rawError) {
    const message =
      rawError instanceof Error ? rawError.message : String(rawError);
    throw new Error(`Failed to read schema file at ${path}: ${message}`, {
      cause: rawError,
    });
  }
}
