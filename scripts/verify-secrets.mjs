import { lstat, readFile, readlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

const repositoryRoot = (
  await git(["rev-parse", "--show-toplevel"], process.cwd())
).trim();
const files = (
  await git(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    repositoryRoot,
  )
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["live Stripe key", /\bsk_live_[A-Za-z0-9]{16,}\b/u],
];
let scannedFiles = 0;
for (const file of files) {
  const normalizedFile = file.replaceAll("\\", "/");
  if (
    normalizedFile === "scripts/verify-secrets.mjs" ||
    normalizedFile.toLowerCase().endsWith(".zip") ||
    normalizedFile.toLowerCase().endsWith(".png")
  ) {
    continue;
  }
  const absolutePath = resolve(repositoryRoot, normalizedFile);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelativePath)
  ) {
    throw new Error("git returned a path outside the repository");
  }
  const metadata = await lstat(absolutePath);
  let content;
  if (metadata.isSymbolicLink()) {
    content = await readlink(absolutePath, "utf8");
  } else if (metadata.isFile()) {
    content = await readFile(absolutePath, "utf8");
  } else {
    continue;
  }
  scannedFiles += 1;
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) {
      throw new Error(`${label} detected in ${JSON.stringify(normalizedFile)}`);
    }
  }
}
process.stdout.write(
  `Secret-pattern gate passed across ${scannedFiles} tracked and untracked non-ignored files.\n`,
);

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
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
