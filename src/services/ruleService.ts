import { NotificationRule } from "@/types";
import { NotificationRuleRepository } from "@/repositories/notificationRuleRepository";

export interface CreateRuleInput {
  guildId: string;
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

export interface UpdateRuleInput {
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

export interface ListRulesOptions {
  includeDisabled?: boolean;
}

export abstract class RuleServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RuleServiceError";
  }
}

export class RuleValidationError extends RuleServiceError {
  constructor(public readonly violations: string[]) {
    super("Rule validation failed", "RULE_VALIDATION_ERROR");
    this.name = "RuleValidationError";
  }
}

export class RuleLimitExceededError extends RuleServiceError {
  constructor(public readonly guildId: string, public readonly limit: number) {
    super("Rule limit exceeded", "RULE_LIMIT_EXCEEDED");
    this.name = "RuleLimitExceededError";
  }
}

export class RuleNotFoundError extends RuleServiceError {
  constructor(public readonly ruleId: string) {
    super("Rule not found", "RULE_NOT_FOUND");
    this.name = "RuleNotFoundError";
  }
}

export interface RuleService {
  createRule: (input: CreateRuleInput) => Promise<NotificationRule>;
  updateRule: (id: string, input: UpdateRuleInput) => Promise<NotificationRule>;
  deleteRule: (id: string) => Promise<void>;
  toggleRule: (id: string, enabled?: boolean) => Promise<NotificationRule>;
  listRules: (
    guildId: string,
    options?: ListRulesOptions
  ) => Promise<NotificationRule[]>;
  getApplicableRules: (
    guildId: string,
    voiceChannelId: string,
    userId: string
  ) => Promise<NotificationRule[]>;
}

export interface RuleServiceDeps {
  notificationRuleRepository: NotificationRuleRepository;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
}

export function createRuleService(deps: RuleServiceDeps): RuleService {
  const repository = deps.notificationRuleRepository;
  const logger = deps.logger ?? console;

  return {
    async createRule(input) {
      const violations = validateRuleInput(input);
      if (violations.length > 0) {
        log(logger, "warn", "RuleService.createRule: validation failed", {
          guildId: input.guildId,
          violations,
        });
        throw new RuleValidationError(violations);
      }

      const ruleCount = await repository.countByGuild(input.guildId);
      if (ruleCount >= RULES_PER_GUILD_LIMIT) {
        log(logger, "warn", "RuleService.createRule: limit exceeded", {
          guildId: input.guildId,
          limit: RULES_PER_GUILD_LIMIT,
        });
        throw new RuleLimitExceededError(input.guildId, RULES_PER_GUILD_LIMIT);
      }

      const created = await repository.createRule({
        guildId: input.guildId,
        name: input.name.trim(),
        watchedVoiceChannelIds: [...input.watchedVoiceChannelIds],
        targetUserIds: [...input.targetUserIds],
        notificationChannelId: input.notificationChannelId,
        enabled: true,
      });

      log(logger, "info", "RuleService.createRule: rule created", {
        guildId: created.guildId,
        ruleId: created.id,
      });

      return created;
    },

    async updateRule(id, input) {
      const existing = await repository.findById(id);
      if (!existing) {
        log(logger, "warn", "RuleService.updateRule: rule not found", {
          ruleId: id,
        });
        throw new RuleNotFoundError(id);
      }

      const violations = validateRuleInput(input);
      if (violations.length > 0) {
        log(logger, "warn", "RuleService.updateRule: validation failed", {
          ruleId: id,
          violations,
        });
        throw new RuleValidationError(violations);
      }

      const updated = await repository.updateRule(id, {
        name: input.name.trim(),
        watchedVoiceChannelIds: [...input.watchedVoiceChannelIds],
        targetUserIds: [...input.targetUserIds],
        notificationChannelId: input.notificationChannelId,
      });

      log(logger, "info", "RuleService.updateRule: rule updated", {
        ruleId: id,
      });

      return updated;
    },

    async deleteRule(id) {
      const existing = await repository.findById(id);
      if (!existing) {
        log(logger, "warn", "RuleService.deleteRule: rule not found", {
          ruleId: id,
        });
        throw new RuleNotFoundError(id);
      }

      await repository.deleteRule(id);

      log(logger, "info", "RuleService.deleteRule: rule deleted", {
        ruleId: id,
      });
    },

    async toggleRule(id, enabled) {
      const existing = await repository.findById(id);
      if (!existing) {
        log(logger, "warn", "RuleService.toggleRule: rule not found", {
          ruleId: id,
        });
        throw new RuleNotFoundError(id);
      }

      const nextState = typeof enabled === "boolean" ? enabled : !existing.enabled;
      const toggled = await repository.toggleEnabled(id, nextState);

      if (!toggled) {
        log(logger, "warn", "RuleService.toggleRule: repository returned null", {
          ruleId: id,
        });
        throw new RuleNotFoundError(id);
      }

      log(logger, "info", "RuleService.toggleRule: rule toggled", {
        ruleId: id,
        enabled: toggled.enabled,
      });

      return toggled;
    },

    async listRules(guildId, options) {
      if (options?.includeDisabled) {
        return repository.findByGuild(guildId);
      }
      return repository.findEnabledByGuild(guildId);
    },

    async getApplicableRules(guildId, voiceChannelId, userId) {
      const rules = await repository.findEnabledByGuild(guildId);

      return rules.filter((rule) => {
        if (!rule.watchedVoiceChannelIds.includes(voiceChannelId)) {
          return false;
        }

        if (rule.targetUserIds.length === 0) {
          return true;
        }

        return rule.targetUserIds.includes(userId);
      });
    },
  };
}

const RULES_PER_GUILD_LIMIT = 50;
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;
const WATCHED_CHANNEL_MIN = 1;
const WATCHED_CHANNEL_MAX = 10;
const TARGET_USER_MAX = 50;
const SNOWFLAKE_REGEX = /^\d{17,19}$/;

function validateRuleInput(
  input: CreateRuleInput | UpdateRuleInput
): string[] {
  const violations: string[] = [];

  const name = input.name?.trim();
  if (!name || name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    violations.push("name must be between 1 and 50 characters.");
  }

  if (
    !Array.isArray(input.watchedVoiceChannelIds) ||
    input.watchedVoiceChannelIds.length < WATCHED_CHANNEL_MIN ||
    input.watchedVoiceChannelIds.length > WATCHED_CHANNEL_MAX
  ) {
    violations.push(
      "watchedVoiceChannelIds must contain between 1 and 10 items."
    );
  } else if (
    input.watchedVoiceChannelIds.some(
      (channelId) => !SNOWFLAKE_REGEX.test(String(channelId))
    )
  ) {
    violations.push("watchedVoiceChannelIds must contain valid snowflake IDs.");
  }

  if (!Array.isArray(input.targetUserIds)) {
    violations.push("targetUserIds must be an array.");
  } else {
    if (input.targetUserIds.length > TARGET_USER_MAX) {
      violations.push("targetUserIds must not exceed 50 items.");
    }

    if (
      input.targetUserIds.some((userId) => !SNOWFLAKE_REGEX.test(String(userId)))
    ) {
      violations.push("targetUserIds must contain valid snowflake IDs.");
    }
  }

  if (!SNOWFLAKE_REGEX.test(String(input.notificationChannelId))) {
    violations.push("notificationChannelId must be a valid snowflake ID.");
  }

  return violations;
}

function log(
  logger: Pick<typeof console, "info" | "warn" | "error">,
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>
): void {
  if (context) {
    logger[level](message, context);
  } else {
    logger[level](message);
  }
}
