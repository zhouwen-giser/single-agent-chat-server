import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outputDirectory = join(root, "reports", "security");
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
    "cyclonedx-json=/out/sbom.cdx.json",
  ],
  { encoding: "utf8", shell: false, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(
  "CycloneDX SBOM written to reports/security/sbom.cdx.json\n",
);
