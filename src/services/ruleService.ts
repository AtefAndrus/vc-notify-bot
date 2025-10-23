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
  deps: RuleServiceDeps
): RuleService {
  return {
    async listRules(guildId: string) {
      return deps.notificationRuleRepository.findEnabledByGuild(guildId);
    },
  };
}
