import type { ConversationProtocol, ConversationRole } from "./index.js";
import type { ConversationHistoryPort } from "./ports.js";

export type ClientHistoryRole = ConversationRole | "system" | "developer";

export interface ClientHistoryMessage {
  readonly role: ClientHistoryRole;
  readonly contentText: string;
  readonly externalMessageId?: string;
}

export interface ClientHistoryImportResult {
  readonly insertedUsers: number;
  readonly duplicateUsers: number;
  readonly matchedAssistants: number;
  readonly missingAssistants: number;
  readonly ignoredUnstableHistory: number;
  readonly ignoredPrivilegedRoles: number;
  readonly currentUserMessageSequence?: number;
}

export class ClientHistoryImporter {
  constructor(private readonly history: ConversationHistoryPort) {}

  async import(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly protocol: ConversationProtocol;
    readonly requestId: string;
    readonly currentUserExternalMessageId: string;
    readonly messages: readonly ClientHistoryMessage[];
  }): Promise<ClientHistoryImportResult> {
    const currentUserIndex = findCurrentUserIndex(input.messages);
    const counts = {
      insertedUsers: 0,
      duplicateUsers: 0,
      matchedAssistants: 0,
      missingAssistants: 0,
      ignoredUnstableHistory: 0,
      ignoredPrivilegedRoles: 0,
    };
    let currentUserMessageSequence: number | undefined;
    for (const [index, message] of input.messages.entries()) {
      if (message.role === "system" || message.role === "developer") {
        counts.ignoredPrivilegedRoles += 1;
        continue;
      }
      const isCurrentUser =
        message.role === "user" && index === currentUserIndex;
      const externalMessageId = isCurrentUser
        ? input.currentUserExternalMessageId
        : message.externalMessageId;
      if (externalMessageId === undefined) {
        counts.ignoredUnstableHistory += 1;
        continue;
      }
      if (message.role === "user") {
        const result = await this.history.ingestUserMessage({
          principalId: input.principalId,
          threadId: input.threadId,
          protocol: input.protocol,
          externalMessageId,
          contentText: message.contentText,
          ...(isCurrentUser ? { requestId: input.requestId } : {}),
        });
        if (result.outcome === "inserted") counts.insertedUsers += 1;
        else counts.duplicateUsers += 1;
        if (isCurrentUser) currentUserMessageSequence = result.message.sequence;
        continue;
      }
      const result = await this.history.reconcileAssistantMessage({
        principalId: input.principalId,
        threadId: input.threadId,
        protocol: input.protocol,
        externalMessageId,
        contentText: message.contentText,
      });
      if (result.outcome === "matched") counts.matchedAssistants += 1;
      else counts.missingAssistants += 1;
    }
    return {
      ...counts,
      ...(currentUserMessageSequence === undefined
        ? {}
        : { currentUserMessageSequence }),
    };
  }
}

function findCurrentUserIndex(
  messages: readonly ClientHistoryMessage[],
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  throw new Error("Client history has no current user message");
}
