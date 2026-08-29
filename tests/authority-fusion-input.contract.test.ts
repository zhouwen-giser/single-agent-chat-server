import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  PlanRealityRequirementCompiler,
  SdarTaskObservationAssembler,
} from "../packages/authority-fusion/src/index.js";
import type { ConversationWorldFocus } from "../packages/conversation-world-focus/src/index.js";
import type { NormalizedTask } from "../packages/sdar-a2a-adapter/src/index.js";
import { parseWsgsGroundingContextCapsule } from "../packages/wsgs-http-adapter/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const observedAt = "2026-08-29T08:00:00.000Z";

describe("SACS v0.4 S09 Task fusion input contracts", () => {
  it("compiles the frozen TaskObservation and requirement schemas", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const name of [
      "common.schema.json",
      "sdar-task-observation-v2.schema.json",
      "plan-reality-requirements.schema.json",
    ]) {
      expect(() =>
        ajv.addSchema(readJson("contracts/v0.4/" + name), name),
      ).not.toThrow();
    }
  });

  it("emits hints and predicates accepted by the frozen WSGS capsule", () => {
    const task: NormalizedTask = {
      taskId: "task-1",
      contextId: "context-1",
      state: "COMPLETED",
      statusTimestamp: observedAt,
      publishedStructuredPlan: {
        predicates: [
          {
            schemaUri: "urn:gowm:v0.4:external-predicate",
            schemaHash: "sha256:" + "b".repeat(64),
            value: { relation: "within" },
          },
        ],
      },
      artifacts: [],
    };
    const observation = new SdarTaskObservationAssembler().assemble(task);
    const requirements = new PlanRealityRequirementCompiler().compile(
      observation,
      focus(),
    );
    expect(
      parseWsgsGroundingContextCapsule({
        knownWorldReferences: [],
        priorGroundings: [],
        mapSelections: [],
        externalCorrelationHints: requirements.correlationHints,
        externalPredicates: requirements.predicates,
      }),
    ).toMatchObject({
      externalCorrelationHints: { length: 2 },
      externalPredicates: { length: 1 },
    });
  });

  it("keeps the compiler read-only and outside the conversation model", () => {
    const source = readFileSync(
      root + "packages/authority-fusion/src/index.ts",
      "utf8",
    );
    expect(source).not.toMatch(
      /conversation-model|decideTurn|submitTaskStream|sendFollowUp|cancelTask/u,
    );
    expect(source).toContain('externalAuthority: "SDAR"');
    expect(source).toContain("publishedStructuredPlanSchema.safeParse");
  });
});

function readJson(path: string): object {
  return JSON.parse(readFileSync(root + path, "utf8")) as object;
}

function focus(): ConversationWorldFocus {
  return {
    schemaVersion: "1.0",
    principalId: "principal-1",
    threadId: "thread-1",
    revision: 0,
    references: [],
    updatedAt: observedAt,
  };
}
