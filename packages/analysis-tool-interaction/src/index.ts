import {
  ANALYSIS_MAX_PATCH_OPERATIONS,
  ANALYSIS_MAX_PUBLIC_ARGS_BYTES,
  analysisPatchOperationSchema,
  toolInteractionDescriptorSchema,
  type AnalysisPatchOperation,
  type ToolInteractionDescriptor,
} from "../../analysis-contract/src/index.js";
import { assertInlineGeoJsonBudget } from "../../analysis-map/src/index.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../../world-explanation-contract/src/index.js";

const forbiddenPathTerms = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "authority",
  "principal",
  "scope",
  "datascope",
  "provider",
  "security",
  "credential",
  "credentials",
  "token",
  "endpoint",
  "asset",
  "asseturi",
  "operationid",
  "operationkey",
  "executionargshash",
  "publiceditschemauri",
  "publiceditschemahash",
  "sourcefingerprint",
]);

export class AnalysisControlError extends Error {
  constructor(
    readonly statusCode: 403 | 409 | 410 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApplyPublicArgsPatchInput {
  readonly descriptor: ToolInteractionDescriptor;
  readonly patch: readonly AnalysisPatchOperation[];
  readonly expectedPublicArgsHash: string;
  readonly expectedEditSchemaHash: string;
  readonly now: string;
  readonly validatePublicArgs: (
    value: Readonly<Record<string, unknown>>,
  ) => boolean;
}

export interface AppliedPublicArgsPatch {
  readonly publicArgs: Readonly<Record<string, unknown>>;
  readonly publicArgsHash: string;
  readonly changedPaths: readonly string[];
}

export function validateAndApplyPublicArgsPatch(
  input: ApplyPublicArgsPatchInput,
): AppliedPublicArgsPatch {
  const descriptor = toolInteractionDescriptorSchema.parse(input.descriptor);
  if (descriptor.editPolicy === "NOT_EDITABLE") {
    throw new AnalysisControlError(
      422,
      "TOOL_NOT_EDITABLE",
      "Tool is read-only",
    );
  }
  if (
    descriptor.expiresAt !== undefined &&
    Date.parse(input.now) >= Date.parse(descriptor.expiresAt)
  ) {
    throw new AnalysisControlError(
      410,
      "TOOL_INTERACTION_EXPIRED",
      "Tool interaction has expired",
    );
  }
  if (descriptor.publicArgsHash !== input.expectedPublicArgsHash) {
    throw new AnalysisControlError(
      409,
      "PUBLIC_ARGS_CONFLICT",
      "Public arguments changed",
    );
  }
  if (descriptor.publicEditSchemaHash !== input.expectedEditSchemaHash) {
    throw new AnalysisControlError(
      409,
      "EDIT_SCHEMA_CONFLICT",
      "Edit schema changed",
    );
  }
  if (
    input.patch.length === 0 ||
    input.patch.length > ANALYSIS_MAX_PATCH_OPERATIONS
  ) {
    throw new AnalysisControlError(
      422,
      "PATCH_LIMIT_EXCEEDED",
      "Patch operation count is outside policy",
    );
  }
  const patch = input.patch.map((operation) =>
    analysisPatchOperationSchema.parse(operation),
  );
  for (const operation of patch) {
    assertEditablePath(operation.path, descriptor.editablePaths);
    if (
      operation.op !== "remove" &&
      !("value" in operation)
    ) {
      throw new AnalysisControlError(
        422,
        "PATCH_VALUE_REQUIRED",
        "Patch value is required",
      );
    }
  }

  // Zod records intentionally use a null-prototype object. Re-materialize the
  // validated JSON bytes so canonical hashing and patch traversal use an
  // ordinary data object without inheriting application prototypes.
  const publicArgs = JSON.parse(canonicalJson(descriptor.publicArgs)) as Record<
    string,
    unknown
  >;
  for (const operation of patch) applyOperation(publicArgs, operation);
  if (
    Buffer.byteLength(canonicalJson(publicArgs), "utf8") >
    ANALYSIS_MAX_PUBLIC_ARGS_BYTES
  ) {
    throw new AnalysisControlError(
      422,
      "PUBLIC_ARGS_LIMIT_EXCEEDED",
      "Patched public arguments are too large",
    );
  }
  assertGeometryBudgets(publicArgs);
  if (!input.validatePublicArgs(publicArgs)) {
    throw new AnalysisControlError(
      422,
      "PUBLIC_ARGS_SCHEMA_INVALID",
      "Patched public arguments fail the public edit schema",
    );
  }
  return {
    publicArgs,
    publicArgsHash: hashCanonicalJson(publicArgs),
    changedPaths: [...new Set(patch.map(({ path }) => path))].sort(),
  };
}

export function assertEditablePath(
  path: string,
  editablePaths: readonly string[],
): void {
  const segments = decodePointer(path);
  if (
    segments.some((segment) => forbiddenPathTerms.has(segment.toLowerCase()))
  ) {
    throw new AnalysisControlError(
      403,
      "ANALYSIS_SCOPE_FORBIDDEN",
      "The path targets an authority-controlled field",
    );
  }
  const allowed = editablePaths.some(
    (candidate) => path === candidate || path.startsWith(candidate + "/"),
  );
  if (!allowed) {
    throw new AnalysisControlError(
      422,
      "EDIT_PATH_NOT_ALLOWED",
      "The path is outside editable public arguments",
    );
  }
}

function applyOperation(
  root: Record<string, unknown>,
  operation: AnalysisPatchOperation,
): void {
  const segments = decodePointer(operation.path);
  if (segments.length === 0) {
    throw new AnalysisControlError(
      422,
      "EDIT_PATH_NOT_ALLOWED",
      "Root replacement is forbidden",
    );
  }
  const leaf = segments.at(-1) as string;
  const parent = resolveParent(root, segments.slice(0, -1));
  if (operation.op === "test") {
    const current = readMember(parent, leaf);
    if (canonicalJson(current) !== canonicalJson(operation.value)) {
      throw new AnalysisControlError(
        409,
        "PATCH_TEST_FAILED",
        "Patch test precondition failed",
      );
    }
    return;
  }
  if (operation.op === "remove") {
    removeMember(parent, leaf);
    return;
  }
  if (operation.op === "replace") {
    readMember(parent, leaf);
    writeMember(parent, leaf, structuredClone(operation.value), false);
    return;
  }
  writeMember(parent, leaf, structuredClone(operation.value), true);
}

function resolveParent(
  root: Record<string, unknown>,
  segments: readonly string[],
): Record<string, unknown> | unknown[] {
  let current: unknown = root;
  for (const segment of segments) {
    current = readMember(asContainer(current), segment);
  }
  return asContainer(current);
}

function readMember(
  parent: Record<string, unknown> | unknown[],
  key: string,
): unknown {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false);
    if (index >= parent.length) throw invalidPath();
    return parent[index];
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw invalidPath();
  return parent[key];
}

function writeMember(
  parent: Record<string, unknown> | unknown[],
  key: string,
  value: unknown,
  add: boolean,
): void {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, add);
    if (add) parent.splice(index, 0, value);
    else parent[index] = value;
    return;
  }
  parent[key] = value;
}

