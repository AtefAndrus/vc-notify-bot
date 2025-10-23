import { ChatInputCommandInteraction } from "discord.js";

export interface SetupCommandDeps {
  // TODO(#6): Service 層やリポジトリを注入
}

export async function handleSetupCommand(
  _interaction: ChatInputCommandInteraction,
  _deps: SetupCommandDeps
): Promise<void> {
  // TODO(#6): セットアップウィザードの実装
}
