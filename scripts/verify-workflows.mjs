import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
for (const required of [
  "pnpm install --frozen-lockfile",
  "pnpm verify:ci",
  "pnpm docker:build",
  "pnpm verify:compose",
]) {
  if (!workflow.includes(required)) {
    throw new Error(`CI workflow is missing: ${required}`);
  }
}
if (/\b(?:pull_request_target|workflow_run)\s*:/u.test(workflow)) {
  throw new Error("CI uses an unexpected privileged trigger");
}
process.stdout.write(
  "GitHub Actions static gate passed for quality/container jobs.\n",
);
