import { randomUUID } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageComponentInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  type APIEmbedField,
} from "discord.js";

import {
  RuleLimitExceededError,
  RuleService,
  RuleValidationError,
} from "@/services/ruleService";

const RULE_ADD_CUSTOM_ID_PREFIX = "rule-add";
const RULE_NAME_TEXT_INPUT_ID = "rule_name";
const SESSION_TTL_MS = 5 * 60 * 1000;
const TARGET_USER_SELECT_MAX = 25;

type RuleAddStep =
  | "awaitingName"
  | "awaitingVoiceChannels"
  | "awaitingTargetUsers"
  | "awaitingNotificationChannel"
  | "awaitingConfirmation"
  | "completed";

type RuleAddInteractionAction =
  | "modal"
  | "selectVoiceChannels"
  | "selectTargetUsers"
  | "skipTargetUsers"
  | "selectNotificationChannel"
  | "confirm"
  | "cancel";

interface ParsedCustomId {
  sessionId: string;
  action: RuleAddInteractionAction;
}

interface RuleAddSession {
  id: string;
  guildId: string;
  userId: string;
  step: RuleAddStep;
  ruleName?: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface RuleCommandSessionStore {
  get: (sessionId: string) => RuleAddSession | undefined;
  save: (session: RuleAddSession) => void;
  delete: (sessionId: string) => void;
  findByUser: (guildId: string, userId: string) => RuleAddSession | undefined;
  cleanupExpired: (now: Date) => void;
}

class InMemoryRuleCommandSessionStore implements RuleCommandSessionStore {
  private readonly sessions = new Map<string, RuleAddSession>();
  private readonly sessionIdByUser = new Map<string, string>();

  get(sessionId: string): RuleAddSession | undefined {
    return this.sessions.get(sessionId);
  }

  save(session: RuleAddSession): void {
    this.sessions.set(session.id, session);
    this.sessionIdByUser.set(this.userKey(session.guildId, session.userId), session.id);
  }

  delete(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessionIdByUser.delete(this.userKey(existing.guildId, existing.userId));
    }
    this.sessions.delete(sessionId);
  }

  findByUser(guildId: string, userId: string): RuleAddSession | undefined {
    const key = this.userKey(guildId, userId);
    const sessionId = this.sessionIdByUser.get(key);
    if (!sessionId) {
      return undefined;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sessionIdByUser.delete(key);
    }
    return session;
  }

  cleanupExpired(now: Date): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= now.getTime()) {
        this.delete(sessionId);
      }
    }
  }

  private userKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }
}

export interface RuleCommandDeps {
  ruleService: RuleService;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
  now?: () => Date;
  generateId?: () => string;
  sessionStore?: RuleCommandSessionStore;
}

export class RuleCommand {
  private readonly logger: Pick<typeof console, "info" | "warn" | "error">;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly sessionStore: RuleCommandSessionStore;

  constructor(private readonly deps: RuleCommandDeps) {
    this.logger = deps.logger ?? console;
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? (() => randomUUID());
    this.sessionStore = deps.sessionStore ?? new InMemoryRuleCommandSessionStore();
  }

