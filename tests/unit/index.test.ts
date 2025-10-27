import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

import {
  bootstrap,
  ensureDataDir,
  loadConfig,
  type ApplicationServices,
  type MinimalClient,
} from "@/index";
import type {
  VoiceStateHandler,
  VoiceStateHandlerDeps,
} from "@/handlers/voiceState";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { commandDefinitions } from "@/commands/definitions";

const mutableEnv = Bun.env as Record<string, string | undefined>;

const originalEnv = { ...Bun.env };

function resetEnv() {
  for (const key of Object.keys(mutableEnv)) {
    if (!(key in originalEnv)) {
      delete mutableEnv[key];
    }
  }

  for (const key of Object.keys(originalEnv)) {
    mutableEnv[key] = originalEnv[key];
  }
}

beforeEach(resetEnv);

afterEach(resetEnv);

describe("loadConfig", () => {
  it("DISCORD_TOKEN が未設定の場合にエラーを投げる", () => {
    mutableEnv.DISCORD_TOKEN = undefined;

    expect(() => loadConfig()).toThrowError(/DISCORD_TOKEN/);
  });

  it("DISCORD_TOKEN が空白のみの場合にエラーを投げる", () => {
    mutableEnv.DISCORD_TOKEN = "   ";

    expect(() => loadConfig()).toThrowError(/DISCORD_TOKEN/);
  });

  it("必須値とデフォルト値を含む設定を返す", () => {
    mutableEnv.DISCORD_TOKEN = "token";
    mutableEnv.DB_PATH = "./data/bot.db";
    mutableEnv.LOG_LEVEL = "debug";
    mutableEnv.NODE_ENV = "development";

    const config = loadConfig();

    expect(config).toEqual({
      discordToken: "token",
      dbPath: resolve(process.cwd(), "./data/bot.db"),
      logLevel: "debug",
      nodeEnv: "development",
      dataDir: resolve(process.cwd(), "./data"),
    });
  });

  it("プロジェクト data 配下以外の DB_PATH は拒否する", () => {
    mutableEnv.DISCORD_TOKEN = "token";
    mutableEnv.DB_PATH = "../bot.db";

    expect(() => loadConfig()).toThrowError(/DB_PATH/);
  });
});

