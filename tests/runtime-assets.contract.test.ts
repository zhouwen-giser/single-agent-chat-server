import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@jest/globals";

describe("frozen WSGS runtime assets", () => {
  it("copies executable modules byte-for-byte to the compiled import path", async () => {
    execFileSync(process.execPath, ["scripts/copy-runtime-assets.mjs"]);
    for (const path of ["validator.mjs", "generated/schema-documents.mjs"]) {
      expect(
        readFileSync(`dist/dependencies/wsgs-world-analysis-v1/public/${path}`),
      ).toEqual(
        readFileSync(`dependencies/wsgs-world-analysis-v1/public/${path}`),
      );
    }
    const modulePath = new URL(
      "../dist/dependencies/wsgs-world-analysis-v1/public/validator.mjs",
      import.meta.url,
    ).href;
    const validator = await import(modulePath);
    expect(validator.contractVersion).toBe("sacs-wsgs-grounding/1.2");
    expect(typeof validator.createPublicValidator).toBe("function");
  });

  it("includes the same asset step and source locks in the container build", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("RUN node scripts/copy-runtime-assets.mjs");
    expect(dockerfile).toContain(
      "COPY --chown=node:node dependencies/wsgs-world-analysis-v1/public ./dependencies/wsgs-world-analysis-v1/public",
    );
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(manifest.scripts.build).toContain(
      "node scripts/copy-runtime-assets.mjs",
    );
  });
});
