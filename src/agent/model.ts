import type {
  ConversationModel,
  ConversationModelInput,
} from "../../packages/conversation-model/src/index.js";

export interface StructuredChatModel {
  decideTurn(input: ConversationModelInput): Promise<unknown>;
  answer(input: ConversationModelInput): Promise<string>;
}

export function adaptConversationModel(
  model: ConversationModel,
): StructuredChatModel {
  return {
    decideTurn: (input) => model.decideTurn(input),
    answer: (input) => model.answerGeneral(input),
  };
}

export const unavailableStructuredChatModel: StructuredChatModel = {
  decideTurn: unavailable,
  answer: unavailable,
};

async function unavailable(): Promise<never> {
  throw new Error("Conversation model is not configured.");
}
