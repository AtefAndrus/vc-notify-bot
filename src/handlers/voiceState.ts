import { VoiceState } from "discord.js";

import { NotifyService } from "@/services/notifyService";
import { RuleService } from "@/services/ruleService";

export interface VoiceStateHandlerDeps {
  ruleService: RuleService;
  notifyService: NotifyService;
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
