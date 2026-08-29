import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  canonicalJson,
  hashCanonicalJson,
  hashRendererPolicy,
  hashWorldExplanation,
  verifyWorldExplanationHash,
} from "../packages/world-explanation-contract/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import { assemblyInput, sha } from "./world-explanation-fixtures.js";

describe("S15 canonical world explanation hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const left = { z: 1, nested: { b: true, a: "value" }, list: [1, 2] };
    const right = { list: [1, 2], nested: { a: "value", b: true }, z: 1 };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
    expect(hashCanonicalJson({ ...left, list: [2, 1] })).not.toBe(
      hashCanonicalJson(left),
    );
  });

  it("excludes only the self-hash field", () => {
    const explanation = assembleWorldExplanation(assemblyInput());
    expect(hashWorldExplanation(explanation)).toBe(explanation.explanationHash);
    expect(
      hashWorldExplanation({ ...explanation, explanationHash: sha("f") }),
    ).toBe(explanation.explanationHash);
    expect(
      hashWorldExplanation({
        ...explanation,
        renderedText: explanation.renderedText + " changed",
      }),
    ).not.toBe(explanation.explanationHash);
    expect(verifyWorldExplanationHash(explanation)).toEqual(explanation);
  });

  it("rejects non-JSON, non-finite, cyclic, sparse, and unsafe-key inputs", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow("non-JSON");
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(
      "non-finite",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cyclic");
    const sparse = new Array<unknown>(2);
    sparse[1] = "present";
    expect(() => canonicalJson(sparse)).toThrow("sparse");
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    expect(() => canonicalJson(unsafe)).toThrow("unsafe object key");
  });

  it("hashes the strict renderer policy deterministically", () => {
    const expected = hashRendererPolicy(
      DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
    );
    expect(
      hashRendererPolicy({
        ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
        rules: {
          ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.rules,
        },
      }),
    ).toBe(expected);
  });

  it("gives identical explanations for identical input and policy", () => {
    expect(assembleWorldExplanation(assemblyInput())).toEqual(
      assembleWorldExplanation(assemblyInput()),
    );
  });
});