describe("ensureDataDir", () => {
  it("存在しないディレクトリを作成する", () => {
    const tmpRoot = mkdtempSync(join(os.tmpdir(), "vc-notify-test-"));
    const target = join(tmpRoot, "data");

    expect(existsSync(target)).toBeFalse();

    ensureDataDir(target);

    expect(existsSync(target)).toBeTrue();

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("既存ディレクトリに対してもエラーなく処理する", () => {
    const tmpRoot = mkdtempSync(join(os.tmpdir(), "vc-notify-test-"));

    ensureDataDir(tmpRoot);
    expect(existsSync(tmpRoot)).toBeTrue();

    rmSync(tmpRoot, { recursive: true, force: true });
  });
});

describe("bootstrap", () => {
  it("設定を読み込み、データディレクトリを準備し、ログインする", async () => {
    mutableEnv.DISCORD_TOKEN = "token";
    mutableEnv.DB_PATH = "./data/custom.db";

    const ensuredPaths: string[] = [];
    const { client, onceMock, loginMock } = createClientStub();

    let receivedServices: ApplicationServices | undefined;

    const result = await bootstrap({
      clientFactory: (_config, services) => {
        receivedServices = services;
        return client;
      },
      ensureDataDir: (path) => {
        ensuredPaths.push(path);
      },
    });

    expect(ensuredPaths).toContain(resolve(process.cwd(), "data"));
    expect(loginMock.mock.calls.length).toBe(1);
    const loginArgs = loginMock.mock.calls[0] as
      | [string | undefined]
      | undefined;
    expect(loginArgs).toBeDefined();
    if (!loginArgs) {
      throw new Error("login was not called");
    }
    const [token] = loginArgs;
    expect(token).toBe("token");

    const onceArgs = onceMock.mock.calls[0] as
      | [string, (...args: unknown[]) => void]
      | undefined;
    expect(onceArgs).toBeDefined();
    if (!onceArgs) {
      throw new Error("client.once was not called");
    }
    const [event, listener] = onceArgs;
    expect(event).toBe("ready");
    expect(typeof listener).toBe("function");

    if (!receivedServices) {
      throw new Error("services were not passed to clientFactory");
    }

    expect(typeof receivedServices.notifyService.sendNotification).toBe(
      "function"
    );
    expect(typeof receivedServices.ruleService.listRules).toBe("function");

    expect(result.services).toBe(receivedServices);
    expect(result.notificationRuleRepository).toBeDefined();
    expect(typeof result.cleanup).toBe("function");

    result.cleanup();
  });

  it("ログイン失敗時にサニタイズされたログを出力する", async () => {
    mutableEnv.DISCORD_TOKEN = "token";

    const loginError = new Error("token mismatch");
    const { client, loginMock } = createClientStub({
      login: () => Promise.reject(loginError),
    });

    const logs: string[] = [];

    await expect(
      bootstrap({
        clientFactory: () => client,
        ensureDataDir: () => {},
        logger: {
          info: () => {},
          error: (message: string) => {
            logs.push(message);
          },
          warn: () => {},
        },
      })
    ).rejects.toThrow(loginError);

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toBe(
      "Discord クライアントのログインに失敗しました: token mismatch"
    );
    expect(loginMock.mock.calls.length).toBe(1);
  });

  it("voiceStateUpdate イベントを VoiceStateHandler に委譲する", async () => {
    mutableEnv.DISCORD_TOKEN = "token";

    const { client, onMock } = createClientStub();
    const handleMock = mock(async () => {});
    const handler: VoiceStateHandler = {
      handle: handleMock,
    };

    const handlerFactory = mock<
      (deps: VoiceStateHandlerDeps) => VoiceStateHandler
    >(() => handler);

    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await bootstrap({
      clientFactory: () => client,
      ensureDataDir: () => {},
      voiceStateHandlerFactory: handlerFactory,
      logger,
    });

    expect(handlerFactory).toHaveBeenCalledTimes(1);
    expect(onMock.mock.calls.length).toBeGreaterThan(0);
    const call = onMock.mock.calls[0] as
      | [string, (...args: unknown[]) => unknown]
      | undefined;
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("voiceStateUpdate listener is not registered");
    }

    const [event, listener] = call;
    expect(event).toBe("voiceStateUpdate");
    const oldState = {} as any;
    const newState = {} as any;
    await Promise.resolve(listener(oldState, newState));
    expect(handleMock).toHaveBeenCalledWith(oldState, newState);
  });

  it("interactionCreate イベントで setup コマンドをハンドラーに委譲する", async () => {
    mutableEnv.DISCORD_TOKEN = "token";

    const { client, onMock } = createClientStub();
    const handlerMock = mock(
      async (_interaction: ChatInputCommandInteraction, _deps: unknown) => {}
    );
    const setupDeps = {
      requiredBotPermissions: [],
      checkDatabaseReady: async () => true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
    const depsFactoryMock = mock(() => setupDeps);

    await bootstrap({
      clientFactory: () => client,
      ensureDataDir: () => {},
      setupCommandHandler: handlerMock,
      setupCommandDepsFactory: depsFactoryMock,
      registerCommands: async () => {},
    });

    const interactionListenerCall = onMock.mock.calls.find(
      ([event]) => event === "interactionCreate"
    );
    expect(interactionListenerCall).toBeDefined();
    if (!interactionListenerCall) {
      throw new Error("interactionCreate listener is not registered");
    }

    const listener = interactionListenerCall[1] as (
      interaction: ChatInputCommandInteraction
    ) => Promise<void>;

    const interaction = {
      isChatInputCommand: () => true,
      commandName: "vc-notify",
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "setup",
      },
      replied: false,
      deferred: false,
    } as unknown as ChatInputCommandInteraction;

    await listener(interaction);

    expect(depsFactoryMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledTimes(1);
    const [, deps] = handlerMock.mock.calls[0] ?? [];
    expect(deps).toBe(setupDeps);
  });

  it("ready イベントで Slash Commands を登録する", async () => {
    mutableEnv.DISCORD_TOKEN = "token";

    const { client, onceMock, destroyMock } = createClientStub();
    const registerCommandsMock = mock(async () => {});
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await bootstrap({
      clientFactory: () => client,
      ensureDataDir: () => {},
      logger,
      registerCommands: registerCommandsMock,
    });

    const readyListenerCall = onceMock.mock.calls.find(
      ([event]) => event === "ready"
    );
    expect(readyListenerCall).toBeDefined();
    if (!readyListenerCall) {
      throw new Error("ready listener is not registered");
    }

    const readyListener = readyListenerCall[1] as () => Promise<void>;
    await readyListener();

    expect(registerCommandsMock).toHaveBeenCalledWith(
      client,
      commandDefinitions
    );
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("Slash Commands 登録に失敗した場合に Bot を停止する", async () => {
    mutableEnv.DISCORD_TOKEN = "token";

    const { client, onceMock, destroyMock } = createClientStub();
    const registerCommandsMock = mock(async () => {
      throw new Error("API rate limit exceeded");
    });
    const errorMock = mock((message?: unknown) => {});
    const logger = {
      info: () => {},
      warn: () => {},
      error: errorMock,
    };

    const originalExit = process.exit;
    const exitCalls: number[] = [];
    const exitMock = mock((code?: number) => {
      exitCalls.push(code ?? 0);
      throw new Error("process.exit invoked");
    });
    process.exit = ((code?: number) => exitMock(code)) as typeof process.exit;

    try {
      await bootstrap({
        clientFactory: () => client,
        ensureDataDir: () => {},
        logger,
        registerCommands: registerCommandsMock,
      });

      const readyListenerCall = onceMock.mock.calls.find(
        ([event]) => event === "ready"
      );
      expect(readyListenerCall).toBeDefined();
      if (!readyListenerCall) {
        throw new Error("ready listener is not registered");
      }

      const readyListener = readyListenerCall[1] as () => Promise<void>;
      await expect(readyListener()).rejects.toThrow("process.exit invoked");
    } finally {
      process.exit = originalExit;
    }

    expect(registerCommandsMock).toHaveBeenCalledWith(
      client,
      commandDefinitions
    );
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(exitCalls).toEqual([1]);
    const errorMessages: string[] = [];
    for (const callArgs of errorMock.mock.calls) {
      errorMessages.push(String(callArgs[0] ?? ""));
    }
    expect(
      errorMessages.some((msg) =>
        msg.includes("Slash Commands の登録に失敗しました")
      )
    ).toBeTrue();
    expect(
      errorMessages.some((msg) => msg.includes("Bot を停止します。"))
    ).toBeTrue();
  });
});

interface ClientStubOptions {
  login?: (token?: string) => Promise<string>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  destroy?: () => Promise<void>;
}

function createClientStub(
  options: ClientStubOptions = {}
): {
  client: MinimalClient;
  onceMock: ReturnType<
    typeof mock<
      (event: string, listener: (...args: unknown[]) => void) => void
    >
  >;
  onMock: ReturnType<
    typeof mock<
      (event: string, listener: (...args: unknown[]) => void) => void
    >
  >;
  destroyMock: ReturnType<typeof mock<() => Promise<void>>>;
  loginMock: ReturnType<typeof mock<(token?: string) => Promise<string>>>;
} {
  const onceMock = mock<
    (event: string, listener: (...args: unknown[]) => void) => void
  >((_event, _listener) => {});
  const onMock = mock<
    (event: string, listener: (...args: unknown[]) => void) => void
  >((_event, _listener) => {});

  const loginImpl =
    options.login ?? ((token?: string) => Promise.resolve(token ?? ""));
  const loginMock = mock<(token?: string) => Promise<string>>(loginImpl);
  const destroyImpl = options.destroy ?? (async () => {});
  const destroyMock = mock<() => Promise<void>>(destroyImpl);

  const clientPartial: Partial<MinimalClient> = {};

  clientPartial.guilds = {} as any;
  clientPartial.channels = {} as any;
  clientPartial.user = { id: "client-user-id" } as any;
  clientPartial.application = undefined;

  clientPartial.once = ((event: any, listener: any) => {
    onceMock(event, listener);
    return clientPartial as Client;
  }) as Client["once"];

  const onImpl =
    options.on ??
    ((event: string, listener: (...args: unknown[]) => void) => {
      onMock(event, listener);
    });

  clientPartial.on = ((event: any, listener: any) => {
    onImpl(event, listener);
    return clientPartial as Client;
  }) as Client["on"];

  clientPartial.destroy = (async () => destroyMock()) as Client["destroy"];
  clientPartial.login = ((token?: string) => loginMock(token)) as Client["login"];

  return {
    client: clientPartial as MinimalClient,
    onceMock,
    onMock,
    destroyMock,
    loginMock,
  };
}
