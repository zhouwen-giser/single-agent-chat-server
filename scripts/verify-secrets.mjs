import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const files = (await git(["ls-files", "-z"])).split("\0").filter(Boolean);
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["live Stripe key", /\bsk_live_[A-Za-z0-9]{16,}\b/u],
];
for (const file of files) {
  if (
    file === "scripts/verify-secrets.mjs" ||
    file.endsWith(".zip") ||
    file.endsWith(".png")
  ) {
    continue;
  }
  const content = await readFile(file, "utf8").catch(() => undefined);
  if (content === undefined) continue;
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) throw new Error(`${label} detected in ${file}`);
  }
}
process.stdout.write(
  `Secret-pattern gate passed across ${files.length} tracked files.\n`,
);

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim())),
    );
  });
}
