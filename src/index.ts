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
import {
  createVoiceStateHandler,
  type VoiceStateHandler,
  type VoiceStateHandlerDeps,
} from "@/handlers/voiceState";

export interface AppConfig {
  discordToken: string;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  dataDir: string;
}

export type MinimalClient = Pick<Client, "once" | "login" | "on">;

export interface ApplicationServices {
  ruleService: RuleService;
  notifyService: NotifyService;
}

export interface BootstrapResult {
  client: MinimalClient;
  config: AppConfig;
  services: ApplicationServices;
  notificationRuleRepository: NotificationRuleRepository;
  cleanup: () => void;
}

const DEFAULT_DB_PATH = "./data/bot.db";
const DATA_ROOT = resolve(process.cwd(), "data");

export interface BootstrapDependencies {
  clientFactory?: (
    config: AppConfig,
    services: ApplicationServices
  ) => MinimalClient;
  ensureDataDir?: (path: string) => void | Promise<void>;
  logger?: Pick<typeof console, "info" | "error" | "warn">;
  notificationRuleRepositoryFactory?: (
    config: AppConfig
  ) => NotificationRuleRepository;
  ruleServiceFactory?: (deps: RuleServiceDeps) => RuleService;
  notifyServiceFactory?: (deps: NotifyServiceDeps) => NotifyService;
  voiceStateHandlerFactory?: (
    deps: VoiceStateHandlerDeps
  ) => VoiceStateHandler;
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
  let repositoryDeps: NotificationRuleRepositoryDeps | undefined;
  const notificationRuleRepository =
    deps.notificationRuleRepositoryFactory?.(config) ??
    createNotificationRuleRepository(
      (repositoryDeps = createRepositoryDeps(config, logger))
    );

  const ruleService = (deps.ruleServiceFactory ?? createRuleService)({
    notificationRuleRepository,
  });

  let discordClientRef: Client | undefined;
  const notifyService = (deps.notifyServiceFactory ?? createNotifyService)(
    createNotifyServiceDeps(
      () => {
        if (!discordClientRef) {
          throw new Error("Discord client is not initialized");
        }
        return discordClientRef;
      },
      logger
    )
  );

  const services: ApplicationServices = {
    ruleService,
    notifyService,
  };

  const client = (deps.clientFactory ?? defaultClientFactory)(
    config,
    services
  );
  discordClientRef = client;

  const voiceStateHandler =
    (deps.voiceStateHandlerFactory ?? createVoiceStateHandler)({
      ruleService,
      notifyService,
      logger,
    });

  client.on("voiceStateUpdate", (oldState, newState) =>
    voiceStateHandler
      .handle(oldState, newState)
      .catch((error) => {
        const detail =
          error instanceof Error ? error.message : String(error);
        logger.error(
          `VoiceStateUpdate: ハンドラー実行中に未処理の例外が発生しました: ${detail}`
        );
      })
  );

  client.once("ready", () => {
    logger.info("Discord client 初期化完了");
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      notifyService.cleanup();
    } catch (rawError) {
      const message =
        rawError instanceof Error ? rawError.message : String(rawError);
      logger.error(`NotifyService cleanup failed: ${message}`);
    }
    if (!repositoryDeps) {
      return;
    }
    try {
      repositoryDeps.db.close();
    } catch (rawError) {
      const message =
        rawError instanceof Error ? rawError.message : String(rawError);
      logger.error(`Database close failed: ${message}`);
    }
  };

  try {
    await client.login(config.discordToken);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました";
    logger.error(`Discord クライアントのログインに失敗しました: ${message}`);
    cleanup();
    throw error;
  }

  return { client, config, services, notificationRuleRepository, cleanup };
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
  config: AppConfig,
  logger?: Pick<typeof console, "warn">
): NotificationRuleRepositoryDeps {
  const db = new Database(config.dbPath);
  return {
    db,
    logger,
  };
}

function createNotifyServiceDeps(
  getClient: () => Pick<Client, "guilds" | "channels">,
  logger: Pick<typeof console, "info" | "warn" | "error">
): NotifyServiceDeps {
  // TODO(#4): Discord クライアントやテンプレート設定を注入
  return {
    getClient,
    logger,
  };
}
