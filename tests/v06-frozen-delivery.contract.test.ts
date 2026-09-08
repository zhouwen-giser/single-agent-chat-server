import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "@jest/globals";

interface TestPlan {
  schemaVersion: string;
  mode: string;
  cwd: string;
  command: string[];
  frozenTests: string[];
  legacyTests: string[];
  tests: string[];
  environmental: Record<string, string>;
}
const root = process.cwd();
const readPlan = (mode: string): TestPlan => {
  // Only list mode: executing the selected Jest suites here would recurse into this contract.
  const child = spawnSync(
    process.execPath,
    ["scripts/v06-frozen-tests.mjs", mode, "--list"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        WSGS_BASE_URL: "https://must-not-be-used.invalid",
        OPENAI_API_KEY: "not-a-real-key",
      },
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stderr).toBe("");
  expect(child.stdout).not.toContain("not-a-real-key");
  expect(child.stdout).not.toContain("must-not-be-used.invalid");
  return JSON.parse(child.stdout) as TestPlan;
};

describe("frozen consumer source delivery C06", () => {
  it.each(["contracts", "unit", "http", "all"])(
    "AC-040 %s selects only explicit source Jest files without Docker/DB/build/release runners",
    (mode) => {
      const plan = readPlan(mode);
      expect(plan).toMatchObject({
        schemaVersion: "sacs-frozen-source-test-plan/1.0",
        mode,
        cwd: root,
        environmental: { "ENV-001": "NOT_RUN" },
      });
      expect(plan.command.slice(0, 5)).toEqual([
        process.execPath,
        "--experimental-vm-modules",
        resolve(root, "node_modules/jest/bin/jest.js"),
        "--runInBand",
        "--runTestsByPath",
      ]);
      expect(plan.command.slice(5)).toEqual(plan.tests);
      expect(plan.tests.length).toBeGreaterThan(0);
      expect(new Set(plan.tests).size).toBe(plan.tests.length);
      for (const path of plan.tests) {
        expect(path).toMatch(
          /^tests\/[a-z0-9-]+\.(?:unit|contract|integration)\.test\.ts$/u,
        );
        expect(path).not.toMatch(
          /postgres|docker|release|real-e2e|real-model|real-sdar|dist\//u,
        );
      }
    },
  );

  it("AC-040 all includes every frozen source suite and the deduplicated predecessor groups", () => {
    const plans = [readPlan("contracts"), readPlan("unit"), readPlan("http")];
    const all = readPlan("all");
    const discovered = readdirSync(resolve(root, "tests"))
      .filter((name) =>
        /^v06-frozen-[a-z0-9-]+\.(?:unit|contract|integration)\.test\.ts$/u.test(
          name,
        ),
      )
      .map((name) => `tests/${name}`)
      .sort();
    expect(all.frozenTests).toEqual(discovered);
    expect(all.tests).toEqual(
      [...new Set(plans.flatMap((plan) => plan.tests))].sort(),
    );
    expect(all.tests).toContain("tests/v06-frozen-delivery.contract.test.ts");
    expect(all.legacyTests).toEqual(
      expect.arrayContaining([
        "tests/world-grounding-runtime.unit.test.ts",
        "tests/world-grounding-application.unit.test.ts",
        "tests/grounding-request-planner.unit.test.ts",
        "tests/wsgs-http-adapter.contract.test.ts",
        "tests/sdar-a2a-adapter.contract.test.ts",
        "tests/analysis-reference-client.contract.test.ts",
        "tests/analysis-control-api.contract.test.ts",
        "tests/analysis-control-coordinator.unit.test.ts",
        "tests/multi-task-coordinator.contract.test.ts",
        "tests/openai-api.contract.test.ts",
        "tests/openai-predecessor-regression.contract.test.ts",
        "tests/query-service.unit.test.ts",
        "tests/v06-world-analysis-view.unit.test.ts",
        "tests/world-explanation-renderer.unit.test.ts",
        "tests/finding-reference-resolver.unit.test.ts",
      ]),
    );
  });

  it("AC-039 AC-040 http includes the normal shared-entry integration and real adapter peer suites", () => {
    const plan = readPlan("http");
    expect(plan.frozenTests).toEqual(
      expect.arrayContaining([
        "tests/v06-frozen-entry.integration.test.ts",
        "tests/v06-frozen-http.contract.test.ts",
        "tests/v06-frozen-source.unit.test.ts",
        "tests/v06-frozen-cancel.unit.test.ts",
        "tests/v06-frozen-request.unit.test.ts",
      ]),
    );
    expect(plan.legacyTests).toContain(
      "tests/sdar-a2a-adapter.contract.test.ts",
    );
  });

  it("AC-040 rejects arbitrary command/path arguments without running tests", () => {
    for (const args of [
      ["release"],
      ["../../scripts/verify-compose.mjs"],
      ["all", "--list", "--unknown"],
    ]) {
      const child = spawnSync(
        process.execPath,
        ["scripts/v06-frozen-tests.mjs", ...args],
        { cwd: root, encoding: "utf8", timeout: 10000 },
      );
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(2);
      expect(child.stderr).toContain("Usage:");
      expect(child.stdout).toBe("");
    }
  });

  it("AC-040 package exposes only direct source commands and preserves pinned runtime/license", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as {
      version: string;
      license: string;
      packageManager: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.version).toBe("0.6.0");
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.packageManager).toBe("pnpm@11.13.1");
    expect(pkg.dependencies["@a2a-js/sdk"]).toBe("1.0.0-beta.0");
    for (const version of Object.values(pkg.dependencies))
      expect(version).not.toMatch(/^[~^*]|latest/u);
    for (const [suffix, mode] of [
      [":contracts", "contracts"],
      [":unit", "unit"],
      [":http", "http"],
      ["", "all"],
    ]) {
      expect(pkg.scripts[`test:v06:frozen-wsgs${suffix}`]).toBe(
        `node scripts/v06-frozen-tests.mjs ${mode}`,
      );
    }
    expect(pkg.scripts["dev:server"]).toBe("tsx watch apps/server/src/main.ts");
  });

  it("AC-040 development documentation names evidence, environmental limits and source startup accurately", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(readme).toContain("reports/v0.6/frozen-wsgs-consumer/SOURCE_RUN.md");
    expect(readme).toContain(
      "reports/v0.6/frozen-wsgs-consumer/ACCEPTANCE_LEDGER.json",
    );
    expect(readme).toMatch(/ENV-001[\s\S]*?NOT_RUN/u);
    expect(readme).toContain("not production deployment or release");
    expect(readme).toContain("`pnpm dev:server`");
    const script = readFileSync(
      resolve(root, "scripts/v06-frozen-tests.mjs"),
      "utf8",
    );
    expect(script).toContain('NODE_ENV: "test"');
    expect(script).toContain("DOTENV_CONFIG_PATH:");
    expect(script).toContain('"/dev/null"');
    expect(script).toContain("shell: false");
    expect(script).not.toMatch(/spawn\([^\n]*?(?:docker|pnpm|build|postgres)/u);
  });
});
