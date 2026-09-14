import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

describe("real integration harness admission", () => {
  it.each([
    [
      "missing opt-in",
      "WSGS_BASE_URL=http://127.0.0.1:1",
      "Explicit real-analysis opt-in required",
    ],
    [
      "embedded credentials",
      "ALLOW_REAL_WSGS=YES\nWSGS_BASE_URL=http://user:private@127.0.0.1:1",
      "AssertionError",
    ],
    [
      "excessive HTTP budget",
      "ALLOW_REAL_WSGS=YES\nWSGS_BASE_URL=http://127.0.0.1:1\nWSGS_OPERATION_TIMEOUT_MS=120001",
      "AssertionError",
    ],
    [
      "unsupported preflight downgrade",
      "ALLOW_REAL_WSGS=YES\nWSGS_BASE_URL=http://127.0.0.1:1\nSACS_V06_PREFLIGHT_VERSION=1.1",
      "AssertionError",
    ],
  ])(
    "rejects %s before creating evidence or contacting an endpoint",
    (_name, content, expected) => {
      const directory = mkdtempSync(join(tmpdir(), "sacs-real-admission-"));
      try {
        const config = join(directory, "private.env");
        writeFileSync(config, content, { mode: 0o600 });
        const result = spawnSync(
          process.execPath,
          ["scripts/v06-real-integration.mjs", "--readiness"],
          {
            env: {
              ...process.env,
              SACS_V06_INTEGRATION_ENV: config,
              SACS_V06_EVIDENCE_DIR: directory,
            },
            encoding: "utf8",
            timeout: 10000,
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(expected);
        expect(result.stderr).not.toContain("user:private");
        expect(() =>
          readFileSync(join(directory, "INTEGRATION_EVIDENCE.json")),
        ).toThrow();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("refuses to overwrite prior evidence before making live requests", () => {
    const directory = mkdtempSync(join(tmpdir(), "sacs-real-preserve-"));
    try {
      const config = join(directory, "private.env");
      const receipt = join(directory, "INTEGRATION_EVIDENCE.json");
      writeFileSync(
        config,
        "ALLOW_REAL_WSGS=YES\nWSGS_BASE_URL=http://127.0.0.1:1",
        { mode: 0o600 },
      );
      writeFileSync(receipt, "historical receipt\n");
      const result = spawnSync(
        process.execPath,
        ["scripts/v06-real-integration.mjs", "--readiness"],
        {
          env: {
            ...process.env,
            SACS_V06_INTEGRATION_ENV: config,
            SACS_V06_EVIDENCE_DIR: directory,
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EEXIST");
      expect(readFileSync(receipt, "utf8")).toBe("historical receipt\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
