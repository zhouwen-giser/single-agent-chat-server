import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
if (packageJson.dependencies?.["@a2a-js/sdk"] !== "1.0.0-beta.0") {
  throw new Error("Frozen @a2a-js/sdk@1.0.0-beta.0 pin changed");
}

const productionRoots = ["apps", "packages", "src"];
const files = (
  await Promise.all(
    productionRoots.map((directory) => walk(join(root, directory))),
  )
).flat();
const violations = [];
for (const file of files) {
  if (extname(file) !== ".ts") continue;
  const name = relative(root, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8");
  if (
    content.includes("@a2a-js/sdk") &&
    !name.startsWith("packages/sdar-a2a-adapter/")
  ) {
    violations.push(`${name}: official SDK import outside adapter`);
  }
  if (
    /from ["']pg["']/u.test(content) &&
    !name.startsWith("packages/persistence/")
  ) {
    violations.push(`${name}: PostgreSQL import outside persistence`);
  }
  for (const forbidden of [
    "tasks/send",
    "tasks/get",
    "tasks/cancel",
    "tasks/resubscribe",
    "jsonrpc",
    "grpc://",
  ]) {
    if (content.toLowerCase().includes(forbidden)) {
      violations.push(`${name}: forbidden protocol token ${forbidden}`);
    }
  }
}
if (violations.length > 0) {
  throw new Error(`Architecture gate failed:\n${violations.join("\n")}`);
}
process.stdout.write(
  `Architecture gate passed across ${files.length} production source files.\n`,
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
}
