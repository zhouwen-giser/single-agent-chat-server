import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

import {
  assertWsgsCapabilitiesAgainstConsumerLock,
  assertWsgsGeospatialFindingsAuthorized,
  calculateConsumerLockHash,
  defaultWsgsGeospatialConsumerLock,
  parseWsgsGeospatialConsumerLock,
  wsgsGeospatialFindingsSchema,
} from "../packages/wsgs-geospatial-consumer/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;

describe("S14 WSGS geospatial consumer intake", () => {
  it("validates the generated lock with JSON Schema and strict Zod", () => {
    const schema = readJson<AnySchema>(
      "contracts/generated/wsgs-geospatial/wsgs-geospatial-consumer-lock.schema.json",
    );
    const lock = readJson("dependencies/wsgs-geospatial-consumer-lock.json");
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      strictTypes: false,
    }).compile(schema);

    expect(validate(lock)).toBe(true);
    expect(parseWsgsGeospatialConsumerLock(lock)).toEqual(lock);
    expect(calculateConsumerLockHash(lock)).toBe(
      (lock as { consumerLockHash: string }).consumerLockHash,
    );
  });

  it("keeps task-package observations blocked and product-free", () => {
    expect(defaultWsgsGeospatialConsumerLock).toMatchObject({
      provenance: "TASK_PACKAGE_PROVISIONAL",
      status: "BLOCKED",
      blocker: {
        code: "AUTHORITATIVE_WSGS_GEOSPATIAL_HANDOFF_MISSING",
      },
      geospatialProfile: {
        transportMode: "UNRESOLVED",
        requestedProducts: [],
      },
      currentness: { mode: "UNSUPPORTED" },
    });
  });

  it("rejects extra fields, provisional READY claims, and tampered hashes", () => {
    const extra = {
      ...defaultWsgsGeospatialConsumerLock,
      inferredAuthority: true,
    };
    expect(() => parseWsgsGeospatialConsumerLock(extra)).toThrow();

    const promoted = structuredClone(defaultWsgsGeospatialConsumerLock);
    Object.assign(promoted, {
      status: "READY",
      consumerLockHash: calculateConsumerLockHash({
        ...promoted,
        status: "READY",
      }),
    });
    expect(() => parseWsgsGeospatialConsumerLock(promoted)).toThrow();

    expect(() =>
      parseWsgsGeospatialConsumerLock({
        ...defaultWsgsGeospatialConsumerLock,
        consumerLockHash: sha,
      }),
    ).toThrow();
  });

  it("validates a synthetic authoritative lock against generic capabilities", () => {
    const lock = readyLock("REQUESTED_PRODUCTS", ["WORLD_EVIDENCE"]);
    const capabilities = {
      contractVersion: "sacs-wsgs-grounding/1.0",
      supportedProducts: ["WORLD_EVIDENCE"],
      requiredCapabilitiesReady: true,
      gowmContract: { commit: lock.sources.gowmSha },
    };
    expect(
      assertWsgsCapabilitiesAgainstConsumerLock(capabilities, lock),
    ).toEqual(lock);
    expect(() =>
      assertWsgsCapabilitiesAgainstConsumerLock(
        { ...capabilities, supportedProducts: [] },
        lock,
      ),
    ).toThrow("WSGS_GEOSPATIAL_REQUESTED_PRODUCT_UNAVAILABLE");
  });

  it("parses a strict result extension but authorizes it only for READY RESULT_EXTENSION", () => {
    const findings = wsgsGeospatialFindingsSchema.parse({
      profile: "sacs-wsgs-geospatial-findings/1.0",
      profileSchemaHash: sha,
      findings: [],
      sourceProducts: [],
      gaps: [],
      findingSetHash: sha,
      sourceProductSetHash: sha,
    });
    expect(() =>
      assertWsgsGeospatialFindingsAuthorized(
        findings,
        defaultWsgsGeospatialConsumerLock,
      ),
    ).toThrow("WSGS_GEOSPATIAL_CONSUMER_LOCK_BLOCKED");
    expect(() =>
      wsgsGeospatialFindingsSchema.parse({
        ...findings,
        hiddenPayload: true,
      }),
    ).toThrow();
    expect(() =>
      assertWsgsGeospatialFindingsAuthorized(
        { ...findings, hiddenPayload: true },
        readyLock("RESULT_EXTENSION", []),
      ),
    ).toThrow();
    expect(() =>
      assertWsgsGeospatialFindingsAuthorized(
        findings,
        readyLock("RESULT_EXTENSION", []),
      ),
    ).not.toThrow();
  });
});

function readyLock(
  transportMode: "REQUESTED_PRODUCTS" | "RESULT_EXTENSION",
  requestedProducts: string[],
) {
  const value = {
    schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0",
    provenance: "AUTHORITATIVE_WSGS_HANDOFF",
    sources: {
      wsgsSha: "b".repeat(40),
      gowmSha: "c".repeat(40),
      gdpsSha: "d".repeat(40),
    },
    groundingContract: {
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultSchemaHash: sha,
      capabilitiesSchemaHash: sha,
    },
    geospatialProfile: {
      profile: "sacs-wsgs-geospatial-findings/1.0",
      transportMode,
      profileSchemaHash: sha,
      findingSchemaHash: sha,
      sourceProductSchemaHash: sha,
      gapSchemaHash: sha,
      requestedProducts,
    },
    currentness: { mode: "UNSUPPORTED" },
    status: "READY",
    consumerLockHash: sha,
  };
  value.consumerLockHash = calculateConsumerLockHash(value);
  return parseWsgsGeospatialConsumerLock(value);
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(`${root}${path}`, "utf8")) as T;
}
