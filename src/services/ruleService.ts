import { NotificationRule } from "@/types";

export interface RuleService {
  listRules: (guildId: string) => Promise<NotificationRule[]>;
  // TODO(#3): addRule, updateRule などのルール操作を実装
}

export function createRuleService(): RuleService {
  return {
    async listRules(_guildId: string) {
      // TODO(#3): Repository からルールを取得
      return [];
    },
  };
}
