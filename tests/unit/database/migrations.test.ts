import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

import { createMigrationRunner } from "@/database/migrations";

describe("createMigrationRunner", () => {
  let tmpDir: string;
  let dbPath: string;
  const schemaPath = resolve(process.cwd(), "src/database/schema.sql");

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "vc-notify-migration-"));
    dbPath = join(tmpDir, "bot.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("schema.sql に基づいてテーブルとインデックスを作成し、再実行しても安全である", async () => {
    const runner = createMigrationRunner({ dbPath, schemaPath });

    await runner.runMigrations();

    const db = new Database(dbPath, { readonly: true });

    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_rules'"
      )
      .all();
    expect(tables).toHaveLength(1);

    const indexes = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name"
      )
      .all()
      .map((row) => row.name);
    expect(indexes).toContain("idx_notification_rules_guild_id");
    expect(indexes).toContain("idx_notification_rules_enabled");

    db.close();

    await expect(runner.runMigrations()).resolves.toBeUndefined();
  });
});
