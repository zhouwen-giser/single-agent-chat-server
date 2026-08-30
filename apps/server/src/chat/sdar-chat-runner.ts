import { legacyChatResultToInteractionEvents } from "../../../../packages/interaction-runtime/src/index.js";

import type { ChatRunner } from "../api/openai-routes.js";
import {
  ConversationApplicationService,
  type ConversationApplicationServiceOptions,
} from "./conversation-application-service.js";
import type { MapSelection } from "../../../../packages/wsgs-http-adapter/src/index.js";

export interface SdarChatRunnerOptions extends ConversationApplicationServiceOptions {
  readonly resolveStructuredSelections?: (input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly selectionIds: readonly string[];
  }) => Promise<readonly MapSelection[] | undefined>;
}

export function createSdarChatRunner(input: SdarChatRunnerOptions): ChatRunner {
  const application = new ConversationApplicationService(input);
  return async (context) => {
    const selectionIds = context.worldSelectionIds ?? [];
    const mapSelections =
      selectionIds.length === 0
        ? []
        : ((await input.resolveStructuredSelections?.({
            principalId: context.identity.userId,
            threadId: context.threadId,
            selectionIds,
          })) ?? []);
    return legacyChatResultToInteractionEvents(
      await application.execute({
        protocol: "openai",
        userText: context.userText,
        clientMessages: context.clientMessages,
        userId: context.identity.userId,
        chatId: context.openWebUi.chatId,
        threadId: context.threadId,
        userMessageId: context.openWebUi.userMessageId,
        utilityRequest: context.openWebUi.utilityTask !== undefined,
        mapSelections,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      }),
      { runId: context.runId, threadId: context.threadId },
    );
  };
}
