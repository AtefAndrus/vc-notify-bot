import {
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  TextBasedChannel,
  VoiceBasedChannel,
  type Message,
  type MessageCreateOptions,
  type MessagePayload,
  type User,
} from "discord.js";

export interface NotifyPayload {
  guildId: string;
  voiceChannelId: string;
  userId: string;
  notificationChannelId: string;
  ruleId: string;
  ruleName: string;
}

export interface NotifyService {
  sendNotification: (payload: NotifyPayload) => Promise<void>;
  cleanup: () => void;
}

export interface NotifyServiceDeps {
  getClient: () => Pick<Client, "guilds" | "channels">;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
  duplicateTtlMs?: number;
  getNow?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const DUPLICATE_WINDOW_DEFAULT_MS = 5_000;
const RATE_LIMIT_FALLBACK_DELAY_MS = 1_000;

type TimerHandle = ReturnType<typeof setTimeout>;
type SendableTextChannel = Extract<
  TextBasedChannel,
  {
    send: (
      options: string | MessagePayload | MessageCreateOptions
    ) => Promise<Message>;
  }
>;

export function createNotifyService(deps: NotifyServiceDeps): NotifyService {
  const logger = deps.logger ?? console;
  const duplicateTtlMs = Math.max(0, deps.duplicateTtlMs ?? DUPLICATE_WINDOW_DEFAULT_MS);
  const getNow = deps.getNow ?? (() => new Date());
  const scheduleTimeout = deps.setTimeoutFn ?? setTimeout;
  const cancelTimeout = deps.clearTimeoutFn ?? clearTimeout;

  const recentNotifications = new Map<string, TimerHandle>();
  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      scheduleTimeout(resolve, ms);
    });

  return {
    async sendNotification(payload) {
      const notificationKey = createNotificationKey(payload);
      if (isDuplicate(notificationKey)) {
        logger.info(
          `NotifyService: 重複送信を抑制しました (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId})`
        );
        return;
      }

      let client: Pick<Client, "guilds" | "channels">;
      try {
        client = deps.getClient();
      } catch (error) {
        logger.error(
          `NotifyService: Discord クライアントを取得できませんでした (ruleId=${payload.ruleId}): ${errorToMessage(error)}`
        );
        throw error;
      }

      const guild = await fetchGuild(client, payload.guildId, logger);
      const voiceChannel = await fetchVoiceChannel(guild, payload.voiceChannelId, logger);
      if (!voiceChannel) {
        trackNotification(notificationKey);
        return;
      }

      const member = await fetchMember(guild, payload.userId, logger);
      if (!member) {
        trackNotification(notificationKey);
        return;
      }

      const notifyChannel = await fetchNotificationChannel(
        client,
        payload.notificationChannelId,
        logger
      );
      if (!notifyChannel) {
        trackNotification(notificationKey);
        return;
      }

      const now = getNow();
      const embed = createEmbed(payload, member.user, voiceChannel, now);

      await sendWithRetry(
        notifyChannel,
        embed,
        payload,
        logger,
        delay,
        async () => {
          trackNotification(notificationKey);
        }
      );
    },
    cleanup() {
      for (const handle of recentNotifications.values()) {
        cancelTimeout(handle);
      }
      recentNotifications.clear();
    },
  };

  function isDuplicate(key: string): boolean {
    return duplicateTtlMs > 0 && recentNotifications.has(key);
  }

  function trackNotification(key: string): void {
    if (duplicateTtlMs <= 0) {
      return;
    }

    const existing = recentNotifications.get(key);
    if (existing) {
      cancelTimeout(existing);
      recentNotifications.delete(key);
    }

    const handle = scheduleTimeout(() => {
      recentNotifications.delete(key);
    }, duplicateTtlMs);
    recentNotifications.set(key, handle);
  }
}

function createNotificationKey(payload: NotifyPayload): string {
  return `${payload.notificationChannelId}:${payload.userId}:${payload.voiceChannelId}`;
}

async function fetchGuild(
  client: Pick<Client, "guilds">,
  guildId: string,
  logger: Pick<typeof console, "info" | "warn" | "error">
): Promise<Guild> {
  try {
    return await client.guilds.fetch(guildId);
  } catch (error) {
    logger.error(
      `NotifyService: ギルド取得に失敗しました (guildId=${guildId}): ${errorToMessage(error)}`
    );
    throw error;
  }
}

async function fetchVoiceChannel(
  guild: Guild,
  channelId: string,
  logger: Pick<typeof console, "info" | "warn" | "error">
): Promise<VoiceBasedChannel | null> {
  const cached = guild.channels.cache.get(channelId);
  if (isVoiceChannel(cached)) {
    return cached;
  }

  try {
    const fetched = await guild.channels.fetch(channelId);
    if (isVoiceChannel(fetched)) {
      return fetched;
    }
  } catch (error) {
    logger.warn(
      `NotifyService: ボイスチャンネル取得に失敗しました (channelId=${channelId}): ${errorToMessage(error)}`
    );
    return null;
  }

  logger.warn(
    `NotifyService: ボイスチャンネルが見つかりません (channelId=${channelId})`
  );
  return null;
}

