import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicValidator,
  contractVersion,
  resultProfile,
} from "../../../dependencies/wsgs-world-analysis-v1/public/validator.mjs";
import type { GroundingRequest12 } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/grounding-request-1.2.js";
import type { GroundingResult12 } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/grounding-result-1.2.js";
import type { GroundingJob12 } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/grounding-job-1.2.js";
import type { GroundingCapabilities12 } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/capabilities-1.2.js";
import { assertBoundedAnalysisJson } from "./analysis-payload.js";

export {
  canonicalJson as publicCanonicalJson,
  canonicalHash as publicCanonicalHash,
  findingSetHash as publicFindingSetHash,
  resultHash as publicResultHash,
} from "../../../dependencies/wsgs-world-analysis-v1/public/validator.mjs";
export type {
  GroundingRequest12,
  GroundingResult12,
  GroundingJob12,
  GroundingCapabilities12,
};
export type { WorldAnalysisFindings } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/world-analysis-findings.js";
export type { AnalysisSelection } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/analysis-selection.js";
export type { Choice } from "../../../dependencies/wsgs-world-analysis-v1/public/generated/choice.js";
export const WSGS_V12_HEADERS = {
  "wsgs-contract-version": contractVersion,
  "wsgs-result-profile": resultProfile,
} as const;
export const WSGS_FROZEN_RELEASE_HASH =
  "sha256:45f027673834f3d9e654a889eea25eaf81522f594af8dddf6939b91a0dd4c41a";
export const WSGS_FROZEN_HANDOFF_SHA =
  "75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5";
const digest = (bytes: Buffer) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

/** Exact-byte lock verification. Provenance is not a runtime upstream HEAD gate. */
export function verifyFrozenWorldAnalysis(
  root = resolve(process.cwd(), "dependencies/wsgs-world-analysis-v1/public"),
): number {
  const bytes = readFileSync(resolve(root, "contract-release-lock.json"));
  if (digest(bytes) !== WSGS_FROZEN_RELEASE_HASH)
    throw Error("WSGS_FROZEN_CONTRACT_DRIFT");
  const lock = JSON.parse(bytes.toString()) as {
    artifacts: Record<string, string>;
  };
  for (const [path, hash] of Object.entries(lock.artifacts)) {
    if (
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      digest(readFileSync(resolve(root, path))) !== hash
    )
      throw Error("WSGS_FROZEN_CONTRACT_DRIFT");
  }
  return Object.keys(lock.artifacts).length;
}
export class WsgsPublicContractError extends Error {
  readonly code = "WSGS_PUBLIC_CONTRACT_INVALID";
  constructor(readonly reasonCode: string) {
    super("WSGS_PUBLIC_CONTRACT_INVALID:" + reasonCode);
  }
}
interface PublicKinds {
  request: GroundingRequest12;
  result: GroundingResult12;
  job: GroundingJob12;
  capabilities: GroundingCapabilities12;
}
export class FrozenWorldAnalysisContract {
  private readonly validator: ReturnType<typeof createPublicValidator>;
  constructor() {
    verifyFrozenWorldAnalysis();
    this.validator = createPublicValidator();
  }
  parse<K extends keyof PublicKinds>(
    kind: K,
    value: unknown,
    maxResultBytes?: number,
  ): PublicKinds[K] {
    // Bound structure before the frozen validator's recursive semantic checks.
    assertBoundedAnalysisJson(
      value,
      kind === "request"
        ? 4 * 1024 * 1024
        : kind === "job"
          ? 1048576 + 16384
          : 1048576,
    );
    const checked = this.validator(
      kind,
      value,
      maxResultBytes === undefined ? undefined : { maxResultBytes },
    );
    if (!checked.valid)
      throw new WsgsPublicContractError(
        checked.errors[0]?.code ?? "INVALID_RESPONSE",
      );
    return value as PublicKinds[K];
  }
}
