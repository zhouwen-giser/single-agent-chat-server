import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

const root = fileURLToPath(new URL("../", import.meta.url));

interface SourceLock {
  northbound: {
    contractVersion: string;
    operations: string[];
    lockedArtifactCount: number;
  };
  repositories: {
    wsgs: {
      candidateDecision: string;
      markers: Record<string, boolean>;
    };
  };
  immutableMigrations: Record<string, string>;
}

interface WsgsLock {
  contractVersion: string;
  artifacts: Record<string, string>;
}

interface SdarLock {
  status: string;
  dataPartMediaType: string | null;
  schemaSha256: string | null;
  handlerEvidence: string | null;
  validatorEvidence: string | null;
  realE2eEvidence: string | null;
  requiredRuntimeError: string;
  fallback: {
    dropDataPart: boolean;
    convertToText: boolean;
    modifySdar: boolean;
  };
}

const sourceLock = readJson<SourceLock>("reports/v0.4/S00-source-lock.json");
const wsgsLock = readJson<WsgsLock>(
  "dependencies/wsgs-northbound-contract-lock.json",
);
const sdarLock = readJson<SdarLock>(
  "dependencies/sdar-grounding-extension-compatibility-lock.json",
);

describe("SACS v0.4 S00 source and compatibility locks", () => {
  it("freezes the four allowed WSGS northbound operations", () => {
    expect(sourceLock.northbound).toEqual({
      contractVersion: "sacs-wsgs-grounding/1.0",
      operations: [
        "GROUND_REFERENCES",
        "COMPILE_WORLD_QUERY",
        "EXECUTE_WORLD_QUERY",
        "VALIDATE_REFERENCES",
      ],
      lockedArtifactCount: 32,
    });
  });

  it("locks every frozen WSGS artifact to a SHA-256 digest", () => {
    expect(wsgsLock.contractVersion).toBe("sacs-wsgs-grounding/1.0");
    expect(Object.keys(wsgsLock.artifacts)).toHaveLength(32);
    for (const digest of Object.values(wsgsLock.artifacts)) {
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });

  it("records WSGS readiness claims as blocked without inference", () => {
    expect(sourceLock.repositories.wsgs.candidateDecision).toBe("BLOCKED");
    expect(sourceLock.repositories.wsgs.markers).toEqual({
      GOWM_0_6_3_CONTRACT_LOCKED: true,
      EXECUTABLE_GROUNDING_PIPELINE_READY: false,
      REFERENCE_GROUNDING_READY: false,
      SEMANTIC_QUERY_COMPILER_READY: false,
      GOWM_REAL_E2E_READY: false,
      WSGS_V0_2_STABLE_CANDIDATE_COMPLETE: false,
    });
  });

  it("fails closed when the SDAR grounding extension is unavailable", () => {
    expect(sdarLock.status).toBe("UNAVAILABLE");
    expect(sdarLock.dataPartMediaType).toBeNull();
    expect(sdarLock.schemaSha256).toBeNull();
    expect(sdarLock.handlerEvidence).toBeNull();
    expect(sdarLock.validatorEvidence).toBeNull();
    expect(sdarLock.realE2eEvidence).toBeNull();
    expect(sdarLock.requiredRuntimeError).toBe(
      "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
    expect(sdarLock.fallback).toEqual({
      dropDataPart: false,
      convertToText: false,
      modifySdar: false,
    });
  });

  it("freezes existing migrations 0001 through 0009", () => {
    expect(Object.keys(sourceLock.immutableMigrations)).toEqual([
      "migrations/0001_initial_persistence.sql",
      "migrations/0002_events_and_recovery.sql",
      "migrations/0003_submission_lease.sql",
      "migrations/0004_interaction_gateway.sql",
      "migrations/0005_interrupt_resume.sql",
      "migrations/0006_durable_agui_runs.sql",
      "migrations/0007_conversation_history.sql",
      "migrations/0008_multi_task_directory.sql",
      "migrations/0009_request_result_union.sql",
    ]);
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(`${root}${path}`, "utf8")) as T;
}
