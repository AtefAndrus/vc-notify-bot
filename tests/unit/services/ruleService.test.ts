import { beforeEach, describe, expect, it, mock } from "bun:test";

import {
  createRuleService,
  RuleLimitExceededError,
  RuleNotFoundError,
  RuleValidationError,
  RuleRepositoryConflictError,
} from "@/services/ruleService";
import type {
  CreateNotificationRuleInput,
  NotificationRuleRepository,
  UpdateNotificationRuleInput,
} from "@/repositories/notificationRuleRepository";
import type { NotificationRule } from "@/types";

const BASE_GUILD_ID = "100000000000000001";
const ALT_GUILD_ID = "300000000000000000";
const LIMIT_GUILD_ID = "400000000000000000";

const baseRule: NotificationRule = {
  id: "rule-1",
  guildId: BASE_GUILD_ID,
  name: "Rule 1",
  watchedVoiceChannelIds: ["100000000000000000"],
  targetUserIds: [],
  notificationChannelId: "200000000000000000",
  enabled: true,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

function makeRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    ...baseRule,
    ...overrides,
  };
}

describe("RuleService", () => {
  let repository: NotificationRuleRepository;
  let createRuleMock: ReturnType<
    typeof mock<
      (input: CreateNotificationRuleInput) => Promise<NotificationRule>
    >
  >;
  let findByIdMock: ReturnType<
    typeof mock<(id: string) => Promise<NotificationRule | null>>
  >;
  let findByGuildMock: ReturnType<
    typeof mock<(guildId: string) => Promise<NotificationRule[]>>
  >;
  let findEnabledByGuildMock: ReturnType<
    typeof mock<(guildId: string) => Promise<NotificationRule[]>>
  >;
  let updateRuleMock: ReturnType<
    typeof mock<
      (
        id: string,
        updates: UpdateNotificationRuleInput
      ) => Promise<NotificationRule>
    >
  >;
  let deleteRuleMock: ReturnType<typeof mock<(id: string) => Promise<void>>>;
  let toggleEnabledMock: ReturnType<
    typeof mock<
      (id: string, enabled: boolean) => Promise<NotificationRule | null>
    >
  >;
  let countByGuildMock: ReturnType<typeof mock<(guildId: string) => Promise<number>>>;

  beforeEach(() => {
    createRuleMock = mock(async (input) =>
      makeRule({
        id: "rule-created",
        guildId: input.guildId,
        name: input.name,
        watchedVoiceChannelIds: input.watchedVoiceChannelIds,
        targetUserIds: input.targetUserIds,
        notificationChannelId: input.notificationChannelId,
        enabled: input.enabled ?? true,
      })
    );
    findByIdMock = mock(async (id) => makeRule({ id }));
    findByGuildMock = mock(async () => [makeRule()]);
    findEnabledByGuildMock = mock(async () => [makeRule()]);
    updateRuleMock = mock(async (id, updates) =>
      makeRule({
        id,
        name: updates.name,
        watchedVoiceChannelIds: updates.watchedVoiceChannelIds,
        targetUserIds: updates.targetUserIds,
        notificationChannelId: updates.notificationChannelId,
      })
    );
    deleteRuleMock = mock(async () => {});
    toggleEnabledMock = mock(async (id, enabled) => makeRule({ id, enabled }));
    countByGuildMock = mock(async () => 0);

    repository = {
      createRule: createRuleMock,
      findById: findByIdMock,
      findByGuild: findByGuildMock,
      findEnabledByGuild: findEnabledByGuildMock,
      updateRule: updateRuleMock,
      deleteRule: deleteRuleMock,
      toggleEnabled: toggleEnabledMock,
      countByGuild: countByGuildMock,
    } as NotificationRuleRepository;
  });

  describe("createRule", () => {
    it("バリデーション通過後にRepositoryへ委譲する", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      const rule = await service.createRule({
        guildId: ALT_GUILD_ID,
        name: "Project Alpha",
        watchedVoiceChannelIds: ["400000000000000000"],
        targetUserIds: ["500000000000000000", "500000000000000001"],
        notificationChannelId: "600000000000000000",
      });

      expect(countByGuildMock).toHaveBeenCalledWith(ALT_GUILD_ID);
      expect(createRuleMock.mock.calls[0][0]).toEqual({
        guildId: ALT_GUILD_ID,
        name: "Project Alpha",
        watchedVoiceChannelIds: ["400000000000000000"],
        targetUserIds: ["500000000000000000", "500000000000000001"],
        notificationChannelId: "600000000000000000",
        enabled: true,
      });
      expect(rule.id).toBe("rule-created");
    });

    it("ギルドあたり50件の制限を超えるとエラー", async () => {
      countByGuildMock.mockResolvedValueOnce(50);
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(
        service.createRule({
          guildId: LIMIT_GUILD_ID,
          name: "Overflow",
          watchedVoiceChannelIds: ["100000000000000000"],
          targetUserIds: [],
          notificationChannelId: "200000000000000000",
        })
      ).rejects.toBeInstanceOf(RuleLimitExceededError);
    });

    it("バリデーションエラー時に詳細を含むRuleValidationErrorを投げる", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await service
        .createRule({
          guildId: "invalid",
          name: "",
          watchedVoiceChannelIds: [],
          targetUserIds: [],
          notificationChannelId: "200000000000000000",
        })
        .then(
          () => {
            throw new Error("expected validation error");
          },
          (error) => {
            expect(error).toBeInstanceOf(RuleValidationError);
            expect((error as RuleValidationError).violations).toEqual(
              expect.arrayContaining([
                "name must be between 1 and 50 characters.",
                "watchedVoiceChannelIds must contain between 1 and 10 items.",
                "guildId must be a valid snowflake ID.",
              ])
            );
          }
        );
    });

    it("入力値を正規化してRepositoryに渡す", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await service.createRule({
        guildId: "300000000000000000 ",
        name: "  Project Beta ",
        watchedVoiceChannelIds: [" 700000000000000000 ", "700000000000000001"],
        targetUserIds: [" 800000000000000000 "],
        notificationChannelId: " 900000000000000000 ",
      });

      expect(createRuleMock.mock.calls[0][0]).toEqual({
        guildId: "300000000000000000",
        name: "Project Beta",
        watchedVoiceChannelIds: [
          "700000000000000000",
          "700000000000000001",
        ],
        targetUserIds: ["800000000000000000"],
        notificationChannelId: "900000000000000000",
        enabled: true,
      });
    });
  });

  describe("updateRule", () => {
    it("既存ルールを検証して更新する", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      const updated = await service.updateRule("rule-10", {
        name: "Renamed",
        watchedVoiceChannelIds: ["700000000000000000"],
        targetUserIds: [],
        notificationChannelId: "800000000000000000",
      });

      expect(findByIdMock).toHaveBeenCalledWith("rule-10");
      expect(updateRuleMock.mock.calls[0][1]).toEqual({
        name: "Renamed",
        watchedVoiceChannelIds: ["700000000000000000"],
        targetUserIds: [],
        notificationChannelId: "800000000000000000",
      });
      expect(updated.name).toBe("Renamed");
    });

    it("存在しないルールIDはRuleNotFoundErrorを返す", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(
        service.updateRule("missing", {
          name: "Renamed",
          watchedVoiceChannelIds: ["100000000000000000"],
          targetUserIds: [],
          notificationChannelId: "200000000000000000",
        })
      ).rejects.toBeInstanceOf(RuleNotFoundError);
    });

    it("バリデーションエラーでRuleValidationErrorを返す", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await service
        .updateRule("rule-1", {
          name: "",
          watchedVoiceChannelIds: [],
          targetUserIds: [],
          notificationChannelId: "200000000000000000",
        })
        .then(
          () => {
            throw new Error("expected validation error");
          },
          (error) => {
            expect(error).toBeInstanceOf(RuleValidationError);
          }
        );
    });
  });

  describe("deleteRule", () => {
    it("存在確認後にRepositoryへ削除を委譲", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(service.deleteRule("rule-2")).resolves.toBeUndefined();
      expect(findByIdMock).toHaveBeenCalledWith("rule-2");
      expect(deleteRuleMock).toHaveBeenCalledWith("rule-2");
    });

    it("存在しないルール削除でRuleNotFoundErrorを返す", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(service.deleteRule("missing"))
        .rejects.toBeInstanceOf(RuleNotFoundError);
    });
  });

  describe("toggleRule", () => {
    it("明示的なenabled指定がある場合はその値を使用", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      const toggled = await service.toggleRule("rule-5", true);

      expect(toggleEnabledMock).toHaveBeenCalledWith("rule-5", true);
      expect(toggled.enabled).toBe(true);
    });

    it("指定が無い場合は現在の状態を反転", async () => {
      findByIdMock.mockResolvedValueOnce(makeRule({ id: "rule-6", enabled: false }));
      toggleEnabledMock.mockResolvedValueOnce(makeRule({ id: "rule-6", enabled: true }));
      const service = createRuleService({ notificationRuleRepository: repository });

      const toggled = await service.toggleRule("rule-6");

      expect(toggleEnabledMock).toHaveBeenCalledWith("rule-6", true);
      expect(toggled.enabled).toBe(true);
    });

    it("存在しないルールでRuleNotFoundErrorを返す", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(service.toggleRule("missing"))
        .rejects.toBeInstanceOf(RuleNotFoundError);
    });

    it("Repositoryがnullを返した場合はRuleRepositoryConflictErrorを投げる", async () => {
      toggleEnabledMock.mockResolvedValueOnce(null);
      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(service.toggleRule("rule-7", false))
        .rejects.toBeInstanceOf(RuleRepositoryConflictError);
    });
  });

  describe("listRules", () => {
    it("デフォルトでは有効ルールのみ取得", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await service.listRules(BASE_GUILD_ID);

      expect(findEnabledByGuildMock).toHaveBeenCalledWith(BASE_GUILD_ID);
      expect(findByGuildMock).not.toHaveBeenCalled();
    });

    it("includeDisabledがtrueの場合は全件取得", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });

      await service.listRules(BASE_GUILD_ID, { includeDisabled: true });

      expect(findByGuildMock).toHaveBeenCalledWith(BASE_GUILD_ID);
    });
  });

  describe("getApplicableRules", () => {
    it("VCチャンネルとユーザー条件でフィルタリング", async () => {
      findEnabledByGuildMock.mockResolvedValueOnce([
        makeRule({ id: "rule-A", watchedVoiceChannelIds: ["400000000000000000"], targetUserIds: [] }),
        makeRule({ id: "rule-B", watchedVoiceChannelIds: ["400000000000000000"], targetUserIds: ["500000000000000000"] }),
        makeRule({ id: "rule-C", watchedVoiceChannelIds: ["900000000000000000"], targetUserIds: [] }),
        makeRule({ id: "rule-D", watchedVoiceChannelIds: ["400000000000000000"], targetUserIds: ["900000000000000001"] }),
      ]);
      const service = createRuleService({ notificationRuleRepository: repository });

      const rules = await service.getApplicableRules(
        BASE_GUILD_ID,
        "400000000000000000",
        "500000000000000000"
      );

      expect(findEnabledByGuildMock).toHaveBeenCalledWith(BASE_GUILD_ID);
      expect(rules.map((rule) => rule.id)).toEqual(["rule-A", "rule-B"]);
    });
  });
});
