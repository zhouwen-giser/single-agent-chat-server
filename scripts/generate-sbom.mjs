import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const configuredOutput = process.env.P13_SBOM_OUTPUT_FILE?.trim();
const outputPath = configuredOutput
  ? resolve(root, configuredOutput)
  : join(root, "reports", "security", "sbom.cdx.json");
if (configuredOutput) {
  const relativePath = relative(resolve(root, ".tmp"), outputPath);
  if (relativePath === "" || relativePath.startsWith("..")) {
    throw new Error("P13_SBOM_OUTPUT_FILE must resolve below .tmp");
  }
}
const outputDirectory = dirname(outputPath);
const outputName = basename(outputPath);
mkdirSync(outputDirectory, { recursive: true });
const image = process.env.CHAT_SERVER_IMAGE ?? "single-agent-chat-server:0.1.0";
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${outputDirectory}:/out`,
    "anchore/syft:v1.48.0",
    image,
    "-o",
    `cyclonedx-json=/out/${outputName}`,
  ],
  { encoding: "utf8", shell: false, stdio: "inherit" },
);
if (result.status !== 0) {
  process.stderr.write(
    result.error instanceof Error
      ? `SBOM generation could not start: ${result.error.message}\n`
      : "SBOM generation failed.\n",
  );
  process.exit(result.status ?? 1);
}
const bytes = readFileSync(outputPath);
const sbom = JSON.parse(bytes.toString("utf8"));
assert.equal(sbom.bomFormat, "CycloneDX");
assert.equal(sbom.specVersion, "1.7");
assert.equal(sbom.metadata?.component?.name, "single-agent-chat-server");
assert.ok(
  sbom.components?.some(
    (component) =>
      component.name === "@a2a-js/sdk" && component.version === "1.0.0-beta.0",
  ),
);
process.stdout.write(
  `${JSON.stringify({
    status: "PASSED",
    output: relative(root, outputPath).replaceAll("\\", "/"),
    specVersion: sbom.specVersion,
    components: sbom.components.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })}\n`,
);
