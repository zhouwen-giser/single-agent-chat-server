import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  effectiveReferenceStatus,
  parseConversationWorldFocus,
  parseGroundingContinuation,
  parsePendingGroundingChoice,
  worldReferenceIdentityHash,
} from "../packages/conversation-world-focus/src/index.js";
import {
  parseWsgsGroundingContextCapsule,
  parseWsgsGroundingRequest,
} from "../packages/wsgs-http-adapter/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = "sha256:" + "a".repeat(64);
const referenceKey = {
  namespace: "gowm" as const,
  kind: "vehicle",
  id: "wrf_" + "1".repeat(32),
  version: "world-7",
};

describe("SACS v0.4 S06 ConversationWorldFocus contracts", () => {
  it("keeps migrations 0001 through 0010 byte immutable", () => {
    const locked = readJson("reports/v0.4/S00-source-lock.json") as {
      immutableMigrations: Record<string, string>;
    };
    for (const [path, expected] of Object.entries(locked.immutableMigrations)) {
      expect("sha256:" + sha256File(path)).toBe(expected);
    }
    expect(sha256File("migrations/0010_grounding_lifecycle.sql")).toBe(
      "6ecc7c09c6abfe34db8bcefb96d83636dc6909fc19c4b82c0787e65c5553b291",
    );
  });

  it("adds only bounded World Focus, reference, and PendingChoice persistence", () => {
    const migration = readFileSync(
      root + "migrations/0011_conversation_world_focus.sql",
      "utf8",
    );
    expect(migration).toContain(
      "CREATE TABLE chat_service.conversation_world_focus",
    );
    expect(migration).toContain(
      "CREATE TABLE chat_service.conversation_world_reference",
    );
    expect(migration).toContain(
      "CREATE TABLE chat_service.pending_grounding_choice",
    );
    expect(migration).toContain(
      "world focus revision must increase by exactly one",
    );
    expect(migration).toContain("pending_grounding_choice_one_open");
    expect(migration).not.toMatch(
      /geometry|full_result|conversation_history/iu,
    );
  });

  it("compiles the frozen S06 JSON Schemas", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const name of [
      "common.schema.json",
      "world-focus-reference.schema.json",
      "conversation-world-focus.schema.json",
      "pending-grounding-choice.schema.json",
      "grounding-continuation.schema.json",
    ]) {
      expect(() => {
        const schema = readJson("contracts/v0.4/" + name) as object;
        ajv.addSchema(schema, name);
      }).not.toThrow();
    }
  });

  it("uses object identity independent of ReferenceKey version", () => {
    expect(worldReferenceIdentityHash(referenceKey)).toBe(
      worldReferenceIdentityHash({ ...referenceKey, version: "world-8" }),
    );
    expect(worldReferenceIdentityHash(referenceKey)).not.toBe(
      worldReferenceIdentityHash({
        ...referenceKey,
        id: "wrf_" + "2".repeat(32),
      }),
    );
  });

  it("computes expiry and revalidation without interpreting ReferenceKey", () => {
    const reference = focusReference();
    expect(
      effectiveReferenceStatus(reference, new Date("2026-08-29T00:30:00Z")),
    ).toBe("VALID");
    expect(
      effectiveReferenceStatus(reference, new Date("2026-08-29T02:00:00Z")),
    ).toBe("EXPIRED");
    expect(
      effectiveReferenceStatus(
        { ...reference, revalidationRequired: true },
        new Date("2026-08-29T00:30:00Z"),
      ),
    ).toBe("STALE");
  });

  it("parses bounded Focus, PendingChoice, and continuation records", () => {
    expect(
      parseConversationWorldFocus({
        schemaVersion: "1.0",
        principalId: "principal-1",
        threadId: "thread-1",
        revision: 1,
        lastGroundingId: "grounding-1",
        lastGroundingResultHash: sha,
        references: [focusReference()],
        updatedAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toMatchObject({ revision: 1 });
    expect(
      parsePendingGroundingChoice({
        schemaVersion: "1.0",
        choiceId: "choice-1",
        principalId: "principal-1",
        threadId: "thread-1",
        originMessageId: "message-1",
        originGroundingId: "grounding-1",
        originResultHash: sha,
        originTurnPlan: { schemaVersion: "0.4" },
        originRequestPlan: { schemaVersion: "1.0" },
        mentionId: "mention-1",
        surfaceText: "滨河路",
        candidates: [
          { ordinal: 1, productId: "product-1", displayName: "滨河路南区" },
          { ordinal: 2, productId: "product-2", displayName: "滨河路北区" },
        ],
        status: "OPEN",
        expiresAt: "2026-08-29T01:00:00.000Z",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
      }),
    ).toMatchObject({ status: "OPEN" });
    expect(
      parseGroundingContinuation({
        schemaVersion: "1.0",
        choiceId: "choice-1",
        controlMessageId: "message-2",
        selectedProductId: "product-2",
        validationOperation: "VALIDATE_REFERENCES",
        resumeSourcePolicy: "RESTORE_ORIGIN_MESSAGE",
        state: "CHOICE_SELECTED",
      }),
    ).toMatchObject({ selectedProductId: "product-2" });
  });

  it("validates exact WSGS context subcontracts and rejects authority drift", () => {
    const context = {
      knownWorldReferences: [
        {
          alias: "2号车",
          referenceKey,
          referenceType: "vehicle",
          sourceMessageId: "message-1",
          sourceGroundingId: "grounding-1",
          validUntil: "2026-08-29T01:00:00.000Z",
        },
      ],
      priorGroundings: [
        {
          groundingId: "grounding-1",
          resultHash: sha,
          selectedProductIds: ["product-1"],
        },
      ],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    };
    expect(parseWsgsGroundingContextCapsule(context)).toEqual(context);
    expect(() =>
      parseWsgsGroundingContextCapsule({
        ...context,
        knownWorldReferences: [
          { ...context.knownWorldReferences[0], productId: "model-choice" },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseWsgsGroundingRequest({
        ...request(),
        contextCapsule: {
          ...context,
          externalCorrelationHints: [
            {
              hintId: "hint-1",
              externalAuthority: "SDAR",
              kind: "EXTERNAL_TASK",
              value: "task-1",
              forbiddenPlan: "copy",
            },
          ],
        },
      }),
    ).toThrow();
  });
});

function focusReference() {
  return {
    referenceIdentityHash: worldReferenceIdentityHash(referenceKey),
    referenceKey,
    productId: "product-1",
    displayName: "2号车",
    referenceType: "vehicle",
    sourceGroundingId: "grounding-1",
    sourceResultHash: sha,
    sourceWorldVersion: 7,
    validUntil: "2026-08-29T01:00:00.000Z",
    revalidationRequired: false,
    status: "VALID" as const,
    lastUsedAt: "2026-08-29T00:00:00.000Z",
  };
}

function request() {
  return {
    schemaVersion: "1.0" as const,
    requestId: "request-1",
    operation: "EXECUTE_WORLD_QUERY" as const,
    source: {
      conversationRef: "thread-1",
      messageId: "message-2",
      originalText: "它现在呢？",
      originalTextSha256: sha,
      locale: "zh-CN",
      createdAt: "2026-08-29T00:01:00.000Z",
    },
    requestedProducts: ["WORLD_EVIDENCE" as const],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true as const,
      deadlineMs: 30_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 5,
      maxResultBytes: 1_048_576,
      allowApproximation: false,
    },
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(root + path, "utf8")) as unknown;
}

function sha256File(path: string): string {
  return createHash("sha256")
    .update(readFileSync(root + path))
    .digest("hex");
}
