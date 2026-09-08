import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Ajv2020,
  type ValidateFunction,
  type AnySchemaObject,
} from "ajv/dist/2020.js";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";
import {
  calculateConsumerLockHash,
  parseWsgsGeospatialConsumerLock,
} from "./index.js";

export const WSGS_V06_SOURCE_SHA = "565e52705bb7656d4623a04655001325ca61acd0";
export const WSGS_V06_RELEASE_HASH =
  "sha256:4fdd0c120136f65018345fd627420f5ebd429f99b656c9d9a92b0eacd0363b3a";
export const WSGS_V11_HEADERS = {
  "wsgs-contract-version": "sacs-wsgs-grounding/1.1",
  "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0",
} as const;
const digest = (value: Buffer) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
export class WsgsAuthoritativeContract {
  readonly provenance = "AUTHORITATIVE_WSGS_HANDOFF";
  readonly status = "READY";
  readonly schemas = new Map<
    string,
    { hash: string; validate: ValidateFunction }
  >();
  readonly consumerLock;
  private readonly validators = new Map<string, ValidateFunction>();
  constructor(root = resolve(process.cwd(), "dependencies/wsgs-v06")) {
    const bytes = readFileSync(resolve(root, "contract-release-lock.json"));
    if (digest(bytes) !== WSGS_V06_RELEASE_HASH)
      throw Error("WSGS_CONTRACT_SCHEMA_HASH_MISMATCH");
    const lock = JSON.parse(bytes.toString()) as {
      artifacts: Record<string, string>;
    };
    const legacy = JSON.parse(
      readFileSync(
        resolve(root, "baselines/sacs-wsgs-grounding-1.0-contract-lock.json"),
        "utf8",
      ),
    ) as { artifacts: Record<string, string> };
    const documents = new Map<
      string,
      { schema: AnySchemaObject; hash: string }
    >();
    for (const [path, hash] of Object.entries({
      ...lock.artifacts,
      ...Object.fromEntries(
        Object.entries(legacy.artifacts).map(([p, h]) => ["legacy/" + p, h]),
      ),
    })) {
      if (path.includes("..") || path.startsWith("/"))
        throw Error("WSGS_CONTRACT_SCHEMA_HASH_MISMATCH");
      const raw = readFileSync(resolve(root, path));
      if (digest(raw) !== hash)
        throw Error("WSGS_CONTRACT_SCHEMA_HASH_MISMATCH");
      if (path.endsWith(".schema.json") && !path.startsWith("compatibility/"))
        documents.set(path, {
          schema: JSON.parse(raw.toString()) as AnySchemaObject,
          hash,
        });
    }
    const ajv = new Ajv2020({ allErrors: false, strict: false });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (v: string) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
          v,
        ) && Number.isFinite(Date.parse(v)),
    });
    // The published URN identifiers contain relative file refs. Resolve those
    // against the locked artifact directory in memory, without changing raw bytes.
    const ids = new Map(
      [...documents].map(([p, { schema }]) => [
        schema.$id!,
        `https://wsgs-contract.invalid/${p}`,
      ]),
    );
    const relocate = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(relocate)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                k,
                (k === "$id" || k === "$ref") && typeof v === "string"
                  ? ids.get(v.split("#")[0]!)
                    ? ids.get(v.split("#")[0]!) +
                      (v.includes("#") ? "#" + v.split("#")[1] : "")
                    : v
                  : relocate(v),
              ]),
            )
          : value;
    for (const { schema } of documents.values())
      ajv.addSchema(relocate(schema) as AnySchemaObject);
    for (const [path, { schema, hash }] of documents) {
      const validate = ajv.getSchema(ids.get(schema.$id!)!)!;
      this.validators.set(path, validate);
      this.schemas.set(schema.$id!, { hash, validate });
    }
    // This GOWM reference is published in the byte-verified WSGS handoff, not a
    // claim about the running integration environment. No GDPS SHA is published.
    const example = JSON.parse(
      readFileSync(
        resolve(root, "examples/capabilities-response-v1.1.json"),
        "utf8",
      ),
    ) as { gowmContract: { commit: string } };
    const value = {
      schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0",
      provenance: this.provenance,
      status: this.status,
      sources: {
        wsgsSha: WSGS_V06_SOURCE_SHA,
        gowmSha: example.gowmContract.commit,
      },
      groundingContract: {
        contractVersion: "sacs-wsgs-grounding/1.1",
        resultSchemaHash:
          lock.artifacts["grounding-result-extension.schema.json"],
        capabilitiesSchemaHash:
          lock.artifacts["capabilities-response-v1.1.schema.json"],
      },
      geospatialProfile: {
        profile: "sacs-wsgs-geospatial-findings/1.0",
        transportMode: "RESULT_EXTENSION",
        profileSchemaHash: lock.artifacts["geospatial-findings.schema.json"],
        findingSchemaHash: lock.artifacts["world-finding.schema.json"],
        sourceProductSchemaHash: lock.artifacts["source-product.schema.json"],
        gapSchemaHash: lock.artifacts["typed-gap.schema.json"],
        requestedProducts: [],
      },
      currentness: { mode: "UNSUPPORTED" },
    };
    this.consumerLock = parseWsgsGeospatialConsumerLock({
      ...value,
      consumerLockHash: calculateConsumerLockHash(value),
    });
  }
  validate(
    kind: "capabilities" | "request" | "result" | "job" | "error",
    value: unknown,
  ): void {
    const path =
      kind === "capabilities"
        ? "capabilities-response-v1.1.schema.json"
        : kind === "result"
          ? "grounding-result-extension.schema.json"
          : `legacy/contracts/${kind === "error" ? "protocol-error" : "grounding-" + kind}.schema.json`;
    // Job envelope is legacy-stable; its embedded result uses the negotiated extension.
    if (
      kind === "job" &&
      value &&
      typeof value === "object" &&
      "result" in value
    ) {
      const { result, ...envelope } = value;
      this.validate("result", result);
      if (!this.validators.get(path)?.(envelope))
        throw Error("WSGS_CONTRACT_PAYLOAD_INVALID");
      return;
    }
    if (!this.validators.get(path)?.(value))
      throw Error("WSGS_CONTRACT_PAYLOAD_INVALID");
    if (kind === "result") {
      // WSGS resultHash includes its private run fingerprint. Preserve the published
      // receipt; only the geospatial set hashes have a northbound recomputable preimage.
      const result = value as Record<string, unknown>;
      const geo = result["geospatialFindings"] as
        Record<string, unknown> | undefined;
      if (
        geo &&
        (geo["profileSchemaHash"] !==
          this.consumerLock.geospatialProfile.profileSchemaHash ||
          hashCanonicalJson(geo["findings"]) !== geo["findingSetHash"] ||
          hashCanonicalJson(geo["sourceProducts"]) !==
            geo["sourceProductSetHash"])
      )
        throw Error("WSGS_CONTRACT_PAYLOAD_INVALID");
    }
  }
}
