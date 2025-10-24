import { VoiceState } from "discord.js";

import { NotifyService } from "@/services/notifyService";
import { RuleService } from "@/services/ruleService";
import type { NotificationRule } from "@/types";
import type { NotifyPayload } from "@/services/notifyService";

export interface VoiceStateHandlerDeps {
  ruleService: RuleService;
  notifyService: NotifyService;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
}

export interface VoiceStateHandler {
  handle: (oldState: VoiceState, newState: VoiceState) => Promise<void>;
}

export function createVoiceStateHandler(
  deps: VoiceStateHandlerDeps
): VoiceStateHandler {
  const logger = deps.logger ?? console;

  return {
    async handle(oldState, newState) {
      if (oldState.channelId !== null) {
        return;
      }

      const voiceChannelId = newState.channelId;
      if (!voiceChannelId) {
        return;
      }

      const guildId = newState.guild.id;
      const userId = newState.id;

      let rules;
      try {
        rules = await deps.ruleService.listRules(guildId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error(
          `VoiceStateUpdate: ルール取得に失敗しました (guildId=${guildId}): ${detail}`
        );
        return;
      }

      const candidates = filterApplicableRules(rules, voiceChannelId, userId);

      if (candidates.length === 0) {
        return;
      }

      const uniqueNotifications = createUniqueNotifications(
        candidates,
        guildId,
        voiceChannelId,
        userId
      );

      if (uniqueNotifications.length === 0) {
        return;
      }

      const results = await Promise.allSettled(
        uniqueNotifications.map((payload) =>
          deps.notifyService.sendNotification(payload)
        )
      );

      for (const result of results) {
        if (result.status === "rejected") {
          const detail =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          logger.error(
            `VoiceStateUpdate: 通知送信に失敗しました (guildId=${guildId}, channelId=${voiceChannelId}): ${detail}`
          );
        }
      }
    },
  };
}

/**
 * 適用可能なルールから一意の通知ペイロードを生成します。
 *
 * 同じ通知先チャンネル（notificationChannelId）に対しては、
 * 最初にマッチしたルールのみが使用され、重複送信を防止します。
 *
 * @param rules - 適用可能なルールの配列
 * @param guildId - ギルドID
 * @param voiceChannelId - ボイスチャンネルID
 * @param userId - ユーザーID
 * @returns 一意の通知ペイロードの配列
 */
function createUniqueNotifications(
  rules: NotificationRule[],
  guildId: string,
  voiceChannelId: string,
  userId: string
): NotifyPayload[] {
  const sentChannelIds = new Set<string>();
  const notifications: NotifyPayload[] = [];

  for (const rule of rules) {
    if (sentChannelIds.has(rule.notificationChannelId)) {
      continue;
    }

    sentChannelIds.add(rule.notificationChannelId);
    notifications.push({
      guildId,
      voiceChannelId,
      userId,
      notificationChannelId: rule.notificationChannelId,
      ruleId: rule.id,
      ruleName: rule.name,
    });
  }

  return notifications;
}

function filterApplicableRules(
  rules: NotificationRule[],
  voiceChannelId: string,
  userId: string
): NotificationRule[] {
  return rules.filter((rule) => {
    if (!rule.watchedVoiceChannelIds.includes(voiceChannelId)) {
      return false;
    }

    if (rule.targetUserIds.length === 0) {
      return true;
    }

    return rule.targetUserIds.includes(userId);
  });
}
