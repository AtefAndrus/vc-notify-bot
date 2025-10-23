import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { VoiceState } from "discord.js";

import { createVoiceStateHandler } from "@/handlers/voiceState";
import type { NotificationRule } from "@/types";
import type { NotifyService } from "@/services/notifyService";
import type { RuleService } from "@/services/ruleService";

interface TestLogger {
  info: ReturnType<typeof mock<(message: string) => void>>;
  warn: ReturnType<typeof mock<(message: string) => void>>;
  error: ReturnType<typeof mock<(message: string) => void>>;
}

describe("VoiceStateHandler", () => {
  let notifyService: NotifyService;
  let ruleService: RuleService;
  let logger: TestLogger;

  beforeEach(() => {
    notifyService = {
      sendNotification: mock(async () => {}),
    };
    ruleService = {
      listRules: mock(async () => [] as NotificationRule[]),
    };
    logger = {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    };
  });

  it("VC参加時に対象ルールを評価し通知を送信する", async () => {
    const guildId = "guild-1";
    const voiceChannelId = "voice-1";
    const userId = "user-1";

    const applicableRule: NotificationRule = createRule({
      guildId,
      watchedVoiceChannelIds: [voiceChannelId],
      targetUserIds: [],
      notificationChannelId: "notify-1",
    });

    (ruleService.listRules as any).mockResolvedValue([applicableRule]);

    const handler = createVoiceStateHandler({
      notifyService,
      ruleService,
      logger,
    });

    await handler.handle(
      createVoiceState({ guildId, userId, channelId: null }),
      createVoiceState({ guildId, userId, channelId: voiceChannelId })
    );

    expect(ruleService.listRules).toHaveBeenCalledWith(guildId);
    expect(notifyService.sendNotification).toHaveBeenCalledWith({
      guildId,
      voiceChannelId,
      userId,
      notificationChannelId: "notify-1",
    });
  });

  it("移動や退出イベントではルール評価を行わない", async () => {
    const handler = createVoiceStateHandler({ notifyService, ruleService, logger });

    await handler.handle(
      createVoiceState({ guildId: "guild", userId: "user", channelId: "voice" }),
      createVoiceState({ guildId: "guild", userId: "user", channelId: "voice-2" })
    );

    expect(ruleService.listRules).not.toHaveBeenCalled();
    expect(notifyService.sendNotification).not.toHaveBeenCalled();
  });

  it("ターゲットユーザーに一致しない場合は通知を送信しない", async () => {
    const guildId = "guild-2";
    const voiceChannelId = "voice-2";
    const userId = "user-2";

    const nonMatchingRule = createRule({
      guildId,
      watchedVoiceChannelIds: [voiceChannelId],
      targetUserIds: ["other-user"],
      notificationChannelId: "notify-2",
    });

    (ruleService.listRules as any).mockResolvedValue([nonMatchingRule]);

    const handler = createVoiceStateHandler({ notifyService, ruleService, logger });

    await handler.handle(
      createVoiceState({ guildId, userId, channelId: null }),
      createVoiceState({ guildId, userId, channelId: voiceChannelId })
    );

    expect(notifyService.sendNotification).not.toHaveBeenCalled();
  });

  it("重複する通知先は1回のみ送信する", async () => {
    const guildId = "guild-3";
    const voiceChannelId = "voice-3";
    const userId = "user-3";

    const ruleA = createRule({
      guildId,
      watchedVoiceChannelIds: [voiceChannelId],
      targetUserIds: [],
      notificationChannelId: "notify-3",
    });
    const ruleB = createRule({
      guildId,
      watchedVoiceChannelIds: [voiceChannelId],
      targetUserIds: [userId],
      notificationChannelId: "notify-3",
    });

    (ruleService.listRules as any).mockResolvedValue([ruleA, ruleB]);

    const handler = createVoiceStateHandler({ notifyService, ruleService, logger });

    await handler.handle(
      createVoiceState({ guildId, userId, channelId: null }),
      createVoiceState({ guildId, userId, channelId: voiceChannelId })
    );

    expect(notifyService.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("NotifyServiceで例外が発生してもロギングのみで処理を継続する", async () => {
    const guildId = "guild-4";
    const voiceChannelId = "voice-4";
    const userId = "user-4";

    const rule = createRule({
      guildId,
      watchedVoiceChannelIds: [voiceChannelId],
      targetUserIds: [],
      notificationChannelId: "notify-4",
    });

    (ruleService.listRules as any).mockResolvedValue([rule]);
    (notifyService.sendNotification as any).mockRejectedValue(
      new Error("send failed")
    );

    const handler = createVoiceStateHandler({ notifyService, ruleService, logger });

    await expect(
      handler.handle(
        createVoiceState({ guildId, userId, channelId: null }),
        createVoiceState({ guildId, userId, channelId: voiceChannelId })
      )
    ).resolves.toBeUndefined();

    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
  });

  it("ルール取得時の例外を補足してログに記録する", async () => {
    const guildId = "guild-5";

    (ruleService.listRules as any).mockRejectedValue(new Error("list error"));

    const handler = createVoiceStateHandler({ notifyService, ruleService, logger });

    await expect(
      handler.handle(
        createVoiceState({ guildId, userId: "user", channelId: null }),
        createVoiceState({ guildId, userId: "user", channelId: "voice" })
      )
    ).resolves.toBeUndefined();

    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
  });
});

interface CreateVoiceStateOptions {
  guildId: string;
  userId: string;
  channelId: string | null;
}

function createVoiceState(options: CreateVoiceStateOptions): VoiceState {
  return {
    id: options.userId,
    channelId: options.channelId,
    guild: {
      id: options.guildId,
    } as any,
  } as VoiceState;
}

interface CreateRuleOptions {
  guildId: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

function createRule(options: CreateRuleOptions): NotificationRule {
  return {
    id: randomUUID(),
    guildId: options.guildId,
    name: "rule",
    watchedVoiceChannelIds: options.watchedVoiceChannelIds,
    targetUserIds: options.targetUserIds,
    notificationChannelId: options.notificationChannelId,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
