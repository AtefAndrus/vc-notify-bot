import { beforeEach, describe, expect, it, mock } from "bun:test";

import { createRuleService } from "@/services/ruleService";
import type { NotificationRuleRepository } from "@/repositories/notificationRuleRepository";
import type { NotificationRule } from "@/types";

const baseRule: NotificationRule = {
  id: "rule-1",
  guildId: "guild-1",
  name: "Rule 1",
  watchedVoiceChannelIds: ["voice-1"],
  targetUserIds: [],
  notificationChannelId: "notify-1",
  enabled: true,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

describe("RuleService", () => {
  let repository: NotificationRuleRepository;

  beforeEach(() => {
    repository = {
      createRule: mock(async () => baseRule),
      findById: mock(async () => baseRule),
      findByGuild: mock(async () => [baseRule]),
      findEnabledByGuild: mock(async () => [baseRule]),
      updateRule: mock(async () => baseRule),
      deleteRule: mock(async () => {}),
      toggleEnabled: mock(async () => baseRule),
      countByGuild: mock(async () => 1),
    } as NotificationRuleRepository;
  });

  describe("listRules", () => {
    it("RepositoryのfindEnabledByGuildからルール一覧を返す", async () => {
      const service = createRuleService({ notificationRuleRepository: repository });
      const guildId = "guild-123";

      const rules = await service.listRules(guildId);

      expect(repository.findEnabledByGuild).toHaveBeenCalledWith(guildId);
      expect(rules).toEqual([baseRule]);
    });

    it("Repositoryエラーをそのまま伝播する", async () => {
      (repository.findEnabledByGuild as any).mockRejectedValue(new Error("db error"));

      const service = createRuleService({ notificationRuleRepository: repository });

      await expect(service.listRules("guild"))
        .rejects.toThrowError("db error");
    });
  });
});
