import { NotificationRule } from "@/types";

export interface NotificationRuleRepository {
  findByGuildId: (guildId: string) => Promise<NotificationRule[]>;
  save: (rule: NotificationRule) => Promise<void>;
  // TODO(#5): delete, toggle などの操作を追加
}

export interface NotificationRuleRepositoryDeps {
  // TODO(#5): Database 接続やクエリビルダーを受け取る
}

export function createNotificationRuleRepository(
  _deps: NotificationRuleRepositoryDeps
): NotificationRuleRepository {
  return {
    async findByGuildId(_guildId: string) {
      // TODO(#5): SQLite からルールを取得
      return [];
    },
    async save(_rule: NotificationRule) {
      // TODO(#5): ルールの永続化を実装
    },
  };
}
