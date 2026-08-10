import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sdarRepository = required("P12_SDAR_REPOSITORY");
const expectedSdarSha = required("P12_EXPECTED_SDAR_SHA");
const sdarBaseUrl = requiredUrl("P12_SDAR_A2A_BASE_URL");

const [{ stdout: sha }, { stdout: dirty }, sdarPackageRaw, sacsPackageRaw] =
  await Promise.all([
    execFileAsync("git", ["-C", sdarRepository, "rev-parse", "HEAD"]),
    execFileAsync("git", ["-C", sdarRepository, "status", "--porcelain"]),
    readFile(new URL("package.json", directoryUrl(sdarRepository)), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
assert.equal(sha.trim(), expectedSdarSha);
assert.equal(dirty.trim(), "");
const sdarPackage = JSON.parse(sdarPackageRaw);
const sacsPackage = JSON.parse(sacsPackageRaw);
assert.equal(sacsPackage.dependencies?.["@a2a-js/sdk"], "1.0.0-beta.0");

const cardResponse = await fetch(
  new URL("/.well-known/agent-card.json", sdarBaseUrl),
  { signal: AbortSignal.timeout(10_000) },
);
const cardBytes = Buffer.from(await cardResponse.arrayBuffer());
assert.equal(cardResponse.status, 200);
const card = JSON.parse(cardBytes.toString("utf8"));
assert.equal(card.capabilities?.streaming, true);
const selected = card.supportedInterfaces?.find(
  (candidate) =>
    candidate.protocolBinding === "HTTP+JSON" &&
    candidate.protocolVersion === "1.0",
);
assert.ok(selected);

process.stdout.write(
  `${JSON.stringify({
    status: "PASSED",
    sdarRepository,
    sdarSha: sha.trim(),
    sdarClean: true,
    sdarPackageVersion: sdarPackage.version,
    a2aSdk: sacsPackage.dependencies["@a2a-js/sdk"],
    agentCardSha256: createHash("sha256").update(cardBytes).digest("hex"),
    protocolBinding: selected.protocolBinding,
    protocolVersion: selected.protocolVersion,
    streaming: true,
    selectedEndpoint: selected.url,
  })}\n`,
);

function directoryUrl(path) {
  const url = pathToFileURL(path.endsWith("\\") ? path : `${path}\\`);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the real P12 gate`);
  return value;
}

function requiredUrl(name) {
  const url = new URL(required(name));
  assert.ok(["http:", "https:"].includes(url.protocol));
  return url;
}