  async handleAddCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    this.sessionStore.cleanupExpired(this.now());

    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    const memberPermissions = interaction.memberPermissions;
    const hasManageGuild = memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    );
    if (!hasManageGuild) {
      await interaction.reply({
        content: "このコマンドを実行するには MANAGE_GUILD 権限が必要です。",
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const existing = this.sessionStore.findByUser(guildId, userId);
    if (existing) {
      await interaction.reply({
        content:
          "進行中のルール作成があります。エフェメラルメッセージ上の操作を完了するか、一定時間後に再度コマンドを実行してください。",
        ephemeral: true,
      });
      return;
    }

    const now = this.now();
    const session: RuleAddSession = {
      id: this.generateId(),
      guildId,
      userId,
      step: "awaitingName",
      watchedVoiceChannelIds: [],
      targetUserIds: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: this.computeExpiry(now),
    };

    this.sessionStore.save(session);

    const modal = this.buildRuleNameModal(session.id);
    await interaction.showModal(modal);
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<boolean> {
    this.sessionStore.cleanupExpired(this.now());

    const parsed = parseCustomId(interaction.customId);
    if (!parsed || parsed.action !== "modal") {
      return false;
    }

    if (!interaction.inGuild() || !interaction.guildId) {
      await this.replyEphemeral(interaction, "この操作はサーバー内でのみ有効です。");
      return true;
    }

    const session = this.resolveSession(parsed.sessionId, interaction.guildId, interaction.user.id);
    if (!session || session.step !== "awaitingName") {
      await this.replySessionExpired(interaction);
      if (session) {
        this.sessionStore.delete(session.id);
      }
      return true;
    }

    const ruleName = interaction.fields.getTextInputValue(RULE_NAME_TEXT_INPUT_ID).trim();
    session.ruleName = ruleName;
    session.step = "awaitingVoiceChannels";
    this.renewSession(session);

    await interaction.reply({
      content: "監視するボイスチャンネルを選択してください (1〜10件)。",
      components: [this.buildVoiceChannelSelectRow(session.id)],
      ephemeral: true,
    });

    return true;
  }

  async handleChannelSelect(
    interaction: ChannelSelectMenuInteraction
  ): Promise<boolean> {
    this.sessionStore.cleanupExpired(this.now());

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      return false;
    }

    if (!interaction.inGuild() || !interaction.guildId) {
      await this.replyEphemeral(interaction, "この操作はサーバー内でのみ有効です。");
      return true;
    }

    const session = this.resolveSession(parsed.sessionId, interaction.guildId, interaction.user.id);
    if (!session) {
      await this.updateSessionExpired(interaction);
      return true;
    }

    if (parsed.action === "selectVoiceChannels") {
      if (session.step !== "awaitingVoiceChannels") {
        await this.updateSessionExpired(interaction, true);
        this.sessionStore.delete(session.id);
        return true;
      }

      session.watchedVoiceChannelIds = [...interaction.values];
      session.step = "awaitingTargetUsers";
      this.renewSession(session);

      await interaction.update({
        content:
          "通知対象ユーザーを選択してください (最大25件)。選択しない場合は「全員対象」を押してください。",
        components: [
          this.buildTargetUserSelectRow(session.id),
          this.buildSkipTargetUsersRow(session.id),
        ],
      });
      return true;
    }

    if (parsed.action === "selectNotificationChannel") {
      if (session.step !== "awaitingNotificationChannel") {
        await this.updateSessionExpired(interaction, true);
        this.sessionStore.delete(session.id);
        return true;
      }

      const [notificationChannelId] = interaction.values;
      session.notificationChannelId = notificationChannelId;
      session.step = "awaitingConfirmation";
      this.renewSession(session);

      await interaction.update({
        content: "以下の内容でルールを作成します。問題なければ「作成」を押してください。",
        embeds: [this.buildConfirmationEmbed(session)],
        components: [this.buildConfirmationButtons(session.id)],
      });
      return true;
    }

    return false;
  }

  async handleUserSelect(
    interaction: UserSelectMenuInteraction
  ): Promise<boolean> {
    this.sessionStore.cleanupExpired(this.now());

    const parsed = parseCustomId(interaction.customId);
    if (!parsed || parsed.action !== "selectTargetUsers") {
      return false;
    }

    if (!interaction.inGuild() || !interaction.guildId) {
      await this.replyEphemeral(interaction, "この操作はサーバー内でのみ有効です。");
      return true;
    }

    const session = this.resolveSession(parsed.sessionId, interaction.guildId, interaction.user.id);
    if (!session || session.step !== "awaitingTargetUsers") {
      await this.updateSessionExpired(interaction, true);
      if (session) {
        this.sessionStore.delete(session.id);
      }
      return true;
    }

    if (interaction.values.length > TARGET_USER_SELECT_MAX) {
      await this.replyEphemeral(
        interaction,
        `ユーザーは最大 ${TARGET_USER_SELECT_MAX} 件まで選択できます。`
      );
      return true;
    }

    session.targetUserIds = [...interaction.values];
    session.step = "awaitingNotificationChannel";
    this.renewSession(session);

    await interaction.update({
      content: "通知先のテキストチャンネルを選択してください。",
      components: [this.buildNotificationChannelSelectRow(session.id)],
    });

    return true;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    this.sessionStore.cleanupExpired(this.now());

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      return false;
    }

    if (!interaction.inGuild() || !interaction.guildId) {
      await this.replyEphemeral(interaction, "この操作はサーバー内でのみ有効です。");
      return true;
    }

    const session = this.resolveSession(parsed.sessionId, interaction.guildId, interaction.user.id);
    if (!session) {
      await this.updateSessionExpired(interaction);
      return true;
    }

    switch (parsed.action) {
      case "skipTargetUsers":
        if (session.step !== "awaitingTargetUsers") {
          await this.updateSessionExpired(interaction, true);
          this.sessionStore.delete(session.id);
          return true;
        }

        session.targetUserIds = [];
        session.step = "awaitingNotificationChannel";
        this.renewSession(session);

        await interaction.update({
          content: "通知先のテキストチャンネルを選択してください。",
          components: [this.buildNotificationChannelSelectRow(session.id)],
        });
        return true;

      case "cancel":
        await interaction.update({
          content: "ルール作成をキャンセルしました。必要であれば再度 `/vc-notify rule add` を実行してください。",
          components: [],
          embeds: [],
        });
        this.sessionStore.delete(session.id);
        return true;

      case "confirm":
        if (!this.isSessionReadyForCreation(session)) {
          await interaction.update({
            content: "セッションの状態が不正です。もう一度 `/vc-notify rule add` を実行してください。",
            components: [],
            embeds: [],
          });
          this.sessionStore.delete(session.id);
          return true;
        }

        try {
          const rule = await this.deps.ruleService.createRule({
            guildId: session.guildId,
            name: session.ruleName!,
            watchedVoiceChannelIds: session.watchedVoiceChannelIds,
            targetUserIds: session.targetUserIds,
            notificationChannelId: session.notificationChannelId!,
          });

          await interaction.update({
            content: undefined,
            embeds: [
              new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle("ルール作成完了")
                .setDescription(`ルール「${rule.name}」を作成しました。`)
                .addFields(this.buildSummaryFields(session))
                .setFooter({ text: `ルールID: ${rule.id}` }),
            ],
            components: [],
          });
        } catch (error) {
          await this.handleRuleCreationError(interaction, error, session);
        } finally {
          this.sessionStore.delete(session.id);
        }
        return true;

      default:
        return false;
    }
  }

  private buildRuleNameModal(sessionId: string): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(buildCustomId(sessionId, "modal"))
      .setTitle("ルール名を入力")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(RULE_NAME_TEXT_INPUT_ID)
            .setLabel("ルール名")
            .setPlaceholder("例: 開発チーム通知")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(50)
            .setRequired(true)
        )
      );
  }

  private buildVoiceChannelSelectRow(sessionId: string) {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(buildCustomId(sessionId, "selectVoiceChannels"))
        .setPlaceholder("監視するVCチャンネルを選択")
        .setChannelTypes(ChannelType.GuildVoice)
        .setMinValues(1)
        .setMaxValues(10)
    );
  }

  private buildTargetUserSelectRow(sessionId: string) {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(buildCustomId(sessionId, "selectTargetUsers"))
        .setPlaceholder("対象ユーザーを選択 (最大25件)")
        .setMinValues(0)
        .setMaxValues(TARGET_USER_SELECT_MAX)
    );
  }

  private buildSkipTargetUsersRow(sessionId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(sessionId, "skipTargetUsers"))
        .setLabel("全員対象")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  private buildNotificationChannelSelectRow(sessionId: string) {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(buildCustomId(sessionId, "selectNotificationChannel"))
        .setPlaceholder("通知先テキストチャンネルを選択")
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    );
  }

  private buildConfirmationEmbed(session: RuleAddSession): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("ルール作成内容の確認")
      .addFields(this.buildSummaryFields(session));
  }

  private buildSummaryFields(session: RuleAddSession): APIEmbedField[] {
    return [
      {
        name: "ルール名",
        value: session.ruleName ?? "(未設定)",
        inline: false,
      },
      {
        name: "監視対象VC",
        value:
          session.watchedVoiceChannelIds.length > 0
            ? session.watchedVoiceChannelIds.map((id) => `<#${id}>`).join("\n")
            : "(未設定)",
        inline: false,
      },
      {
        name: "対象ユーザー",
        value:
          session.targetUserIds.length > 0
            ? session.targetUserIds.map((id) => `<@${id}>`).join("\n")
            : "全員",
        inline: false,
      },
      {
        name: "通知先",
        value: session.notificationChannelId
          ? `<#${session.notificationChannelId}>`
          : "(未設定)",
        inline: false,
      },
    ];
  }

  private buildConfirmationButtons(sessionId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(sessionId, "confirm"))
        .setLabel("作成")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildCustomId(sessionId, "cancel"))
        .setLabel("キャンセル")
        .setStyle(ButtonStyle.Danger)
    );
  }

  private async handleRuleCreationError(
    interaction: ButtonInteraction,
    error: unknown,
    session: RuleAddSession
  ): Promise<void> {
    if (error instanceof RuleValidationError) {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("ルール作成に失敗しました")
            .setDescription(
              "入力内容に問題があります。以下の項目を修正して再度 `/vc-notify rule add` を実行してください。"
            )
            .addFields({
              name: "エラー詳細",
              value: error.violations.map((violation) => `• ${violation}`).join("\n"),
            }),
        ],
        components: [],
        content: undefined,
      });
      return;
    }

    if (error instanceof RuleLimitExceededError) {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("ルール数の上限に達しています")
            .setDescription(
              `このギルドでは最大 ${error.limit} 件までルールを作成できます。不要なルールを削除してから再度お試しください。`
            ),
        ],
        components: [],
        content: undefined,
      });
      return;
    }

    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error("RuleCommand: ルール作成に失敗しました", {
      sessionId: session.id,
      guildId: session.guildId,
      detail,
    });

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("ルール作成に失敗しました")
          .setDescription("不明なエラーが発生しました。時間を置いて再度お試しください。"),
      ],
      components: [],
      content: undefined,
    });
  }

  private resolveSession(
    sessionId: string,
    guildId: string,
    userId: string
  ): RuleAddSession | undefined {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (session.guildId !== guildId || session.userId !== userId) {
      return undefined;
    }

    if (session.expiresAt.getTime() <= this.now().getTime()) {
      this.sessionStore.delete(session.id);
      return undefined;
    }

    return session;
  }

  private renewSession(session: RuleAddSession): void {
    const now = this.now();
    session.updatedAt = now;
    session.expiresAt = this.computeExpiry(now);
    this.sessionStore.save(session);
  }

  private computeExpiry(reference: Date): Date {
    return new Date(reference.getTime() + SESSION_TTL_MS);
  }

  private async replyEphemeral(
    interaction: ModalSubmitInteraction | MessageComponentInteraction,
    content: string
  ): Promise<void> {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
      return;
    }

    await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
  }

  private async replySessionExpired(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    await this.replyEphemeral(
      interaction,
      "この操作は有効期限切れです。もう一度 `/vc-notify rule add` を実行してください。"
    );
  }

  private async updateSessionExpired(
    interaction: MessageComponentInteraction,
    invalidate: boolean = false
  ): Promise<void> {
    const content = invalidate
      ? "この操作は有効期限切れです。もう一度 `/vc-notify rule add` を実行してください。"
      : "この操作は無効です。必要であれば再度 `/vc-notify rule add` を実行してください。";

    await interaction
      .update({ content, components: [], embeds: [] })
      .catch(async () => {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
        }
      });
  }

  private isSessionReadyForCreation(session: RuleAddSession): boolean {
    return (
      Boolean(session.ruleName) &&
      session.watchedVoiceChannelIds.length > 0 &&
      Boolean(session.notificationChannelId)
    );
  }
}

function parseCustomId(customId: string): ParsedCustomId | null {
  if (!customId.startsWith(`${RULE_ADD_CUSTOM_ID_PREFIX}:`)) {
    return null;
  }

  const [, sessionId, action] = customId.split(":");
  if (!sessionId || !action) {
    return null;
  }

  if (!isRuleAddAction(action)) {
    return null;
  }

  return { sessionId, action };
}

function buildCustomId(sessionId: string, action: RuleAddInteractionAction): string {
  return `${RULE_ADD_CUSTOM_ID_PREFIX}:${sessionId}:${action}`;
}

function isRuleAddAction(value: string): value is RuleAddInteractionAction {
  return (
    value === "modal" ||
    value === "selectVoiceChannels" ||
    value === "selectTargetUsers" ||
    value === "skipTargetUsers" ||
    value === "selectNotificationChannel" ||
    value === "confirm" ||
    value === "cancel"
  );
}

export function createRuleCommand(deps: RuleCommandDeps): RuleCommand {
  return new RuleCommand(deps);
}
