import { NotificationRule } from "@/types";
import { NotificationRuleRepository } from "@/repositories/notificationRuleRepository";

export interface RuleService {
  listRules: (guildId: string) => Promise<NotificationRule[]>;
  // TODO(#3): addRule, updateRule などのルール操作を実装
}

export interface RuleServiceDeps {
  notificationRuleRepository: NotificationRuleRepository;
}

export function createRuleService(
  _deps: RuleServiceDeps
): RuleService {
  return {
    async listRules(_guildId: string) {
      // TODO(#3): Repository からルールを取得
      return [];
    },
  };
}
