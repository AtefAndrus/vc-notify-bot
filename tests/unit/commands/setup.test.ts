import { describe, expect, it, mock } from "bun:test";
import {
  Collection,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";

import {
  DEFAULT_REQUIRED_BOT_PERMISSIONS,
  handleSetupCommand,
  type RequiredPermission,
  type SetupCommandDeps,
} from "@/commands/setup";

describe("handleSetupCommand", () => {
  it("MANAGE_GUILD 権限がない場合に警告を返す", async () => {
    const { interaction, replyMock } = createInteractionStub({
      memberPermissions: new PermissionsBitField(),
      botPermissions: permissionsFrom(DEFAULT_REQUIRED_BOT_PERMISSIONS),
    });

    await handleSetupCommand(
      interaction,
      createDeps({
        checkDatabaseReady: async () => true,
      })
    );

    const embed = getReplyEmbed(replyMock);
    const userField = embed.fields?.find(
      (field) => field.name === "実行者の権限"
    );
    expect(userField?.value).toContain("❌ MANAGE_GUILD");
    expect(embed.fields?.some((field) => field.name === "実行者へのヒント")).toBeTrue();
  });

  it("Bot 権限不足を通知する", async () => {
    const { interaction, replyMock } = createInteractionStub({
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      botPermissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel]),
    });

    await handleSetupCommand(
      interaction,
      createDeps({
        checkDatabaseReady: async () => true,
      })
    );

    const embed = getReplyEmbed(replyMock);
    const botField = embed.fields?.find(
      (field) => field.name === "現在のBot権限"
    );
    expect(botField?.value).toContain("❌ SEND_MESSAGES");
    const missing = embed.fields?.find(
      (field) => field.name === "不足しているBot権限"
    );
    expect(missing?.value).toContain("SEND_MESSAGES");
    const guidance = embed.fields?.find(
      (field) => field.name === "権限の付与方法"
    );
    expect(guidance?.value).toContain("サーバー設定");
  });

  it("データベース未初期化を警告する", async () => {
    const { interaction, replyMock } = createInteractionStub({
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      botPermissions: permissionsFrom(DEFAULT_REQUIRED_BOT_PERMISSIONS),
    });

    await handleSetupCommand(
      interaction,
      createDeps({
        checkDatabaseReady: async () => false,
      })
    );

    const embed = getReplyEmbed(replyMock);
    const dbField = embed.fields?.find((field) => field.name === "データベース");
    expect(dbField?.value).toContain("❌");
    expect(embed.footer?.text).toContain("不足項目を解消");
  });

  it("全条件を満たす場合に成功の Embed を返す", async () => {
    const { interaction, replyMock } = createInteractionStub({
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      botPermissions: permissionsFrom(DEFAULT_REQUIRED_BOT_PERMISSIONS),
    });

    const fixedNow = new Date("2025-01-01T00:00:00.000Z");

    await handleSetupCommand(
      interaction,
      createDeps({
        checkDatabaseReady: async () => true,
        now: () => fixedNow,
      })
    );

    const embed = getReplyEmbed(replyMock);
    expect(embed.title).toBe("✅ セットアップ完了");
    expect(embed.color).toBe(0x00ff00);
    const nextField = embed.fields?.find((field) => field.name === "次のステップ");
    expect(nextField?.value).toContain("/vc-notify rule add");
    expect(embed.timestamp).toBe(fixedNow.toISOString());
  });

  it("Bot メンバー情報が取得できない場合にエラーメッセージを返す", async () => {
    const { interaction, replyMock } = createInteractionStub({
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      botPermissions: permissionsFrom(DEFAULT_REQUIRED_BOT_PERMISSIONS),
      botMember: null,
      fetchReturnsNull: true,
    });

    await handleSetupCommand(
      interaction,
      createDeps({
        checkDatabaseReady: async () => true,
      })
    );

    expect(replyMock.mock.calls.length).toBe(1);
    const [argument] = replyMock.mock.calls[0] ?? [];
    const options = argument as { content?: string };
    expect(options.content).toContain("Bot のメンバー情報を取得できませんでした");
  });
});

interface InteractionStubOptions {
  memberPermissions: PermissionsBitField;
  botPermissions: PermissionsBitField;
  botMember?: { permissions: PermissionsBitField } | null;
  fetchReturnsNull?: boolean;
  fetchReject?: Error;
}

function createInteractionStub(options: InteractionStubOptions): {
  interaction: ChatInputCommandInteraction;
  replyMock: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
} {
  const replyMock = mock(async () => {});

  const guildChannels = new Collection<string, any>();

  const botMember =
    options.botMember === undefined
      ? { permissions: options.botPermissions }
      : options.botMember;

  const fetchMock = mock(async () => {
    if (options.fetchReject) {
      throw options.fetchReject;
    }
    if (options.fetchReturnsNull) {
      return null;
    }
    return {
      permissions: options.botPermissions,
    };
  });

  const guild = {
    id: "guild-id",
    members: {
      me: botMember,
      fetch: fetchMock,
    },
    channels: {
      cache: guildChannels,
    },
  };

  const interaction = {
    inGuild: () => true,
    guild,
    client: {
      user: { id: "bot-id" },
    },
    memberPermissions: options.memberPermissions,
    reply: replyMock,
    replied: false,
    deferred: false,
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replyMock };
}

function permissionsFrom(permissions: RequiredPermission[]): PermissionsBitField {
  return new PermissionsBitField(permissions.map((perm) => perm.bit));
}

function getReplyEmbed(
  replyMock: ReturnType<typeof mock<(args: unknown) => Promise<void>>>
) {
  expect(replyMock.mock.calls.length).toBe(1);
  const [argument] = replyMock.mock.calls[0] ?? [];
  const options = argument as { embeds?: EmbedBuilder[] };
  const embedBuilder = options.embeds?.[0];
  if (!embedBuilder) {
    throw new Error("reply の Embed が見つかりません");
  }
  return embedBuilder.data;
}

function createDeps(overrides: Partial<SetupCommandDeps>): SetupCommandDeps {
  return {
    requiredBotPermissions: DEFAULT_REQUIRED_BOT_PERMISSIONS,
    checkDatabaseReady: async () => true,
    now: () => new Date(),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    ...overrides,
  };
}
