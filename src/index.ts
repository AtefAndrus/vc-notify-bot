import { mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { Client, GatewayIntentBits } from "discord.js";
import { Database } from "bun:sqlite";

import {
  createNotificationRuleRepository,
  NotificationRuleRepository,
  NotificationRuleRepositoryDeps,
} from "@/repositories/notificationRuleRepository";
import { createMigrationRunner } from "@/database/migrations";
import {
  createNotifyService,
  NotifyService,
  NotifyServiceDeps,
} from "@/services/notifyService";
import {
  createRuleService,
  RuleService,
  RuleServiceDeps,
} from "@/services/ruleService";

export interface AppConfig {
  discordToken: string;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  dataDir: string;
}

export type MinimalClient = Pick<Client, "once" | "login">;

export interface ApplicationServices {
  ruleService: RuleService;
  notifyService: NotifyService;
}

export interface BootstrapResult {
  client: MinimalClient;
  config: AppConfig;
  services: ApplicationServices;
  notificationRuleRepository: NotificationRuleRepository;
}

const DEFAULT_DB_PATH = "./data/bot.db";
const DATA_ROOT = resolve(process.cwd(), "data");

export interface BootstrapDependencies {
  clientFactory?: (
    config: AppConfig,
    services: ApplicationServices
  ) => MinimalClient;
  ensureDataDir?: (path: string) => void | Promise<void>;
  logger?: Pick<typeof console, "info" | "error">;
  notificationRuleRepositoryFactory?: (
    config: AppConfig
  ) => NotificationRuleRepository;
  ruleServiceFactory?: (deps: RuleServiceDeps) => RuleService;
  notifyServiceFactory?: (deps: NotifyServiceDeps) => NotifyService;
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

  const dbPath = resolveDbPath(readEnv("DB_PATH"));
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

  try {
    mkdirSync(path, { recursive: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`データディレクトリの作成に失敗しました: ${detail}`, {
      cause: error,
    });
  }
}

function defaultClientFactory(
  _config: AppConfig,
  _services: ApplicationServices
): MinimalClient {
  // TODO(#2): DI からハンドラー群を受け取り、イベント登録を拡張する
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
}

export async function bootstrap(
  deps: BootstrapDependencies = {}
): Promise<BootstrapResult> {
  const config = loadConfig();
  const ensureDir = deps.ensureDataDir ?? ensureDataDir;
  await Promise.resolve(ensureDir(config.dataDir));

  const logger = deps.logger ?? console;
  const migrationRunner = createMigrationRunner({
    dbPath: config.dbPath,
    logger,
  });
  await migrationRunner.runMigrations();
  const notificationRuleRepository =
    deps.notificationRuleRepositoryFactory?.(config) ??
    createNotificationRuleRepository(createRepositoryDeps(config));

  const ruleService = (deps.ruleServiceFactory ?? createRuleService)({
    notificationRuleRepository,
  });

  const notifyService = (deps.notifyServiceFactory ?? createNotifyService)(
    createNotifyServiceDeps(logger)
  );

  const services: ApplicationServices = {
    ruleService,
    notifyService,
  };

  const client = (deps.clientFactory ?? defaultClientFactory)(
    config,
    services
  );

  client.once("ready", () => {
    logger.info("Discord client 初期化完了");
  });

  try {
    await client.login(config.discordToken);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました";
    logger.error(`Discord クライアントのログインに失敗しました: ${message}`);
    throw error;
  }

  return { client, config, services, notificationRuleRepository };
}

if (import.meta.main) {
  await bootstrap();
}

function resolveDbPath(rawPath: string | undefined): string {
  const candidate = rawPath ?? DEFAULT_DB_PATH;
  const resolved = resolve(process.cwd(), candidate);
  const relativeToRoot = relative(DATA_ROOT, resolved);

  if (relativeToRoot.startsWith("..")) {
    throw new Error(
      `DB_PATH は ${DATA_ROOT} 配下のパスのみ指定できます: ${candidate}`
    );
  }

  return resolved;
}

function createRepositoryDeps(
  config: AppConfig
): NotificationRuleRepositoryDeps {
  const db = new Database(config.dbPath);
  return {
    db,
  };
}

function createNotifyServiceDeps(
  _logger: Pick<typeof console, "info" | "error">
): NotifyServiceDeps {
  // TODO(#4): Discord クライアントやテンプレート設定を注入
  return {};
}
