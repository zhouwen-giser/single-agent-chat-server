import type { JsonObject } from "../../world-explanation-contract/src/index.js";
import { WsgsAuthoritativeContract } from "./authoritative.js";

/** Reject invalid/bounded JSON before recursive authoritative schema validation. */
export function assertBoundedAnalysisJson(
  value: unknown,
  maxBytes = 4 * 1024 * 1024,
): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 100_000 || depth > 32)
      throw Error("WSGS_RESULT_PAYLOAD_LIMIT_EXCEEDED");
    if (v && typeof v === "object") {
      if (seen.has(v)) throw Error("WSGS_RESULT_PAYLOAD_INVALID");
      seen.add(v);
      for (const [key, child] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw Error("WSGS_RESULT_PAYLOAD_INVALID");
        visit(child, depth + 1);
      }
      seen.delete(v);
    }
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
    throw Error("WSGS_RESULT_PAYLOAD_LIMIT_EXCEEDED");
}
/** Generic evidence is decoded only inside the authoritative consumer boundary. */
export class WsgsResultSchemaRegistry {
  constructor(
    private readonly authority = new WsgsAuthoritativeContract(),
    private readonly maxBytes = 262144,
  ) {}
  parse(
    schemaUri: string,
    schemaHash: string,
    value: unknown,
  ): JsonObject | undefined {
    assertBoundedAnalysisJson(value, this.maxBytes);
    const binding = this.authority.schemas.get(schemaUri);
    if (
      schemaUri !== "urn:wsgs:v0.2.1:sacs-geospatial:world-finding:1.0" ||
      !binding ||
      binding.hash !== schemaHash ||
      !binding.validate(value)
    )
      return undefined;
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  }
  resolve(evidence: {
    payloadSchemaUri: string;
    payloadSchemaHash: string;
    safePayload?: unknown;
  }): { finding?: JsonObject; unsupported: boolean } {
    if (evidence.safePayload === undefined) return { unsupported: false };
    const finding = this.parse(
      evidence.payloadSchemaUri,
      evidence.payloadSchemaHash,
      evidence.safePayload,
    );
    return finding ? { finding, unsupported: false } : { unsupported: true };
  }
}
