import { legacyChatResultToInteractionEvents } from "../../../../packages/interaction-runtime/src/index.js";

import type { ChatRunner } from "../api/openai-routes.js";
import {
  ConversationApplicationService,
  type ConversationApplicationServiceOptions,
} from "./conversation-application-service.js";

export function createSdarChatRunner(
  input: ConversationApplicationServiceOptions,
): ChatRunner {
  const application = new ConversationApplicationService(input);
  return async (context) =>
    legacyChatResultToInteractionEvents(
      await application.execute({
        protocol: "openai",
        userText: context.userText,
        clientMessages: context.clientMessages,
        userId: context.identity.userId,
        chatId: context.openWebUi.chatId,
        threadId: context.threadId,
        userMessageId: context.openWebUi.userMessageId,
        utilityRequest: context.openWebUi.utilityTask !== undefined,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      }),
      { runId: context.runId, threadId: context.threadId },
    );
}
