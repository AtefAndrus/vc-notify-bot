import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  PermissionsBitField,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type ButtonInteraction,
} from "discord.js";

import {
  createRuleCommand,
  type RuleCommandSessionStore,
} from "@/commands/rule";
import type { RuleService } from "@/services/ruleService";

const GUILD_ID = "100000000000000000";
const USER_ID = "200000000000000000";
const SESSION_ID = "session-1";

function createRuleServiceMock() {
  return {
    createRule: mock(async () => ({
      id: "rule-created",
      guildId: GUILD_ID,
      name: "Test Rule",
      watchedVoiceChannelIds: ["300000000000000000"],
      targetUserIds: [],
      notificationChannelId: "400000000000000000",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateRule: async () => {
      throw new Error("not implemented");
    },
    deleteRule: async () => {
      throw new Error("not implemented");
    },
    toggleRule: async () => {
      throw new Error("not implemented");
    },
    listRules: async () => {
      throw new Error("not implemented");
    },
    getApplicableRules: async () => {
      throw new Error("not implemented");
    },
  } as unknown as RuleService;
}

function createSessionStore(): RuleCommandSessionStore {
  const sessions = new Map<string, any>();
  const byUser = new Map<string, string>();
  return {
    get: (id) => sessions.get(id),
    save: (session) => {
      sessions.set(session.id, session);
      byUser.set(`${session.guildId}:${session.userId}`, session.id);
    },
    delete: (id) => {
      const existing = sessions.get(id);
      if (existing) {
        byUser.delete(`${existing.guildId}:${existing.userId}`);
      }
      sessions.delete(id);
    },
    findByUser: (guildId, userId) => {
      const id = byUser.get(`${guildId}:${userId}`);
      return id ? sessions.get(id) : undefined;
    },
    cleanupExpired: () => {
      // no-op for tests
    },
  };
}

function createPermissions(hasManageGuild: boolean) {
  return new PermissionsBitField(
    hasManageGuild ? [PermissionFlagsBits.ManageGuild] : []
  );
}

function createChatInputInteraction(options: {
  inGuild?: boolean;
  hasManageGuild?: boolean;
  reply?: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
  showModal?: ReturnType<typeof mock<(modal: unknown) => Promise<void>>>;
}): ChatInputCommandInteraction {
  const replyMock =
    options.reply ?? mock(async () => { /* noop */ });
  const showModalMock =
    options.showModal ?? mock(async () => { /* noop */ });

  return {
    inGuild: () => options.inGuild ?? true,
    guildId: options.inGuild === false ? null : GUILD_ID,
    user: { id: USER_ID } as any,
    memberPermissions: createPermissions(options.hasManageGuild ?? true),
    showModal: showModalMock,
    reply: replyMock,
    replied: false,
    deferred: false,
  } as unknown as ChatInputCommandInteraction;
}

function createModalSubmitInteraction(options: {
  sessionId: string;
  reply?: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
  inGuild?: boolean;
  ruleName?: string;
}): ModalSubmitInteraction {
  const replyMock =
    options.reply ?? mock(async () => { /* noop */ });

  return {
    customId: `rule-add:${options.sessionId}:modal`,
    inGuild: () => options.inGuild ?? true,
    guildId: options.inGuild === false ? null : GUILD_ID,
    user: { id: USER_ID } as any,
    fields: {
      getTextInputValue: () => options.ruleName ?? "Project Alpha",
    },
    reply: replyMock,
    replied: false,
    deferred: false,
  } as unknown as ModalSubmitInteraction;
}

function createChannelSelectInteraction(options: {
  sessionId: string;
  action: "selectVoiceChannels" | "selectNotificationChannel";
  values: string[];
  update?: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
}): ChannelSelectMenuInteraction {
  const updateMock =
    options.update ?? mock(async () => { /* noop */ });

  return {
    customId: `rule-add:${options.sessionId}:${options.action}`,
    values: options.values,
    inGuild: () => true,
    guildId: GUILD_ID,
    user: { id: USER_ID } as any,
    update: updateMock,
    replied: false,
    deferred: false,
  } as unknown as ChannelSelectMenuInteraction;
}

function createUserSelectInteraction(options: {
  sessionId: string;
  values: string[];
  update?: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
}): UserSelectMenuInteraction {
  const updateMock =
    options.update ?? mock(async () => { /* noop */ });

  return {
    customId: `rule-add:${options.sessionId}:selectTargetUsers`,
    values: options.values,
    inGuild: () => true,
    guildId: GUILD_ID,
    user: { id: USER_ID } as any,
    update: updateMock,
    replied: false,
    deferred: false,
  } as unknown as UserSelectMenuInteraction;
}

function createButtonInteraction(options: {
  sessionId: string;
  action: "skipTargetUsers" | "confirm" | "cancel";
  update?: ReturnType<typeof mock<(args: unknown) => Promise<void>>>;
}): ButtonInteraction {
  const updateMock =
    options.update ?? mock(async () => { /* noop */ });

  const followUpMock = mock(async () => {});

  const interaction = {
    customId: `rule-add:${options.sessionId}:${options.action}`,
    inGuild: () => true,
    guildId: GUILD_ID,
    user: { id: USER_ID } as any,
    update: updateMock,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    followUp: followUpMock,
    reply: mock(async () => {}),
  } as unknown as ButtonInteraction;

  return interaction;
}

describe("RuleCommand /vc-notify rule add", () => {
  let sessionStore: RuleCommandSessionStore;
  let ruleService: RuleService;
  const fixedNow = new Date("2025-01-01T00:00:00.000Z");

  beforeEach(() => {
    sessionStore = createSessionStore();
    ruleService = createRuleServiceMock();
  });

  it("MANAGE_GUILD 権限がない場合にエラーメッセージを返す", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    const replyMock = mock(async (_: unknown) => {});
    const interaction = createChatInputInteraction({
      hasManageGuild: false,
      reply: replyMock,
    });

    await command.handleAddCommand(interaction);

    expect(replyMock.mock.calls.length).toBe(1);
    const [args] = replyMock.mock.calls[0] ?? [];
    expect((args as { content: string }).content).toContain("MANAGE_GUILD");
  });

  it("権限がある場合にモーダルを表示しセッションを作成する", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    const showModalMock = mock(async (_: unknown) => {});
    const interaction = createChatInputInteraction({ showModal: showModalMock });

    await command.handleAddCommand(interaction);

    expect(showModalMock.mock.calls.length).toBe(1);
    const [modal] = showModalMock.mock.calls[0] ?? [];
    expect((modal as { data: { custom_id?: string } }).data?.custom_id).toBe(
      `rule-add:${SESSION_ID}:modal`
    );

    const session = sessionStore.get(SESSION_ID);
    expect(session).toBeDefined();
    expect(session?.step).toBe("awaitingName");
  });

  it("モーダル送信でVC選択メニューを提示する", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    const baseSession = {
      id: SESSION_ID,
      guildId: GUILD_ID,
      userId: USER_ID,
      step: "awaitingName" as const,
      watchedVoiceChannelIds: [],
      targetUserIds: [],
      notificationChannelId: undefined,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      expiresAt: new Date(fixedNow.getTime() + 1000),
    };
    sessionStore.save(baseSession);

    const replyMock = mock(async (_: unknown) => {});
    const interaction = createModalSubmitInteraction({
      sessionId: SESSION_ID,
      reply: replyMock,
    });

    const handled = await command.handleModalSubmit(interaction);

    expect(handled).toBeTrue();
    expect(replyMock.mock.calls.length).toBe(1);
    const [args] = replyMock.mock.calls[0] ?? [];
    const options = args as {
      components?: Array<{ components?: Array<{ data: { custom_id?: string } }> }>;
    };
    const customId =
      options.components?.[0]?.components?.[0]?.data?.custom_id ?? "";
    expect(customId).toBe(`rule-add:${SESSION_ID}:selectVoiceChannels`);

    const updatedSession = sessionStore.get(SESSION_ID);
    expect(updatedSession?.step).toBe("awaitingVoiceChannels");
  });

  it("VC 選択後に対象ユーザー選択を案内する", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    sessionStore.save({
      id: SESSION_ID,
      guildId: GUILD_ID,
      userId: USER_ID,
      step: "awaitingVoiceChannels",
      ruleName: "Project Alpha",
      watchedVoiceChannelIds: [],
      targetUserIds: [],
      notificationChannelId: undefined,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      expiresAt: new Date(fixedNow.getTime() + 1000),
    });

    const updateMock = mock(async (_: unknown) => {});
    const interaction = createChannelSelectInteraction({
      sessionId: SESSION_ID,
      action: "selectVoiceChannels",
      values: ["300000000000000000"],
      update: updateMock,
    });

    const handled = await command.handleChannelSelect(interaction);

    expect(handled).toBeTrue();
    expect(updateMock.mock.calls.length).toBe(1);
    const [args] = updateMock.mock.calls[0] ?? [];
    const options = args as {
      components?: Array<{ components?: Array<{ data: { custom_id?: string } }> }>;
    };
    const userSelectId =
      options.components?.[0]?.components?.[0]?.data?.custom_id ?? "";
    expect(userSelectId).toBe(`rule-add:${SESSION_ID}:selectTargetUsers`);

    const updatedSession = sessionStore.get(SESSION_ID);
    expect(updatedSession?.watchedVoiceChannelIds).toEqual([
      "300000000000000000",
    ]);
    expect(updatedSession?.step).toBe("awaitingTargetUsers");
  });

  it("対象ユーザー選択後に通知先選択を案内する", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    sessionStore.save({
      id: SESSION_ID,
      guildId: GUILD_ID,
      userId: USER_ID,
      step: "awaitingTargetUsers",
      ruleName: "Project Alpha",
      watchedVoiceChannelIds: ["300000000000000000"],
      targetUserIds: [],
      notificationChannelId: undefined,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      expiresAt: new Date(fixedNow.getTime() + 1000),
    });

    const updateMock = mock(async (_: unknown) => {});
    const interaction = createUserSelectInteraction({
      sessionId: SESSION_ID,
      values: ["500000000000000000", "500000000000000001"],
      update: updateMock,
    });

    const handled = await command.handleUserSelect(interaction);

    expect(handled).toBeTrue();
    expect(updateMock.mock.calls.length).toBe(1);
    const [args] = updateMock.mock.calls[0] ?? [];
    const options = args as {
      components?: Array<{ components?: Array<{ data: { custom_id?: string } }> }>;
    };
    const customId =
      options.components?.[0]?.components?.[0]?.data?.custom_id ?? "";
    expect(customId).toBe(`rule-add:${SESSION_ID}:selectNotificationChannel`);

    const updatedSession = sessionStore.get(SESSION_ID);
    expect(updatedSession?.targetUserIds).toEqual([
      "500000000000000000",
      "500000000000000001",
    ]);
    expect(updatedSession?.step).toBe("awaitingNotificationChannel");
  });

  it("通知先選択後に確認画面を表示する", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    sessionStore.save({
      id: SESSION_ID,
      guildId: GUILD_ID,
      userId: USER_ID,
      step: "awaitingNotificationChannel",
      ruleName: "Project Alpha",
      watchedVoiceChannelIds: ["300000000000000000"],
      targetUserIds: ["500000000000000000"],
      notificationChannelId: undefined,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      expiresAt: new Date(fixedNow.getTime() + 1000),
    });

    const updateMock = mock(async (_: unknown) => {});
    const interaction = createChannelSelectInteraction({
      sessionId: SESSION_ID,
      action: "selectNotificationChannel",
      values: ["400000000000000000"],
      update: updateMock,
    });

    const handled = await command.handleChannelSelect(interaction);

    expect(handled).toBeTrue();
    const [args] = updateMock.mock.calls[0] ?? [];
    const options = args as {
      components?: Array<{ components?: Array<{ data: { custom_id?: string } }> }>;
      embeds?: Array<{ data: { title?: string } }>;
    };
    const confirmId =
      options.components?.[0]?.components?.[0]?.data?.custom_id ?? "";
    expect(confirmId).toBe(`rule-add:${SESSION_ID}:confirm`);
    expect(options.embeds?.[0]?.data?.title).toContain("確認");

    const updatedSession = sessionStore.get(SESSION_ID);
    expect(updatedSession?.notificationChannelId).toBe("400000000000000000");
    expect(updatedSession?.step).toBe("awaitingConfirmation");
  });

  it("確認ボタン押下でルールが作成されセッションが破棄される", async () => {
    const command = createRuleCommand({
      ruleService,
      sessionStore,
      now: () => fixedNow,
      generateId: () => SESSION_ID,
    });

    sessionStore.save({
      id: SESSION_ID,
      guildId: GUILD_ID,
      userId: USER_ID,
      step: "awaitingConfirmation",
      ruleName: "Project Alpha",
      watchedVoiceChannelIds: ["300000000000000000"],
      targetUserIds: [],
      notificationChannelId: "400000000000000000",
      createdAt: fixedNow,
      updatedAt: fixedNow,
      expiresAt: new Date(fixedNow.getTime() + 1000),
    });

    const updateMock = mock(async (_: unknown) => {});
    const interaction = createButtonInteraction({
      sessionId: SESSION_ID,
      action: "confirm",
      update: updateMock,
    });

    const handled = await command.handleButton(interaction);

    expect(handled).toBeTrue();
    expect(updateMock.mock.calls.length).toBe(1);
    const [args] = updateMock.mock.calls[0] ?? [];
    const options = args as { embeds?: Array<{ data: { title?: string } }> };
    expect(options.embeds?.[0]?.data?.title).toBe("ルール作成完了");
    const createRuleMock = ruleService.createRule as unknown as ReturnType<
      typeof mock<(input: unknown) => Promise<unknown>>
    >;
    expect(createRuleMock.mock.calls.length).toBe(1);
    const [createInput] = createRuleMock.mock.calls[0] ?? [];
    expect(createInput).toEqual({
      guildId: GUILD_ID,
      name: "Project Alpha",
      watchedVoiceChannelIds: ["300000000000000000"],
      targetUserIds: [],
      notificationChannelId: "400000000000000000",
    });
    expect(sessionStore.get(SESSION_ID)).toBeUndefined();
  });
});
