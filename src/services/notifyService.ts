export interface NotifyPayload {
  guildId: string;
  voiceChannelId: string;
  userId: string;
  notificationChannelId: string;
}

export interface NotifyService {
  sendNotification: (payload: NotifyPayload) => Promise<void>;
}

export function createNotifyService(): NotifyService {
  return {
    async sendNotification(_payload: NotifyPayload) {
      // TODO(#4): Discord API を利用した通知送信を実装
    },
  };
}
