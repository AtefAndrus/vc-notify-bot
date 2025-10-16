import { ChatInputCommandInteraction } from "discord.js";

export interface RuleCommandDeps {
  // TODO(#6): RuleService や NotifyService を注入
}

export async function handleRuleCommand(
  _interaction: ChatInputCommandInteraction,
  _deps: RuleCommandDeps
): Promise<void> {
  // TODO(#6): ルール管理コマンドを実装
}
