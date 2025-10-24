export interface NotifyPayload {
  guildId: string;
  voiceChannelId: string;
  userId: string;
  notificationChannelId: string;
  ruleId: string;
  ruleName: string;
}

export interface NotifyService {
  sendNotification: (payload: NotifyPayload) => Promise<void>;
}

export interface NotifyServiceDeps {
  // TODO(#4): Discord クライアントやロガーなどの依存を受け取る
}

export function createNotifyService(
  _deps: NotifyServiceDeps
): NotifyService {
  return {
    async sendNotification(_payload: NotifyPayload) {
      // TODO(#4): Discord API を利用した通知送信を実装
    },
  };
}
