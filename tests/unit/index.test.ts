import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { bootstrap, ensureDataDir, loadConfig } from "@/index";

const mutableEnv = Bun.env as Record<string, string | undefined>;

const originalEnv = { ...Bun.env };

beforeEach(() => {
  Object.keys(originalEnv).forEach((key) => {
    mutableEnv[key] = originalEnv[key];
  });
});

afterEach(() => {
  Object.keys(originalEnv).forEach((key) => {
    mutableEnv[key] = originalEnv[key];
  });
});

describe("loadConfig", () => {
  it("DISCORD_TOKEN が未設定の場合にエラーを投げる", () => {
    mutableEnv.DISCORD_TOKEN = undefined;

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
      dbPath: "./data/bot.db",
      logLevel: "debug",
      nodeEnv: "development",
      dataDir: "./data",
    });
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
    const once = mock<
      (event: string, listener: (...args: unknown[]) => void) => void
    >((_event, _listener) => {});
    const login = mock<(token: string) => Promise<void>>(async (_token) => {});
    const client = { once, login };

    await bootstrap({
      clientFactory: () => client as any,
      ensureDataDir: (path) => {
        ensuredPaths.push(path);
      },
    });

    expect(ensuredPaths).toContain("./data");
    expect(login.mock.calls.length).toBe(1);
    const loginArgs = login.mock.calls[0] as [string] | undefined;
    expect(loginArgs).toBeDefined();
    if (!loginArgs) {
      throw new Error("login was not called");
    }
    const [token] = loginArgs;
    expect(token).toBe("token");

    const onceArgs =
      once.mock.calls[0] as
        | [string, (...args: unknown[]) => void]
        | undefined;
    expect(onceArgs).toBeDefined();
    if (!onceArgs) {
      throw new Error("client.once was not called");
    }
    const [event, listener] = onceArgs;
    expect(event).toBe("ready");
    expect(typeof listener).toBe("function");
  });
});
