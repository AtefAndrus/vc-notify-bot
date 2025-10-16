export type Snowflake = string;

export interface NotificationRule {
  id: string;
  guildId: Snowflake;
  name: string;
  watchedVoiceChannelIds: Snowflake[];
  targetUserIds: Snowflake[];
  notificationChannelId: Snowflake;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceContext {
  // TODO(#3): Service 層の依存関係（リポジトリ、通知チャネルなど）を定義
}
