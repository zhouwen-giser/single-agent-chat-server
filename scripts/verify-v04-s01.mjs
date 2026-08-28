import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const sourceLock = await readJson("reports/v0.4/S00-source-lock.json");
const sdarLock = await readJson(
  "dependencies/sdar-grounding-extension-compatibility-lock.json",
);
const turnPlan = await readJson("contracts/v0.4/turn-plan.schema.json");
const requestPlan = await readJson(
  "contracts/v0.4/grounding-request-plan.schema.json",
);
const bundle = await readJson(
  "contracts/v0.4/operational-grounding-bundle.schema.json",
);
const hybrid = await readJson(
  "contracts/v0.4/hybrid-plan-reality-compare.schema.json",
);

for (const field of [
  "operation",
  "requestedProducts",
  "provider",
  "referenceKey",
  "productId",
]) {
  assert(
    turnPlan.properties[field] === undefined,
    `TurnPlan must not expose model-selected ${field}`,
  );
}

assert(
  JSON.stringify(requestPlan.properties.operation.enum) ===
    JSON.stringify(sourceLock.northbound.operations),
  "deterministic request plan operations drifted from the WSGS lock",
);
assert(
  requestPlan.properties.plannedBy.const === "SACS_DETERMINISTIC_V1",
  "GroundingRequestPlan must identify deterministic ownership",
);
for (const field of [
  "identity",
  "actor",
  "dataScope",
  "datasetScope",
  "permissions",
  "chatHistory",
]) {
  assert(
    requestPlan.properties[field] === undefined,
    `GroundingRequestPlan must not carry ${field}`,
  );
}

assert(
  bundle.properties.purpose.const === "SDAR_OPERATION",
  "operational bundle purpose drifted",
);
assert(
  bundle.properties.ambiguityPolicy.properties.autoAcceptSuggestedUnique
    .const === false,
  "suggested-unique auto-acceptance must remain disabled",
);
assert(
  bundle.properties.references.items.properties.revalidationRequired.const ===
    false,
  "operational references must be revalidated before bundle creation",
);
assert(
  bundle.properties.references.items.properties.validationStatus.const ===
    "VALIDATED",
  "operational references must be validated",
);
assert(
  bundle.properties.rawTextFallback === undefined,
  "raw-text operational fallback is forbidden",
);

assert(hybrid.properties.plan.properties.authority.const === "SDAR", "SDAR");
assert(
  hybrid.properties.reality.properties.authority.const === "WSGS_GOWM",
  "WSGS/GOWM",
);
assert(
  hybrid.properties.composition.properties.authority.const === "SACS" &&
    hybrid.properties.composition.properties.relationship.const ===
      "COMPARE_ONLY",
  "SACS composition authority drifted",
);

const development = sourceLock.repositories.wsgs.developmentReadiness;
assert(
  development.verification === "VERIFIED_DEVELOPMENT_READY" &&
    development.productionQualified === false,
  "WSGS development-only classification drifted",
);
assert(
  sdarLock.status === "UNAVAILABLE" &&
    sdarLock.requiredRuntimeError === "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
  "SDAR extension must remain fail-closed",
);

process.stdout.write(
  `${JSON.stringify({
    phase: "S01",
    status: "PASS_INTERNAL_CONTRACTS_WITH_EXTERNAL_BLOCKERS",
    turnPlanModelAuthority: "BOUNDED",
    wsgsPlannerAuthority: "DETERMINISTIC_CODE_ONLY",
    wsgsOperationsLocked: sourceLock.northbound.operations.length,
    operationalBundle: "VALIDATED_REFERENCES_ONLY",
    suggestedUniqueAutoAccept: false,
    authorityFusion: {
      plan: "SDAR",
      reality: "WSGS_GOWM",
      composition: "SACS_COMPARE_ONLY",
    },
    wsgsDevelopmentReadiness: development.verification,
    wsgsProductionQualified: development.productionQualified,
    sdarGroundingExtension: sdarLock.status,
    stableCandidateEligible: false,
    requiredDisposition: "SACS_V0_4_STABLE_CANDIDATE_BLOCKED",
  })}\n`,
);

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
