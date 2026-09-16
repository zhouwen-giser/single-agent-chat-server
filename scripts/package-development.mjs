import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  createReadStream,
} from "node:fs";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";

const run = (cmd, args, capture = false) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = async (path) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};
const sourceSha = run("git", ["rev-parse", "HEAD"], true).trim();
if (
  run("git", ["status", "--porcelain", "--untracked-files=normal"], true).trim()
)
  throw Error("Commit reviewed source before packaging");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const id = `${version}-${sourceSha.slice(0, 12)}`;
const image = `single-agent-chat-server:${id}`;
const pg = "postgres:16.9-alpine";
const output = resolve(".tmp/deployment", id);
const root = join(output, "sacs-development");
mkdirSync(output, { recursive: true });
mkdirSync(root); // Fail rather than overwrite an earlier package.
run("docker", [
  "build",
  "--target",
  "runtime",
  "--build-arg",
  `APP_VERSION=${version}`,
  "--build-arg",
  `SOURCE_REVISION=${sourceSha}`,
  "-t",
  image,
  ".",
]);
run("docker", ["pull", pg]);
run("docker", ["save", "-o", join(root, "images.tar"), image, pg]);
for (const file of [
  "compose.yaml",
  "deploy.sh",
  "deploy.py",
  "preflight.mjs",
  "README.md",
])
  cpSync(join("deployment", file), join(root, file));
cpSync(".env.example", join(root, ".env.example"));
const defaults = Object.fromEntries(
  Object.entries(parseEnv(readFileSync(".env.example", "utf8"))).filter(
    ([key]) =>
      /^(CHAT_|AG_UI_|OPENWEBUI_|DATABASE_|IDEMPOTENCY_|SDAR_A2A_|SDAR_POLLING_|SACS_AUTH_|SACS_ALLOW_|SACS_WSGS_ANALYSIS_|SACS_ANALYSIS_ADAPTER_MODE$|WSGS_|CONVERSATION_|LOG_LEVEL$|NODE_ENV$)/u.test(
        key,
      ),
  ),
);
writeFileSync(
  join(root, "runtime.defaults.json"),
  JSON.stringify(defaults, null, 2) + "\n",
);
const migrations = Object.fromEntries(
  readdirSync("migrations")
    .filter((f) => /^\d{4}_.*\.sql$/u.test(f))
    .sort()
    .map((f) => [f, sha(readFileSync(join("migrations", f)))]),
);
const imageId = (name) =>
  JSON.parse(run("docker", ["image", "inspect", name], true))[0].Id;
writeFileSync(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      version,
      sourceSha,
      image,
      imageId: imageId(image),
      postgresImage: pg,
      postgresImageId: imageId(pg),
      migrations,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(root, "SHA256SUMS"),
  (
    await Promise.all(
      readdirSync(root)
        .sort()
        .map(async (f) => `${await fileSha(join(root, f))}  ${f}\n`),
    )
  ).join(""),
);
const archive = join(output, "sacs-development.tar.gz");
run("tar", ["-czf", archive, "-C", output, "sacs-development"]);
writeFileSync(
  archive + ".sha256",
  `${await fileSha(archive)}  sacs-development.tar.gz\n`,
);
console.log(JSON.stringify({ archive, sourceSha, image }));
