import { spawnSync } from "node:child_process";
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(?:CHAT_|AG_UI_|OPENWEBUI_|SDAR_|WSGS_|SACS_|DATABASE_|POSTGRES_|CONVERSATION_|TEST_DATABASE_URL)/u.test(
        key,
      ),
  ),
);
Object.assign(environment, {
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/dev/null",
  DOTENV_CONFIG_QUIET: "true",
});
const build = spawnSync(process.execPath, ["scripts/build-analysis-web.mjs"], {
  env: environment,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync(
  process.execPath,
  [
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--runInBand",
    "tests/v06-analysis-browser.integration.test.ts",
    "tests/v06-analysis-web-security.unit.test.ts",
  ],
  { env: environment, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
