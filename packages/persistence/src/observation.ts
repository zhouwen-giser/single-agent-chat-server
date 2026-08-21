import type {
  ConversationProtocol,
  ConversationRole,
} from "../../conversation-context/src/index.js";
import type { CompletedRequestResult } from "../../request-result/src/index.js";

export interface PersistenceObservationSink {
  recordRequestResult(input: {
    readonly kind: CompletedRequestResult["kind"];
    readonly replay: boolean;
  }): void;
  recordConversationMessageDedup(input: {
    readonly protocol: ConversationProtocol;
    readonly role: ConversationRole;
  }): void;
}

export function observePersistence(observe: () => void): void {
  try {
    observe();
  } catch {
    // Observability is best-effort and cannot change a durable operation result.
  }
}
