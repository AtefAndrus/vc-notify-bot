import { VoiceState } from "discord.js";

export interface VoiceStateHandlerDeps {
  // TODO(#4): ルール評価と通知サービスを注入
}

export interface VoiceStateHandler {
  handle: (oldState: VoiceState, newState: VoiceState) => Promise<void>;
}

export function createVoiceStateHandler(
  _deps: VoiceStateHandlerDeps
): VoiceStateHandler {
  return {
    async handle(_oldState, _newState) {
      // TODO(#4): VC 参加を検知して通知ルールを評価
    },
  };
}