async function fetchMember(
  guild: Guild,
  userId: string,
  logger: Pick<typeof console, "info" | "warn" | "error">
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (error) {
    logger.warn(
      `NotifyService: ギルドメンバー取得に失敗しました (userId=${userId}): ${errorToMessage(error)}`
    );
    return null;
  }
}

async function fetchNotificationChannel(
  client: Pick<Client, "channels">,
  channelId: string,
  logger: Pick<typeof console, "info" | "warn" | "error">
): Promise<SendableTextChannel | null> {
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    logger.error(
      `NotifyService: 通知チャンネルの取得に失敗しました (channelId=${channelId}): ${errorToMessage(error)}`
    );
    throw error;
  }

  if (!isTextChannel(channel)) {
    logger.warn(
      `NotifyService: 通知チャンネルがテキストチャンネルではありません (channelId=${channelId})`
    );
    return null;
  }

  return channel;
}

function createEmbed(
  payload: NotifyPayload,
  user: User,
  voiceChannel: VoiceBasedChannel,
  now: Date
): EmbedBuilder {
  const builder = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔔 ${payload.ruleName}`)
    .setAuthor({
      name: user.tag,
      iconURL: user.displayAvatarURL(),
    })
    .addFields(
      {
        name: "参加VC",
        value: voiceChannel.name,
        inline: true,
      },
      {
        name: "時刻",
        value: formatTimestampJst(now),
        inline: true,
      }
    )
    .setFooter({ text: `Rule ID: ${payload.ruleId}` })
    .setTimestamp(now);

  return builder;
}

function formatTimestampJst(date: Date): string {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const tokens: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") {
      continue;
    }
    tokens[part.type] = part.value;
  }

  const year = tokens.year ?? "0000";
  const month = tokens.month ?? "00";
  const day = tokens.day ?? "00";
  const hour = tokens.hour ?? "00";
  const minute = tokens.minute ?? "00";
  const second = tokens.second ?? "00";

  return `${year}-${month}-${day} ${hour}:${minute}:${second} JST`;
}

async function sendWithRetry(
  channel: SendableTextChannel,
  embed: EmbedBuilder,
  payload: NotifyPayload,
  logger: Pick<typeof console, "info" | "warn" | "error">,
  delayFn: (ms: number) => Promise<void>,
  onSuccess: () => Promise<void> | void
): Promise<void> {
  try {
    await channel.send({ embeds: [embed] });
    logger.info(
      `NotifyService: 通知を送信しました (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId})`
    );
    await onSuccess();
    return;
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryDelay = getRetryAfterMs(error);
      logger.warn(
        `NotifyService: Rate Limit に達しました。${retryDelay}ms 後にリトライします (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId})`
      );
      await delayFn(retryDelay);
      try {
        await channel.send({ embeds: [embed] });
        logger.info(
          `NotifyService: 通知をリトライ送信しました (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId})`
        );
        await onSuccess();
        return;
      } catch (retryError) {
        logger.error(
          `NotifyService: Rate Limit リトライ後も通知送信に失敗しました (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId}): ${errorToMessage(
            retryError
          )}`
        );
        throw retryError;
      }
    }

    logger.error(
      `NotifyService: 通知送信に失敗しました (ruleId=${payload.ruleId}, channelId=${payload.notificationChannelId}): ${errorToMessage(
        error
      )}`
    );
    throw error;
  }
}

function isVoiceChannel(channel: unknown): channel is VoiceBasedChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const candidate = channel as VoiceBasedChannel & { type?: ChannelType };

  if (typeof candidate.isVoiceBased === "function") {
    return candidate.isVoiceBased();
  }

  if ("type" in candidate && candidate.type !== undefined) {
    return (
      candidate.type === ChannelType.GuildVoice ||
      candidate.type === ChannelType.GuildStageVoice
    );
  }

  return false;
}

function isTextChannel(channel: unknown): channel is SendableTextChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const candidate = channel as TextBasedChannel;

  if (typeof candidate.isTextBased === "function") {
    if (!candidate.isTextBased()) {
      return false;
    }
  }

  return (
    // Fallback for partial mocks
    typeof (candidate as { send?: unknown }).send === "function"
  );
}

function isRateLimitError(error: unknown): error is { status?: number; retryAfter?: number; retry_after?: number } {
  if (!error || typeof error !== "object") {
    return false;
  }
  const status = (error as { status?: number }).status;
  return status === 429;
}

function getRetryAfterMs(error: { retryAfter?: number; retry_after?: number }): number {
  const retryAfter = error.retryAfter ?? error.retry_after;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    // discord.js exposes retryAfter in milliseconds
    return Math.max(0, retryAfter);
  }
  return RATE_LIMIT_FALLBACK_DELAY_MS;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
