import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import {
  parseTurnDecision,
  type ConversationModel,
  type ConversationModelInput,
  type TurnDecision,
} from "../packages/conversation-model/src/index.js";
import {
  parseCompletedRequestResult,
  type CompletedRequestResult,
} from "../packages/request-result/src/index.js";
import {
  parseTaskDirectorySnapshot,
  parseTaskSelector,
  type TaskDirectorySnapshot,
  type TaskSelector,
} from "../packages/task-directory/src/index.js";

const contractRoot = fileURLToPath(
  new URL("../contracts/v0.3/", import.meta.url),
);

function loadSchema(name: string): AnySchema {
  return JSON.parse(
    readFileSync(`${contractRoot}${name}.schema.json`, "utf8"),
  ) as AnySchema;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", true);
const selectorJsonSchema = loadSchema("task-selector");
ajv.addSchema(selectorJsonSchema);

const validateJson = {
  turn: ajv.compile(loadSchema("turn-decision")),
  selector: ajv.getSchema(
    "https://schemas.sacs.local/v0.3/task-selector.schema.json",
  ) as ValidateFunction,
  directory: ajv.compile(loadSchema("task-directory")),
  result: ajv.compile(loadSchema("completed-request-result")),
};

function expectBothValid<T>(
  value: unknown,
  jsonValidator: ValidateFunction,
  zodParser: (input: unknown) => T,
): T {
  const valid = jsonValidator(value);
  if (!valid) {
    throw new Error(
      `JSON Schema rejected value: ${JSON.stringify(jsonValidator.errors)}`,
    );
  }
  expect(valid).toBe(true);
  return zodParser(value);
}

function expectBothInvalid(
  value: unknown,
  jsonValidator: ValidateFunction,
  zodParser: (input: unknown) => unknown,
): void {
  expect(jsonValidator(value)).toBe(false);
  expect(() => zodParser(value)).toThrow();
}

describe("SACS v0.3 frozen domain contracts", () => {
  it("accepts every TurnDecision kind in JSON Schema and Zod", () => {
    const decisions = [
      { kind: "general_chat" },
      { kind: "new_task", taskText: "Inspect provider health through SDAR." },
      { kind: "list_tasks", includeTerminal: false },
      { kind: "task_status" },
      { kind: "task_status", selector: { reference: "focused" } },
      {
        kind: "task_follow_up",
        selector: { shortId: "abcd1234" },
        action: "provide_input",
        text: "Use the bounded diagnostic input.",
      },
      { kind: "task_cancel", selector: { taskId: "task-1" } },
      { kind: "clarification", question: "Which Task do you mean?" },
    ] as const satisfies readonly TurnDecision[];

    for (const decision of decisions) {
      expectBothValid(decision, validateJson.turn, parseTurnDecision);
    }
  });

  it("rejects extra decision fields and illegal follow-up actions", () => {
    expectBothInvalid(
      { kind: "general_chat", endpoint: "https://attacker.invalid/a2a" },
      validateJson.turn,
      parseTurnDecision,
    );
    expectBothInvalid(
      {
        kind: "task_follow_up",
        selector: { taskId: "task-1" },
        action: "run_arbitrary_tool",
        text: "do it",
      },
      validateJson.turn,
      parseTurnDecision,
    );
  });

  it("requires a TaskSelector to express exactly one bounded strategy", () => {
    const selectors = [
      { taskId: "task-1" },
      { shortId: "abcd1234" },
      { ordinal: 2 },
      { reference: "previous" },
      { summaryQuery: "provider health" },
    ] as const satisfies readonly TaskSelector[];
    for (const selector of selectors) {
      expectBothValid(selector, validateJson.selector, parseTaskSelector);
    }
    for (const invalid of [
      {},
      { taskId: "task-1", reference: "focused" },
      { endpoint: "https://attacker.invalid/a2a" },
      { ordinal: 0 },
    ]) {
      expectBothInvalid(invalid, validateJson.selector, parseTaskSelector);
    }
  });

  it("freezes a bounded multi-Task directory with explicit binding identity", () => {
    const snapshot = {
      focusedTaskId: "task-a",
      lastReferencedTaskId: "task-b",
      activeTasks: [
        {
          bindingId: "binding-a",
          taskId: "task-a",
          contextId: "context-a",
          shortId: "task-a",
          status: "WORKING",
          summary: "Inspect provider health",
          createdAt: "2026-08-21T10:00:00.000Z",
          updatedAt: "2026-08-21T10:01:00.000Z",
        },
      ],
      recentTerminalTasks: [],
    } satisfies TaskDirectorySnapshot;

    expectBothValid(
      snapshot,
      validateJson.directory,
      parseTaskDirectorySnapshot,
    );
    expectBothInvalid(
      { ...snapshot, endpoint: "http://other-sdar.invalid" },
      validateJson.directory,
      parseTaskDirectorySnapshot,
    );
  });

  it("enforces the exclusive TASK or MESSAGE completed result", () => {
    const taskResult = {
      kind: "task",
      taskId: "task-1",
      contextId: "context-1",
    } satisfies CompletedRequestResult;
    const messageResult = {
      kind: "message",
      messageId: "message-1",
      relatedTaskId: "task-1",
      contextId: "context-1",
      message: {
        messageId: "message-1",
        taskId: "task-1",
        contextId: "context-1",
        role: "AGENT",
        parts: [{ kind: "text", mediaType: "text/plain", text: "Done." }],
      },
      renderedText: "Done.",
    } satisfies CompletedRequestResult;

    expectBothValid(
      taskResult,
      validateJson.result,
      parseCompletedRequestResult,
    );
    expectBothValid(
      messageResult,
      validateJson.result,
      parseCompletedRequestResult,
    );
    for (const invalid of [
      { kind: "task", taskId: "task-1" },
      {
        ...taskResult,
        messageId: "message-1",
        message: messageResult.message,
        renderedText: "conflict",
      },
      { kind: "message", messageId: "message-1", renderedText: "missing" },
    ]) {
      expectBothInvalid(
        invalid,
        validateJson.result,
        parseCompletedRequestResult,
      );
    }
  });

  it("keeps the model interface tool-free and context-only", async () => {
    const fakeModel: ConversationModel = {
      decideTurn: async () => ({ kind: "general_chat" }),
      answerGeneral: async () => "Hello.",
      summarize: async () => "Summary.",
    };
    const input = {
      currentUserText: "hello",
      context: {
        threadId: "thread-1",
        messages: [],
        activeTasks: [],
        recentTerminalTasks: [],
      },
    } satisfies ConversationModelInput;

    await expect(fakeModel.decideTurn(input)).resolves.toEqual({
      kind: "general_chat",
    });
    expect(Object.keys(fakeModel).sort()).toEqual([
      "answerGeneral",
      "decideTurn",
      "summarize",
    ]);
  });
});
