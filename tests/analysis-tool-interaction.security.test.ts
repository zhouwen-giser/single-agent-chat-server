import { describe, expect, it } from "@jest/globals";

import type { ToolInteractionDescriptor } from "../packages/analysis-contract/src/index.js";
import {
  AnalysisControlError,
  validateAndApplyPublicArgsPatch,
} from "../packages/analysis-tool-interaction/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";

const now = "2026-08-30T00:00:00.000Z";
const schemaHash = `sha256:${"a".repeat(64)}`;

describe("v0.5 public tool edit boundary", () => {
  it("applies bounded allowlisted JSON Patch and returns a new public hash", () => {
    const descriptor = toolDescriptor();
    const result = validateAndApplyPublicArgsPatch({
      descriptor,
      patch: [
        { op: "test", path: "/radiusMeters", value: 1_000 },
        { op: "replace", path: "/radiusMeters", value: 600 },
      ],
      expectedPublicArgsHash: descriptor.publicArgsHash,
      expectedEditSchemaHash: descriptor.publicEditSchemaHash,
      now,
      validatePublicArgs: (value) =>
        typeof value.radiusMeters === "number" && value.radiusMeters > 0,
    });
    expect(result.publicArgs.radiusMeters).toBe(600);
    expect(result.publicArgsHash).toBe(hashCanonicalJson(result.publicArgs));
    expect(descriptor.publicArgs.radiusMeters).toBe(1_000);
  });

  it.each([
    "/provider",
    "/selector/authority",
    "/scope/tenant",
    "/__proto__/polluted",
    "/endpoint",
    "/assetUri",
  ])("rejects authority-controlled path %s", (path) => {
    const descriptor = toolDescriptor({ editablePaths: [path] });
    expectControlError(
      () =>
        validateAndApplyPublicArgsPatch({
          descriptor,
          patch: [{ op: "add", path, value: "forbidden" }],
          expectedPublicArgsHash: descriptor.publicArgsHash,
          expectedEditSchemaHash: descriptor.publicEditSchemaHash,
          now,
          validatePublicArgs: () => true,
        }),
      403,
      "ANALYSIS_SCOPE_FORBIDDEN",
    );
  });

  it("rejects non-allowlisted paths", () => {
    const descriptor = toolDescriptor();
    expectControlError(
      () =>
        validateAndApplyPublicArgsPatch({
          descriptor,
          patch: [{ op: "replace", path: "/ranges", value: [] }],
          expectedPublicArgsHash: descriptor.publicArgsHash,
          expectedEditSchemaHash: descriptor.publicEditSchemaHash,
          now,
          validatePublicArgs: () => true,
        }),
      422,
      "EDIT_PATH_NOT_ALLOWED",
    );
  });

  it("rejects stale public args, stale schemas, expiration, and failed tests", () => {
    const descriptor = toolDescriptor();
    expectControlError(
      () => apply(descriptor, { publicArgsHash: `sha256:${"b".repeat(64)}` }),
      409,
      "PUBLIC_ARGS_CONFLICT",
    );
    expectControlError(
      () => apply(descriptor, { schemaHash: `sha256:${"b".repeat(64)}` }),
      409,
      "EDIT_SCHEMA_CONFLICT",
    );
    expectControlError(
      () => apply(toolDescriptor({ expiresAt: "2026-08-29T23:59:59.000Z" })),
      410,
      "TOOL_INTERACTION_EXPIRED",
    );
    expectControlError(
      () =>
        apply(descriptor, {
          patch: [{ op: "test", path: "/radiusMeters", value: 999 }],
        }),
      409,
      "PATCH_TEST_FAILED",
    );
    expectControlError(
      () =>
        apply(descriptor, {
          patch: [{ op: "test", path: "/radiusMeters" }],
        }),
      422,
      "PATCH_VALUE_REQUIRED",
    );
  });

  it("requires post-patch public JSON Schema validation", () => {
    const descriptor = toolDescriptor();
    expectControlError(
      () =>
        validateAndApplyPublicArgsPatch({
          descriptor,
          patch: [{ op: "replace", path: "/radiusMeters", value: -1 }],
          expectedPublicArgsHash: descriptor.publicArgsHash,
          expectedEditSchemaHash: descriptor.publicEditSchemaHash,
          now,
          validatePublicArgs: () => false,
        }),
      422,
      "PUBLIC_ARGS_SCHEMA_INVALID",
    );
  });

  it("does not expose execution arguments as editable public arguments", () => {
    const descriptor = toolDescriptor();
    expect(descriptor.executionArgsHash).not.toBe(descriptor.publicArgsHash);
    expect(JSON.stringify(descriptor.publicArgs)).not.toContain("secret");
  });
});

function toolDescriptor(
  override: Partial<ToolInteractionDescriptor> = {},
): ToolInteractionDescriptor {
  const publicArgs = { radiusMeters: 1_000 };
  return {
    schemaVersion: "sacs-wsgs-tool-interaction/1.0",
    toolCallId: "tool-1",
    nodeId: "node-1",
    operationKey: "nearby.find@1.0",
    executionArgsHash: `sha256:${"f".repeat(64)}`,
    publicArgs,
    publicArgsHash: hashCanonicalJson(publicArgs),
    publicEditSchemaUri: "urn:wsgs:public-edit:nearby:1.0",
    publicEditSchemaHash: schemaHash,
    editablePaths: ["/radiusMeters"],
    editorHints: [
      {
        path: "/radiusMeters",
        editor: "MAP_RADIUS",
        unit: "m",
        minimum: 1,
        maximum: 10_000,
      },
    ],
    editSemantics: "CHANGE_CONSTRAINT",
    editPolicy: "SUGGEST_NEXT_REVISION",
    expiresAt: "2026-08-30T01:00:00.000Z",
    ...override,
  };
}

function apply(
  descriptor: ToolInteractionDescriptor,
  override: {
    readonly publicArgsHash?: string;
    readonly schemaHash?: string;
    readonly patch?: readonly {
      readonly op: "add" | "remove" | "replace" | "test";
      readonly path: string;
      readonly value?: unknown;
    }[];
  } = {},
) {
  return validateAndApplyPublicArgsPatch({
    descriptor,
    patch: override.patch ?? [
      { op: "replace", path: "/radiusMeters", value: 600 },
    ],
    expectedPublicArgsHash:
      override.publicArgsHash ?? descriptor.publicArgsHash,
    expectedEditSchemaHash:
      override.schemaHash ?? descriptor.publicEditSchemaHash,
    now,
    validatePublicArgs: () => true,
  });
}

function expectControlError(
  run: () => unknown,
  statusCode: number,
  code: string,
): void {
  try {
    run();
    throw new Error("Expected AnalysisControlError");
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisControlError);
    expect((error as AnalysisControlError).statusCode).toBe(statusCode);
    expect((error as AnalysisControlError).code).toBe(code);
  }
}
