import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { verifyOrGenerateWsgsGeospatialConsumerLock } from "./generate-v04-s14-wsgs-geospatial.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = verifyOrGenerateWsgsGeospatialConsumerLock({ check: true });

assertEqual(lock.provenance, "TASK_PACKAGE_PROVISIONAL", "provenance");
assertEqual(lock.status, "BLOCKED", "status");
assertEqual(
  lock.geospatialProfile.transportMode,
  "UNRESOLVED",
  "transportMode",
);
assertEqual(lock.currentness.mode, "UNSUPPORTED", "currentness mode");
if (lock.geospatialProfile.requestedProducts.length !== 0) {
  throw new Error("BLOCKED consumer lock must not request geospatial products");
}

const adapter = readFileSync(
  `${root}packages/wsgs-http-adapter/src/index.ts`,
  "utf8",
);
for (const forbidden of [
  'version: z.literal("0.1.0")',
  'softwareVersion: z.literal("0.4.0")',
  'commit: z.literal("db575f79c874a69f65a2043a7e463338524b713d")',
  "sourcePackageArtifacts: z.literal(33)",
]) {
  if (adapter.includes(forbidden)) {
    throw new Error(
      `production adapter retains obsolete capability literal: ${forbidden}`,
    );
  }
}

console.log("SACS_V0_4_S14_WSGS_GEOSPATIAL_INTAKE_BLOCKED");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${expected}; received ${String(actual)}`);
  }
}
