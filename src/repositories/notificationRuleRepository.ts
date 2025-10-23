import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import { NotificationRule } from "@/types";

export interface CreateNotificationRuleInput {
  guildId: string;
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
  enabled?: boolean;
}

export interface UpdateNotificationRuleInput {
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

export interface NotificationRuleRepository {
  createRule: (input: CreateNotificationRuleInput) => Promise<NotificationRule>;
  findById: (id: string) => Promise<NotificationRule | null>;
  findByGuild: (guildId: string) => Promise<NotificationRule[]>;
  findEnabledByGuild: (guildId: string) => Promise<NotificationRule[]>;
  updateRule: (
    id: string,
    updates: UpdateNotificationRuleInput
  ) => Promise<NotificationRule>;
  deleteRule: (id: string) => Promise<void>;
  toggleEnabled: (
    id: string,
    enabled: boolean
  ) => Promise<NotificationRule | null>;
  countByGuild: (guildId: string) => Promise<number>;
}

export interface NotificationRuleRepositoryDeps {
  db: Database;
  generateId?: () => string;
  getCurrentTime?: () => Date;
}

interface NotificationRuleRow {
  id: string;
  guild_id: string;
  name: string;
  watched_voice_channel_ids: string;
  target_user_ids: string;
  notification_channel_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function createNotificationRuleRepository(
  deps: NotificationRuleRepositoryDeps
): NotificationRuleRepository {
  const generateId = deps.generateId ?? randomUUID;
  const getCurrentTime = deps.getCurrentTime ?? (() => new Date());
  const db = deps.db;

  const insertStmt = db.prepare<
    never,
    {
      $id: string;
      $guildId: string;
      $name: string;
      $watchedVoiceChannelIds: string;
      $targetUserIds: string;
      $notificationChannelId: string;
      $enabled: number;
      $createdAt: string;
      $updatedAt: string;
    }
  >(`
    INSERT INTO notification_rules (
      id,
      guild_id,
      name,
      watched_voice_channel_ids,
      target_user_ids,
      notification_channel_id,
      enabled,
      created_at,
      updated_at
    ) VALUES (
      $id,
      $guildId,
      $name,
      $watchedVoiceChannelIds,
      $targetUserIds,
      $notificationChannelId,
      $enabled,
      $createdAt,
      $updatedAt
    )
  `);

  const selectByIdStmt = db.prepare<NotificationRuleRow, { $id: string }>(`
    SELECT *
    FROM notification_rules
    WHERE id = $id
  `);

  const selectByGuildStmt = db.prepare<
    NotificationRuleRow,
    { $guildId: string }
  >(
    `
      SELECT *
      FROM notification_rules
      WHERE guild_id = $guildId
      ORDER BY created_at ASC
    `
  );

  const selectEnabledByGuildStmt = db.prepare<
    NotificationRuleRow,
    { $guildId: string }
  >(`
    SELECT *
    FROM notification_rules
    WHERE guild_id = $guildId AND enabled = 1
    ORDER BY created_at ASC
  `);

  const updateStmt = db.prepare<
    never,
    {
      $id: string;
      $name: string;
      $watchedVoiceChannelIds: string;
      $targetUserIds: string;
      $notificationChannelId: string;
      $updatedAt: string;
    }
  >(`
    UPDATE notification_rules
    SET
      name = $name,
      watched_voice_channel_ids = $watchedVoiceChannelIds,
      target_user_ids = $targetUserIds,
      notification_channel_id = $notificationChannelId,
      updated_at = $updatedAt
    WHERE id = $id
  `);

  const toggleStmt = db.prepare<
    never,
    { $id: string; $enabled: number; $updatedAt: string }
  >(`
    UPDATE notification_rules
    SET
      enabled = $enabled,
      updated_at = $updatedAt
    WHERE id = $id
  `);

  const deleteStmt = db.prepare<never, { $id: string }>(`
    DELETE FROM notification_rules
    WHERE id = $id
  `);

  const countStmt = db.prepare<{ count: number }, { $guildId: string }>(`
    SELECT COUNT(*) AS count
    FROM notification_rules
    WHERE guild_id = $guildId
  `);

  return {
    async createRule(input) {
      const id = generateId();
      const now = getCurrentTime().toISOString();
      const enabled = input.enabled ?? true;

      insertStmt.run({
        $id: id,
        $guildId: input.guildId,
        $name: input.name,
        $watchedVoiceChannelIds: JSON.stringify(input.watchedVoiceChannelIds),
        $targetUserIds: JSON.stringify(input.targetUserIds),
        $notificationChannelId: input.notificationChannelId,
        $enabled: enabled ? 1 : 0,
        $createdAt: now,
        $updatedAt: now,
      });

      const record = selectByIdStmt.get({ $id: id });
      if (!record) {
        throw new Error("Failed to retrieve created notification rule");
      }

      return mapRowToDomain(record);
    },

    async findById(id) {
      const record = selectByIdStmt.get({ $id: id });
      return record ? mapRowToDomain(record) : null;
    },

    async findByGuild(guildId) {
      const rows = selectByGuildStmt.all({ $guildId: guildId });
      return rows.map(mapRowToDomain);
    },

    async findEnabledByGuild(guildId) {
      const rows = selectEnabledByGuildStmt.all({ $guildId: guildId });
      return rows.map(mapRowToDomain);
    },

    async updateRule(id, updates) {
      const updatedAt = getCurrentTime().toISOString();
      const result = updateStmt.run({
        $id: id,
        $name: updates.name,
        $watchedVoiceChannelIds: JSON.stringify(updates.watchedVoiceChannelIds),
        $targetUserIds: JSON.stringify(updates.targetUserIds),
        $notificationChannelId: updates.notificationChannelId,
        $updatedAt: updatedAt,
      });

      if (result.changes === 0) {
        throw new Error(`Notification rule not found: ${id}`);
      }

      const record = selectByIdStmt.get({ $id: id });
      if (!record) {
        throw new Error("Failed to retrieve updated notification rule");
      }

      return mapRowToDomain(record);
    },

    async deleteRule(id) {
      deleteStmt.run({ $id: id });
    },

    async toggleEnabled(id, enabled) {
      const updatedAt = getCurrentTime().toISOString();
      const result = toggleStmt.run({
        $id: id,
        $enabled: enabled ? 1 : 0,
        $updatedAt: updatedAt,
      });

      if (result.changes === 0) {
        return null;
      }

      const record = selectByIdStmt.get({ $id: id });
      return record ? mapRowToDomain(record) : null;
    },

    async countByGuild(guildId) {
      const row = countStmt.get({ $guildId: guildId });
      return row ? Number(row.count) : 0;
    },
  };
}

function mapRowToDomain(row: NotificationRuleRow): NotificationRule {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    watchedVoiceChannelIds: parseJsonArray(row.watched_voice_channel_ids),
    targetUserIds: parseJsonArray(row.target_user_ids),
    notificationChannelId: row.notification_channel_id,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
  } catch {
    // fall through
  }
  return [];
}
