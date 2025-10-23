import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

import {
  createNotificationRuleRepository,
  type NotificationRuleRepository,
  type NotificationRuleRepositoryDeps,
} from "@/repositories/notificationRuleRepository";
import { createMigrationRunner } from "@/database/migrations";

describe("NotificationRuleRepository", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database;
  let repository: NotificationRuleRepository;
  const schemaPath = resolve(process.cwd(), "src/database/schema.sql");

  const idQueue: string[] = [];
  const nowQueue: Date[] = [];
  let warnCalls: unknown[][] = [];

  const depsFactory = (): NotificationRuleRepositoryDeps => ({
    db,
    generateId: () => {
      const next = idQueue.shift();
      if (!next) {
        throw new Error("generateId queue exhausted");
      }
      return next;
    },
    getCurrentTime: () => {
      const next = nowQueue.shift();
      if (!next) {
        throw new Error("getCurrentTime queue exhausted");
      }
      return next;
    },
    logger: {
      warn: (...args: any[]) => {
        warnCalls.push(args);
      },
    },
  });

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "vc-notify-repo-"));
    dbPath = join(tmpDir, "bot.db");

    const runner = createMigrationRunner({ dbPath, schemaPath });
    await runner.runMigrations();

    db = new Database(dbPath);
    repository = createNotificationRuleRepository(depsFactory());
    warnCalls = [];
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    idQueue.length = 0;
    nowQueue.length = 0;
    warnCalls = [];
  });

  function enqueueId(id: string) {
    idQueue.push(id);
  }

  function enqueueNow(date: string) {
    nowQueue.push(new Date(date));
  }

  function createRuleInput(index: number) {
    return {
      guildId: `guild-${index}`,
      name: `Rule ${index}`,
      watchedVoiceChannelIds: [`vc-${index}-1`, `vc-${index}-2`],
      targetUserIds: [`user-${index}-1`],
      notificationChannelId: `text-${index}`,
    };
  }

  it("ルールを作成し、ID/タイムスタンプ/JSON配列を正しく保存する", async () => {
    enqueueId("rule-1");
    enqueueNow("2025-01-01T00:00:00.000Z");

    const created = await repository.createRule(createRuleInput(1));

    expect(created.id).toBe("rule-1");
    expect(created.createdAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(created.updatedAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");

    const fetched = await repository.findById("rule-1");
    expect(fetched).not.toBeNull();
    if (!fetched) {
      throw new Error("fetched rule not found");
    }

    expect(fetched).toEqual(created);
  });

  it("ギルド単位でルールを取得し、enabledフラグでフィルタリングできる", async () => {
    enqueueId("rule-a");
    enqueueNow("2025-01-01T00:00:00.000Z");
    await repository.createRule({
      guildId: "guild-a",
      name: "A1",
      watchedVoiceChannelIds: ["vc-1"],
      targetUserIds: [],
      notificationChannelId: "text-1",
    });

    enqueueId("rule-b");
    enqueueNow("2025-01-02T00:00:00.000Z");
    await repository.createRule({
      guildId: "guild-a",
      name: "A2",
      watchedVoiceChannelIds: ["vc-2"],
      targetUserIds: ["user-1"],
      notificationChannelId: "text-2",
    });

    enqueueId("rule-c");
    enqueueNow("2025-01-03T00:00:00.000Z");
    const disabled = await repository.createRule({
      guildId: "guild-b",
      name: "B1",
      watchedVoiceChannelIds: ["vc-3"],
      targetUserIds: [],
      notificationChannelId: "text-3",
    });
    enqueueNow("2025-01-04T00:00:00.000Z");
    await repository.toggleEnabled(disabled.id, false);

    const guildARules = await repository.findByGuild("guild-a");
    expect(guildARules.map((rule) => rule.name)).toEqual(["A1", "A2"]);

    const enabledGuildBRules = await repository.findEnabledByGuild("guild-b");
    expect(enabledGuildBRules).toHaveLength(0);
  });

  it("ルールを更新・削除し、件数も取得できる", async () => {
    enqueueId("rule-1");
    enqueueNow("2025-01-01T00:00:00.000Z");
    const created = await repository.createRule(createRuleInput(1));

    enqueueNow("2025-01-05T12:34:56.000Z");
    const updated = await repository.updateRule(created.id, {
      name: "Updated",
      watchedVoiceChannelIds: ["vc-x"],
      targetUserIds: [],
      notificationChannelId: "text-updated",
    });

    expect(updated.name).toBe("Updated");
    expect(updated.updatedAt.toISOString()).toBe("2025-01-05T12:34:56.000Z");
    expect(updated.targetUserIds).toEqual([]);

    expect(await repository.countByGuild(created.guildId)).toBe(1);

    await repository.deleteRule(created.id);

    expect(await repository.findById(created.id)).toBeNull();
    expect(await repository.countByGuild(created.guildId)).toBe(0);
  });

  it("存在しないIDの更新はエラーを投げる", async () => {
    enqueueNow("2025-02-01T00:00:00.000Z");

    await expect(
      repository.updateRule("missing", {
        name: "Updated",
        watchedVoiceChannelIds: [],
        targetUserIds: [],
        notificationChannelId: "text",
      })
    ).rejects.toThrowError(/Notification rule not found/);
  });

  it("存在しないIDの削除はエラーを投げる", async () => {
    await expect(repository.deleteRule("missing"))
      .rejects.toThrowError(/Notification rule not found/);
  });

  it("重複IDでの作成はエラーになる", async () => {
    enqueueId("duplicate-id");
    enqueueNow("2025-03-01T00:00:00.000Z");
    await repository.createRule(createRuleInput(1));

    enqueueId("duplicate-id");
    enqueueNow("2025-03-02T00:00:00.000Z");

    await expect(repository.createRule(createRuleInput(2))).rejects.toThrow();
  });

  it("不正なJSON配列は警告を出し、空配列にフォールバックする", async () => {
    enqueueId("rule-json");
    enqueueNow("2025-04-01T00:00:00.000Z");
    await repository.createRule(createRuleInput(3));

    warnCalls = [];
    db.exec(`
      UPDATE notification_rules
      SET watched_voice_channel_ids = 'not-json',
          target_user_ids = '"oops"'
      WHERE id = 'rule-json'
    `);

    const fetched = await repository.findById("rule-json");
    expect(fetched).not.toBeNull();
    if (!fetched) {
      throw new Error("rule-json not found");
    }

    expect(fetched.watchedVoiceChannelIds).toEqual([]);
    expect(fetched.targetUserIds).toEqual([]);

    expect(warnCalls.length).toBe(2);
    expect(String(warnCalls[0][0])).toMatch(/Failed to parse JSON array/);
    expect(warnCalls[0][1]).toBeInstanceOf(Error);
    expect(String(warnCalls[1][0])).toMatch(/JSON parsed but not an array/);
  });
});
