import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";

export interface RequiredPermission {
  bit: bigint;
  label: string;
}

export interface SetupCommandDeps {
  requiredBotPermissions?: RequiredPermission[];
  checkDatabaseReady: () => Promise<boolean>;
  now?: () => Date;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
}

export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
  deps: SetupCommandDeps
): Promise<void> {
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const requiredPermissions =
    deps.requiredBotPermissions ?? DEFAULT_REQUIRED_BOT_PERMISSIONS;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "このコマンドはサーバー内でのみ使用できます。",
      ephemeral: true,
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "ギルド情報を取得できませんでした。時間を置いて再度お試しください。",
      ephemeral: true,
    });
    return;
  }

  const memberPermissions = interaction.memberPermissions;
  const hasManageGuild =
    memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

  const botMember =
    guild.members.me ??
    (interaction.client.user
      ? await guild.members
          .fetch(interaction.client.user.id)
          .catch((error) => {
            const detail =
              error instanceof Error ? error.message : String(error);
            logger.warn?.(
              `SetupCommand: Bot メンバー情報の取得に失敗しました: ${detail}`
            );
            return null;
          })
      : null);

  if (!botMember) {
    await interaction.reply({
      content:
        "Bot のメンバー情報を取得できませんでした。時間を置いて再度お試しください。",
      ephemeral: true,
    });
    return;
  }

  const botPermissions = botMember.permissions ?? new PermissionsBitField();
  const missingBotPermissions = requiredPermissions.filter(
    (permission) => !botPermissions.has(permission.bit)
  );

  let databaseReady = false;
  let databaseCheckError: Error | undefined;
  try {
    databaseReady = await deps.checkDatabaseReady();
  } catch (error) {
    databaseCheckError = error instanceof Error ? error : new Error(String(error));
    databaseReady = false;
    logger.error(
      `SetupCommand: データベース状態の確認に失敗しました: ${databaseCheckError.message}`
    );
  }

  const overallSuccess =
    hasManageGuild && missingBotPermissions.length === 0 && databaseReady;

  const embed = new EmbedBuilder()
    .setTitle(
      overallSuccess ? "✅ セットアップ完了" : "⚠️ セットアップの前提条件を確認してください"
    )
    .setColor(overallSuccess ? 0x00ff00 : 0xffa500)
    .addFields(
      {
        name: "実行者の権限",
        value: hasManageGuild ? "✅ MANAGE_GUILD" : "❌ MANAGE_GUILD",
        inline: true,
      },
      {
        name: "現在のBot権限",
        value: requiredPermissions
          .map((permission) =>
            botPermissions.has(permission.bit)
              ? `✅ ${permission.label}`
              : `❌ ${permission.label}`
          )
          .join("\n"),
        inline: true,
      }
    )
    .setTimestamp(now());

  if (databaseReady) {
    embed.addFields({
      name: "データベース",
      value: "✅ 初期化済み",
      inline: true,
    });
  } else {
    embed.addFields({
      name: "データベース",
      value:
        "❌ 未初期化またはアクセスできません\n`mise run setup` を実行し、Bot を再起動してください。",
      inline: true,
    });
  }

  if (missingBotPermissions.length > 0) {
    embed.addFields({
      name: "不足しているBot権限",
      value: missingBotPermissions.map((permission) => permission.label).join("\n"),
    });
    embed.addFields({
      name: "権限の付与方法",
      value:
        "サーバー設定 → ロール から Bot のロールに必要な権限を付与するか、招待リンクを再生成して権限付きで追加してください。",
    });
  }

  if (!hasManageGuild) {
    embed.addFields({
      name: "実行者へのヒント",
      value: "サーバー設定で `MANAGE_GUILD` 権限を持つユーザーが実行してください。",
    });
  }

  if (databaseCheckError) {
    embed.addFields({
      name: "エラー詳細",
      value: `\`${databaseCheckError.message}\``,
    });
  }

  embed.addFields({
    name: "次のステップ",
    value: overallSuccess
      ? "`/vc-notify rule add` で通知ルールを作成してください。"
      : "不足項目を解消してから再度 `/vc-notify setup` を実行してください。",
  });

  if (!overallSuccess) {
    embed.setFooter({
      text: "不足項目を解消するまで通知機能は動作しません。",
    });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

export const DEFAULT_REQUIRED_BOT_PERMISSIONS: RequiredPermission[] = [
  { bit: PermissionFlagsBits.ViewChannel, label: "VIEW_CHANNEL" },
  { bit: PermissionFlagsBits.SendMessages, label: "SEND_MESSAGES" },
  { bit: PermissionFlagsBits.UseApplicationCommands, label: "USE_SLASH_COMMANDS" },
];
