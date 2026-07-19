import { spawnSync } from "node:child_process";

const image = process.env.CHAT_SERVER_IMAGE ?? "single-agent-chat-server:0.1.0";
const result = spawnSync(
  "docker",
  ["image", "inspect", image, "--format", "{{json .Config}}"],
  { encoding: "utf8", shell: false },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const config = JSON.parse(result.stdout);
if (!config.User || config.User === "0" || config.User === "root") {
  throw new Error(
    `Container must run non-root; found ${config.User || "unset"}`,
  );
}
if (!Array.isArray(config.Healthcheck?.Test)) {
  throw new Error("Container image has no healthcheck");
}
if (config.ExposedPorts?.["3000/tcp"] === undefined) {
  throw new Error("Container image does not expose 3000/tcp");
}
process.stdout.write(
  `Container metadata gate passed: user=${config.User}, healthcheck=present.\n`,
);
