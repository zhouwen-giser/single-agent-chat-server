import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
if (packageJson.dependencies?.["@a2a-js/sdk"] !== "1.0.0-beta.0") {
  throw new Error("Frozen @a2a-js/sdk@1.0.0-beta.0 pin changed");
}
for (const [name, version] of Object.entries({
  "@ag-ui/core": packageJson.dependencies?.["@ag-ui/core"],
  "@ag-ui/encoder": packageJson.dependencies?.["@ag-ui/encoder"],
  "@ag-ui/client": packageJson.devDependencies?.["@ag-ui/client"],
})) {
  if (version !== "0.0.57") {
    throw new Error(`Frozen ${name}@0.0.57 pin changed`);
  }
}

for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  if (
    dependency.startsWith("@ag-ui/") &&
    !["@ag-ui/core", "@ag-ui/encoder"].includes(dependency)
  ) {
    throw new Error(`Out-of-bound production dependency: ${dependency}`);
  }
  if (
    /(?:modelcontextprotocol|(?:^|[/@_-])mcp(?:$|[/@_-])|agent.?mesh|agent.?registry|copilotkit|clickhouse)/iu.test(
      dependency,
    )
  ) {
    throw new Error(`Out-of-bound production dependency: ${dependency}`);
  }
}

const productionRoots = ["apps", "packages", "src"];
const legacySingleTaskApiAllowlist = new Set([
  "apps/server/src/chat/sdar-agui-runner.ts",
  "apps/server/src/chat/sdar-chat-runner.ts",
  "packages/chat-runtime/src/task-coordinator.ts",
  "packages/interaction-query/src/index.ts",
  "packages/persistence/src/agui-task-coordinator-repository.ts",
  "packages/persistence/src/interaction-repository.ts",
  "packages/persistence/src/repository.ts",
]);
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
    /from ["']@ag-ui\/(?:core|encoder)["']/u.test(content) &&
    !name.startsWith("packages/ag-ui-api-contract/") &&
    !name.startsWith("packages/ag-ui-interaction-adapter/")
  ) {
    violations.push(`${name}: official AG-UI import outside protocol adapter`);
  }
  if (content.includes("@ag-ui/a2a")) {
    violations.push(`${name}: experimental AG-UI A2A adapter is forbidden`);
  }
  if (
    /from ["']pg["']/u.test(content) &&
    !name.startsWith("packages/persistence/")
  ) {
    violations.push(`${name}: PostgreSQL import outside persistence`);
  }
  if (
    /\bfetch\s*\(/u.test(content) &&
    !name.startsWith("packages/sdar-a2a-adapter/") &&
    !name.startsWith("packages/conversation-model/")
  ) {
    violations.push(
      `${name}: network fetch outside the isolated A2A or conversation-model adapter`,
    );
  }
  if (
    /from ["']node:child_process["']/u.test(content) ||
    /from ["'](?:axios|undici|@modelcontextprotocol\/[^"']+)["']/u.test(content)
  ) {
    violations.push(`${name}: forbidden process or network client import`);
  }
  if (
    /["'`]\/(?:admin|internal|management|control|mcp|providers?|resources?|actions?)(?:\/|["'`])/iu.test(
      content,
    )
  ) {
    violations.push(`${name}: forbidden management or MCP endpoint path`);
  }
  if (
    /(?:Agent|Sdar)(?:Mesh|Registry|Router)|(?:Mesh|Registry|Router)(?:Agent|Sdar)/u.test(
      content,
    )
  ) {
    violations.push(`${name}: forbidden multi-SDAR discovery or routing type`);
  }
  if (
    /from ["'][^"']*(?:test-support|test-fixtures|tests\/fixtures)[^"']*["']/u.test(
      content,
    )
  ) {
    violations.push(`${name}: production import from a test fixture`);
  }
  if (/\blocalFallbackChatModel\b/u.test(content)) {
    violations.push(`${name}: production use of a local chat fallback`);
  }
  if (
    /\bfindActiveTask(?:ForChat)?\b/u.test(content) &&
    !legacySingleTaskApiAllowlist.has(name)
  ) {
    violations.push(`${name}: new use of a legacy implicit single-Task API`);
  }
  if (
    /process\.env\.(?:SDAR|MCP)|process\.env\[\s*["'](?:SDAR|MCP)/u.test(
      content,
    )
  ) {
    violations.push(`${name}: direct dynamic SDAR or MCP environment access`);
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
