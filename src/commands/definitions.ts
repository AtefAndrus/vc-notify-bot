import { ApplicationCommandOptionType } from "discord.js";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";

export const VC_NOTIFY_COMMAND_NAME = "vc-notify";
export const SETUP_SUBCOMMAND_NAME = "setup";
export const RULE_SUBCOMMAND_GROUP_NAME = "rule";

export const vcNotifyCommandDefinition: RESTPostAPIApplicationCommandsJSONBody =
  {
    name: VC_NOTIFY_COMMAND_NAME,
    description: "VC参加通知Bot管理",
    options: [
      {
        name: SETUP_SUBCOMMAND_NAME,
        description: "初回セットアップ",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: RULE_SUBCOMMAND_GROUP_NAME,
        description: "ルール管理",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "add",
            description: "ルール追加",
            type: ApplicationCommandOptionType.Subcommand,
          },
          {
            name: "list",
            description: "ルール一覧",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "show_disabled",
                description: "無効なルールも表示",
                type: ApplicationCommandOptionType.Boolean,
                required: false,
              },
            ],
          },
          {
            name: "edit",
            description: "ルール編集",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
          {
            name: "toggle",
            description: "ルール有効/無効切り替え",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
          {
            name: "delete",
            description: "ルール削除",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
        ],
      },
    ],
  };

export const commandDefinitions: RESTPostAPIApplicationCommandsJSONBody[] = [
  vcNotifyCommandDefinition,
];
