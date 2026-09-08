import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";

const repositoryRoot = process.cwd();
const verifier = resolve(repositoryRoot, "scripts/verify-v05-architecture.mjs");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("v0.5 interactive-analysis authority boundary", () => {
  it("passes the current production apps and packages", () => {
    const result = runVerifier(repositoryRoot);
    expect(result.status).toBe(0);
    expect(result.output).toContain("SACS_V05_ARCHITECTURE_PASS");
  });

  it("allows authority/type literals and WSGS-owned event/reuse payloads", () => {
    const root = fixture({
      "apps/server/src/index.ts": `
        export type SourceAuthority = "GOWM" | "GDPS" | "STAS";
        export const layer = { type: "REFERENCE_SET", sourceAuthority: "GOWM" };
        export const inferToolEventsFromSchema = () => [];
        // import { client } from "@vendor/gowm-client";
      `,
      "packages/wsgs-analysis-consumer/src/index.ts": `
        export const eventTypes = ["TOOL_COMPLETED"] as const;
        export interface WsgsCompileResult {
          readonly reusedNodeIds: readonly string[];
          readonly invalidatedNodeIds: readonly string[];
          readonly rerunNodeIds: readonly string[];
        }
        export function validateCompileResult(result: WsgsCompileResult) {
          return {
            reusedNodeIds: [...result.reusedNodeIds],
            invalidatedNodeIds: [...result.invalidatedNodeIds],
            rerunNodeIds: [...result.rerunNodeIds],
          };
        }
      `,
    });
    const result = runVerifier(root);
    expect(result.status).toBe(0);
    expect(result.output).toContain("SACS_V05_ARCHITECTURE_PASS");
  });

  it.each([
    {
      rule: "DIRECT_DOWNSTREAM_CLIENT",
      source: `import { createClient } from "@vendor/gowm-client";`,
    },
    {
      rule: "DIRECT_DOWNSTREAM_CLIENT",
      source: `import { createClient } from "gdps";`,
    },
    {
      rule: "DIRECT_DOWNSTREAM_ENDPOINT",
      source: `export const endpoint = "https://gdps.internal/api";`,
    },
    {
      rule: "SPATIAL_COMPUTATION_DEPENDENCY",
      source: `import { buffer } from "@turf/buffer";`,
    },
    {
      rule: "SACS_SPATIAL_COMPUTATION",
      source: `export function calculateDistance(a: number, b: number) { return a - b; }`,
    },
    {
      rule: "SACS_NODE_REUSE_DECISION",
      source: `export function decideNodeReuse(nodes: string[]) { return nodes.slice(0, 1); }`,
    },
    {
      rule: "SACS_SEMANTIC_DAG_OWNERSHIP",
      source: `export function buildTypedQueryDag(input: unknown) { return { input }; }`,
    },
    {
      rule: "FINAL_EVIDENCE_TOOL_EVENT_INFERENCE",
      source: `export function inferToolEventsFromFinalEvidence(finalEvidence: unknown) { return [{ eventType: "TOOL_COMPLETED", finalEvidence }]; }`,
    },
  ])("blocks $rule", ({ rule, source }) => {
    const root = fixture({ "apps/server/src/violation.ts": source });
    const result = runVerifier(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(rule);
  });
});

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(resolve(tmpdir(), "sacs-v05-architecture-"));
  temporaryRoots.push(root);
  writeFileSync(
    resolve(root, "package.json"),
    `${JSON.stringify({ dependencies: {} })}\n`,
  );
  for (const [path, content] of Object.entries(files)) {
    const destination = resolve(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return root;
}

function runVerifier(root: string): {
  readonly status: number | null;
  readonly output: string;
} {
  const result = spawnSync(process.execPath, [verifier, "--root", root], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}
