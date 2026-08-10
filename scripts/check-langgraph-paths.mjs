import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await readFile(resolve(root, "langgraph.json"), "utf8"),
);

for (const [name, target] of Object.entries(config.graphs ?? {})) {
  const [relativePath, exportName] = String(target).split(":");
  if (!relativePath || !exportName) {
    throw new Error(`Invalid graph target for ${name}: ${target}`);
  }
  const sourcePath = resolve(root, relativePath);
  await access(sourcePath);
  const source = await readFile(sourcePath, "utf8");
  if (!source.includes(`export const ${exportName}`)) {
    throw new Error(`Missing export ${exportName} for graph ${name}`);
  }
}

console.log("langgraph.json graph paths and exports are valid.");
