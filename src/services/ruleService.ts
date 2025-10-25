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

export class RuleRepositoryConflictError extends RuleServiceError {
  constructor(public readonly ruleId: string) {
    super(
      "Rule repository returned inconsistent state",
      "RULE_REPOSITORY_CONFLICT"
    );
    this.name = "RuleRepositoryConflictError";
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
      const { violations, normalized } = validateCreateRuleInput(input);
      if (violations.length > 0 || !normalized) {
        log(logger, "warn", "RuleService.createRule: validation failed", {
          guildId: input.guildId,
          violations,
        });
        throw new RuleValidationError(violations);
      }

      const ruleCount = await repository.countByGuild(normalized.guildId);
      if (ruleCount >= RULES_PER_GUILD_LIMIT) {
        log(logger, "warn", "RuleService.createRule: limit exceeded", {
          guildId: normalized.guildId,
          limit: RULES_PER_GUILD_LIMIT,
        });
        throw new RuleLimitExceededError(normalized.guildId, RULES_PER_GUILD_LIMIT);
      }

      const created = await repository.createRule({
        guildId: normalized.guildId,
        name: normalized.name,
        watchedVoiceChannelIds: normalized.watchedVoiceChannelIds,
        targetUserIds: normalized.targetUserIds,
        notificationChannelId: normalized.notificationChannelId,
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

      const { violations, normalized } = validateUpdateRuleInput(input);
      if (violations.length > 0 || !normalized) {
        log(logger, "warn", "RuleService.updateRule: validation failed", {
          ruleId: id,
          violations,
        });
        throw new RuleValidationError(violations);
      }

      const updated = await repository.updateRule(id, {
        name: normalized.name,
        watchedVoiceChannelIds: normalized.watchedVoiceChannelIds,
        targetUserIds: normalized.targetUserIds,
        notificationChannelId: normalized.notificationChannelId,
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
        log(
          logger,
          "error",
          "RuleService.toggleRule: repository inconsistency detected",
          {
            ruleId: id,
            expectedEnabled: nextState,
          }
        );
        throw new RuleRepositoryConflictError(id);
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

interface NormalizedRuleFields {
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

interface NormalizedCreateRuleInput extends NormalizedRuleFields {
  guildId: string;
}

interface ValidationOutcome<T> {
  violations: string[];
  normalized?: T;
}

function validateCreateRuleInput(
  input: CreateRuleInput
): ValidationOutcome<NormalizedCreateRuleInput> {
  const violations: string[] = [];
  const common = validateCommonRuleFields(input);
  violations.push(...common.violations);

  const guildId = typeof input.guildId === "string" ? input.guildId.trim() : "";
  if (!SNOWFLAKE_REGEX.test(guildId)) {
    violations.push("guildId must be a valid snowflake ID.");
  }

  if (violations.length > 0 || !common.normalized) {
    return { violations };
  }

  return {
    violations,
    normalized: {
      guildId,
      ...common.normalized,
    },
  };
}

function validateUpdateRuleInput(
  input: UpdateRuleInput
): ValidationOutcome<NormalizedRuleFields> {
  const common = validateCommonRuleFields(input);
  return {
    violations: [...common.violations],
    normalized: common.normalized,
  };
}

function validateCommonRuleFields(
  input: Pick<
    CreateRuleInput,
    "name" | "watchedVoiceChannelIds" | "targetUserIds" | "notificationChannelId"
  >
): ValidationOutcome<NormalizedRuleFields> {
  const violations: string[] = [];

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    violations.push("name must be between 1 and 50 characters.");
  }

  let watchedVoiceChannelIds: string[] = [];

  if (!Array.isArray(input.watchedVoiceChannelIds)) {
    violations.push("watchedVoiceChannelIds must be an array.");
  } else {
    watchedVoiceChannelIds = input.watchedVoiceChannelIds.map(
      (channelId) => String(channelId).trim()
    );

    if (
      watchedVoiceChannelIds.length < WATCHED_CHANNEL_MIN ||
      watchedVoiceChannelIds.length > WATCHED_CHANNEL_MAX
    ) {
      violations.push(
        "watchedVoiceChannelIds must contain between 1 and 10 items."
      );
    }

    if (
      watchedVoiceChannelIds.some(
        (channelId) => !SNOWFLAKE_REGEX.test(channelId)
      )
    ) {
      violations.push(
        "watchedVoiceChannelIds must contain valid snowflake IDs."
      );
    }
  }

  let targetUserIds: string[] = [];

  if (!Array.isArray(input.targetUserIds)) {
    violations.push("targetUserIds must be an array.");
  } else {
    targetUserIds = input.targetUserIds.map((userId) => String(userId).trim());

    if (targetUserIds.length > TARGET_USER_MAX) {
      violations.push("targetUserIds must not exceed 50 items.");
    }

    if (targetUserIds.some((userId) => !SNOWFLAKE_REGEX.test(userId))) {
      violations.push("targetUserIds must contain valid snowflake IDs.");
    }
  }

  const notificationChannelId =
    typeof input.notificationChannelId === "string"
      ? input.notificationChannelId.trim()
      : "";
  if (!SNOWFLAKE_REGEX.test(notificationChannelId)) {
    violations.push("notificationChannelId must be a valid snowflake ID.");
  }

  if (violations.length > 0) {
    return { violations };
  }

  return {
    violations,
    normalized: {
      name,
      watchedVoiceChannelIds,
      targetUserIds,
      notificationChannelId,
    },
  };
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
