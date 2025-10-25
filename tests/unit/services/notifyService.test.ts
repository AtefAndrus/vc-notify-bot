import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { createNotifyService } from "@/services/notifyService";
import type { Message } from "discord.js";

const BASE_GUILD_ID = "100000000000000001";
const VOICE_CHANNEL_ID = "200000000000000000";
const NOTIFICATION_CHANNEL_ID = "300000000000000000";
const USER_ID = "400000000000000000";

function createMockLogger() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("NotifyService", () => {
  const now = new Date("2025-10-25T08:00:00Z");
  let logger: ReturnType<typeof createMockLogger>;
  let voiceChannel: any;
  let textChannel: any;
  let guild: any;
  let client: any;
  let sendMock: ReturnType<typeof mock<(payload: unknown) => Promise<Message>>>;
  let messageStub: Message;

  beforeEach(() => {
    logger = createMockLogger();
    messageStub = { id: "message-id" } as Message;
    sendMock = mock(async () => messageStub);

    voiceChannel = {
      id: VOICE_CHANNEL_ID,
      name: "開発VC",
      isVoiceBased: () => true,
    };

    textChannel = {
      id: NOTIFICATION_CHANNEL_ID,
      isTextBased: () => true,
      send: sendMock,
    };

    guild = {
      id: BASE_GUILD_ID,
      channels: {
        cache: new Map([[VOICE_CHANNEL_ID, voiceChannel]]),
        fetch: mock(async (id: string) => {
          if (id === VOICE_CHANNEL_ID) {
            return voiceChannel;
          }
          return null;
        }),
      },
      members: {
        fetch: mock(async (id: string) => {
          if (id !== USER_ID) {
            throw new Error("member not found");
          }
          return {
            id: USER_ID,
            user: {
              id: USER_ID,
              tag: "tester#1234",
              displayAvatarURL: () => "https://cdn.example/avatar.png",
            },
          };
        }),
      },
    };

    client = {
      guilds: {
        fetch: mock(async (id: string) => {
          if (id === BASE_GUILD_ID) {
            return guild;
          }
          throw new Error("guild not found");
        }),
      },
      channels: {
        fetch: mock(async (id: string) => {
          if (id === NOTIFICATION_CHANNEL_ID) {
            return textChannel;
          }
          return null;
        }),
      },
    };
  });

  afterEach(() => {
    sendMock.mockReset();
  });

  it("Embed を生成して通知チャンネルに送信する", async () => {
    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 5000,
      getNow: () => now,
    });

    await service.sendNotification({
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0] as { embeds?: unknown[] };
    expect(payload.embeds).toBeDefined();
    expect(Array.isArray(payload.embeds)).toBe(true);
    expect(payload.embeds?.length).toBe(1);
    const embed = (payload.embeds?.[0] as any)?.data ?? {};
    expect(embed.title).toBe("🔔 開発チーム通知");
    expect(embed.author).toEqual({
      name: "tester#1234",
      icon_url: "https://cdn.example/avatar.png",
    });
    expect(embed.footer?.text).toBe("Rule ID: rule-1");
    const fields = embed.fields ?? [];
    expect(fields).toContainEqual({
      name: "参加VC",
      value: "開発VC",
      inline: true,
    });
    expect(fields).toContainEqual({
      name: "時刻",
      value: "2025-10-25 17:00:00 JST",
      inline: true,
    });

    service.cleanup();
  });

  it("重複キーの通知を一定時間抑制する", async () => {
    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 20,
      getNow: () => now,
    });

    const payload = {
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    };

    await service.sendNotification(payload);
    await service.sendNotification(payload);

    expect(sendMock).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 30));

    await service.sendNotification(payload);
    expect(sendMock).toHaveBeenCalledTimes(2);

    service.cleanup();
  });

  it("Rate Limit エラー時に1回だけリトライする", async () => {
    let attempt = 0;
    sendMock = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        const error: any = new Error("Too many requests");
        error.status = 429;
        error.retryAfter = 5;
        throw error;
      }
      return messageStub;
    });
    textChannel.send = sendMock;

    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 50,
      getNow: () => now,
    });

    await service.sendNotification({
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    });

    expect(sendMock).toHaveBeenCalledTimes(2);

    service.cleanup();
  });

  it("通知チャンネルがテキスト系でない場合は送信しない", async () => {
    textChannel.isTextBased = () => false;

    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 50,
      getNow: () => now,
    });

    await service.sendNotification({
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();

    service.cleanup();
  });

  it("Rate Limit リトライ後も失敗した場合は例外をスローする", async () => {
    sendMock = mock(async () => {
      const error: any = new Error("Too many requests");
      error.status = 429;
      error.retryAfter = 5;
      throw error;
    });
    textChannel.send = sendMock;

    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 50,
      getNow: () => now,
    });

    await expect(
      service.sendNotification({
        guildId: BASE_GUILD_ID,
        voiceChannelId: VOICE_CHANNEL_ID,
        userId: USER_ID,
        notificationChannelId: NOTIFICATION_CHANNEL_ID,
        ruleId: "rule-1",
        ruleName: "開発チーム通知",
      })
    ).rejects.toThrow("Too many requests");

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Rate Limit リトライ後も通知送信に失敗しました")
    );

    service.cleanup();
  });

  it("retryAfter が不正な値の場合はフォールバック値を使用する", async () => {
    let attempt = 0;
    sendMock = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        const error: any = new Error("Too many requests");
        error.status = 429;
        error.retryAfter = Number.NaN;
        throw error;
      }
      return messageStub;
    });
    textChannel.send = sendMock;

    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 50,
      getNow: () => now,
    });

    await service.sendNotification({
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("1000ms 後にリトライします")
    );

    service.cleanup();
  });

  it("ボイスチャンネル取得失敗時は一定時間再試行を抑制する", async () => {
    const fetchMock = mock(async () => {
      throw new Error("network error");
    });
    guild.channels.fetch = fetchMock;
    guild.channels.cache = new Map();

    const service = createNotifyService({
      getClient: () => client,
      logger,
      duplicateTtlMs: 50,
      getNow: () => now,
    });

    const payload = {
      guildId: BASE_GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      userId: USER_ID,
      notificationChannelId: NOTIFICATION_CHANNEL_ID,
      ruleId: "rule-1",
      ruleName: "開発チーム通知",
    };

    await service.sendNotification(payload);
    await service.sendNotification(payload);

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ボイスチャンネル取得に失敗しました")
    );

    service.cleanup();
  });
});
