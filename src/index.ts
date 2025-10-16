import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Client, GatewayIntentBits } from "discord.js";

export interface AppConfig {
  discordToken: string;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  dataDir: string;
}

type MinimalClient = Pick<Client, "once" | "login">;

export interface BootstrapDependencies {
  clientFactory?: (config: AppConfig) => MinimalClient;
  ensureDataDir?: (path: string) => void | Promise<void>;
  logger?: Pick<typeof console, "info" | "error">;
}

function readEnv(key: string): string | undefined {
  const value = Bun.env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadConfig(): AppConfig {
  const discordToken = readEnv("DISCORD_TOKEN");
  if (!discordToken) {
    throw new Error("環境変数 DISCORD_TOKEN が設定されていません。");
  }

  const dbPath = readEnv("DB_PATH") ?? "./data/bot.db";
  const logLevel = readEnv("LOG_LEVEL") ?? "info";
  const nodeEnv = readEnv("NODE_ENV") ?? "production";
  const dataDir = dirname(dbPath);

  return {
    discordToken,
    dbPath,
    logLevel,
    nodeEnv,
    dataDir,
  };
}

export function ensureDataDir(path: string): void {
  if (!path) {
    return;
  }
  mkdirSync(path, { recursive: true });
}

function defaultClientFactory(): MinimalClient {
  // TODO(#2): DI からハンドラー群を受け取り、イベント登録を拡張する
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
}

export async function bootstrap(
  deps: BootstrapDependencies = {}
): Promise<{ client: MinimalClient; config: AppConfig }> {
  const config = loadConfig();
  const ensureDir = deps.ensureDataDir ?? ensureDataDir;
  await Promise.resolve(ensureDir(config.dataDir));

  const logger = deps.logger ?? console;
  const client = (deps.clientFactory ?? defaultClientFactory)(config);

  client.once("ready", () => {
    logger.info("Discord client 初期化完了");
  });

  try {
    await client.login(config.discordToken);
  } catch (error) {
    logger.error("Discord クライアントのログインに失敗しました", error);
    throw error;
  }

  return { client, config };
}

if (import.meta.main) {
  await bootstrap();
}