function removeMember(
  parent: Record<string, unknown> | unknown[],
  key: string,
): void {
  readMember(parent, key);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
}

function asContainer(value: unknown): Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== "object") throw invalidPath();
  return value as Record<string, unknown> | unknown[];
}

function arrayIndex(key: string, length: number, add: boolean): number {
  if (add && key === "-") return length;
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) throw invalidPath();
  const index = Number(key);
  if (
    !Number.isSafeInteger(index) ||
    index > length ||
    (!add && index === length)
  ) {
    throw invalidPath();
  }
  return index;
}

function decodePointer(path: string): readonly string[] {
  if (!path.startsWith("/")) throw invalidPath();
  return path
    .slice(1)
    .split("/")
    .map((segment) => {
      if (/~(?:[^01]|$)/u.test(segment)) throw invalidPath();
      return segment.replaceAll("~1", "/").replaceAll("~0", "~");
    });
}

function invalidPath(): AnalysisControlError {
  return new AnalysisControlError(
    422,
    "EDIT_PATH_INVALID",
    "Patch path does not resolve",
  );
}

function assertGeometryBudgets(value: unknown, depth = 0): void {
  if (depth > 64) {
    throw new AnalysisControlError(
      422,
      "PUBLIC_ARGS_NESTING_EXCEEDED",
      "Public arguments are too deeply nested",
    );
  }
  if (value === null || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      record.type === "Feature" ||
      record.type === "FeatureCollection" ||
      record.type === "Point" ||
      record.type === "LineString" ||
      record.type === "Polygon" ||
      record.type === "MultiPolygon"
    ) {
      try {
        assertInlineGeoJsonBudget(record);
      } catch {
        throw new AnalysisControlError(
          422,
          "GEOMETRY_BUDGET_EXCEEDED",
          "Geometry exceeds structural limits",
        );
      }
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertGeometryBudgets(child, depth + 1);
  }
}
