CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  watched_voice_channel_ids TEXT NOT NULL,
  target_user_ids TEXT NOT NULL,
  notification_channel_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_guild_id
  ON notification_rules(guild_id);

CREATE INDEX IF NOT EXISTS idx_notification_rules_enabled
  ON notification_rules(enabled);
