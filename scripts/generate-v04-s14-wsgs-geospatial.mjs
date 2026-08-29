import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = `${root}contracts/upstream/wsgs-geospatial/provisional-consumer-intake.json`;
const schemaPath = `${root}contracts/generated/wsgs-geospatial/wsgs-geospatial-consumer-lock.schema.json`;
const outputPath = `${root}dependencies/wsgs-geospatial-consumer-lock.json`;

export function verifyOrGenerateWsgsGeospatialConsumerLock({
  check = false,
} = {}) {
  const source = readJson(sourcePath);
  const schema = readJson(schemaPath);
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  }).compile(schema);
  assertValid(validate, source, "provisional intake");

  const generated = {
    ...source,
    consumerLockHash: calculateConsumerLockHash(source),
  };
  assertValid(validate, generated, "generated consumer lock");
  const output = `${JSON.stringify(generated, null, 2)}\n`;

  if (check) {
    if (readFileSync(outputPath, "utf8") !== output) {
      throw new Error(
        "dependencies/wsgs-geospatial-consumer-lock.json is not generated from the provisional intake",
      );
    }
  } else {
    writeFileSync(outputPath, output, "utf8");
  }
  return generated;
}

export function calculateConsumerLockHash(value) {
  const copy = structuredClone(value);
  delete copy.consumerLockHash;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(copy)))
    .digest("hex")}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertValid(validate, value, label) {
  if (validate(value)) return;
  throw new Error(
    `${label} violates generated schema: ${JSON.stringify(validate.errors)}`,
  );
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  verifyOrGenerateWsgsGeospatialConsumerLock({ check });
  console.log(
    check
      ? "WSGS_GEOSPATIAL_CONSUMER_LOCK_GENERATED_CHECK_PASS"
      : "WSGS_GEOSPATIAL_CONSUMER_LOCK_GENERATED",
  );
}
