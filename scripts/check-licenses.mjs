import { spawnSync } from "node:child_process";

const allowed = new Set(["Apache-2.0", "BSD-3-Clause", "ISC", "MIT"]);
const pnpmEntry = process.env.npm_execpath;
if (pnpmEntry === undefined) {
  throw new Error("Run the license gate through pnpm");
}
const result = spawnSync(
  process.execPath,
  [pnpmEntry, "licenses", "list", "--prod", "--json"],
  {
    encoding: "utf8",
    shell: false,
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || "Unable to enumerate licenses.\n");
  process.exit(result.status ?? 1);
}
const inventory = JSON.parse(result.stdout);
const detected = Object.keys(inventory).sort();
const rejected = detected.filter((license) => !allowed.has(license));
if (rejected.length > 0) {
  throw new Error(`Disallowed production licenses: ${rejected.join(", ")}`);
}
const packageCount = Object.values(inventory).reduce(
  (count, entries) => count + entries.length,
  0,
);
process.stdout.write(
  `Production license gate passed: ${packageCount} entries; ${detected.join(", ")}\n`,
);
