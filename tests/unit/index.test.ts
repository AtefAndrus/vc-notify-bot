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
import type { Client } from "discord.js";

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
        },
      })
    ).rejects.toThrow(loginError);

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toBe(
      "Discord クライアントのログインに失敗しました: token mismatch"
    );
    expect(loginMock.mock.calls.length).toBe(1);
  });
});

interface ClientStubOptions {
  login?: (token?: string) => Promise<string>;
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
  loginMock: ReturnType<typeof mock<(token?: string) => Promise<string>>>;
} {
  const onceMock = mock<
    (event: string, listener: (...args: unknown[]) => void) => void
  >((_event, _listener) => {});

  const loginImpl =
    options.login ?? ((token?: string) => Promise.resolve(token ?? ""));
  const loginMock = mock<(token?: string) => Promise<string>>(loginImpl);

  const clientPartial: Partial<MinimalClient> = {};

  clientPartial.once = ((event: any, listener: any) => {
    onceMock(event, listener);
    return clientPartial as Client;
  }) as Client["once"];

  clientPartial.login = ((token?: string) => loginMock(token)) as Client["login"];

  return {
    client: clientPartial as MinimalClient,
    onceMock,
    loginMock,
  };
}
