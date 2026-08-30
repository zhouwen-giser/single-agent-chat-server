import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "@jest/globals";

const root = process.cwd();
const allowedStatuses = ["PASS", "FAIL", "NOT_RUN", "BLOCKED"];
const evidenceEquivalents: Readonly<Record<string, readonly string[]>> = {
  STATIC: ["STATIC_GUARD"],
  AGUI: ["AGUI_HTTP_SSE"],
  OPENAI: ["OPENAI_HTTP"],
  REPORT: ["REPORT_ASSERTION"],
};

describe("SACS v0.4 geospatial acceptance evidence", () => {
  it("uses only package-authorized per-row statuses and exact accounting", () => {
    const ledger = object(
      readJson("reports/v0.4/geospatial/acceptance-ledger.json"),
    );
    const entries = array(ledger.entries).map(object);
    const ids = entries.map((entry) => string(entry.acceptanceId));

    expect(ledger.allowedStatuses).toEqual(allowedStatuses);
    expect(entries).toHaveLength(305);
    expect(new Set(ids).size).toBe(305);
    expect(
      entries.every((entry) => allowedStatuses.includes(string(entry.status))),
    ).toBe(true);
    expect(entries.some((entry) => entry.status === "PARTIAL")).toBe(false);
    expect(ledger.counts).toEqual({
      total: 305,
      PASS: 189,
      FAIL: 0,
      BLOCKED: 113,
      NOT_RUN: 3,
    });
  });

  it("requires hashed primary evidence for every evidence type of every PASS", () => {
    const ledger = object(
      readJson("reports/v0.4/geospatial/acceptance-ledger.json"),
    );
    const entries = array(ledger.entries).map(object);

    for (const entry of entries.filter(({ status }) => status === "PASS")) {
      const requiredEvidence = array(entry.requiredEvidence).map(string);
      const evidence = array(entry.evidence).map(object);
      for (const required of requiredEvidence) {
        const acceptedTypes = [
          required,
          ...(evidenceEquivalents[required] ?? []),
        ];
        const matching = evidence.find(
          (item) =>
            acceptedTypes.includes(string(item.type)) &&
            item.scope !== "SUPPLEMENTARY_ONLY" &&
            typeof item.sourceSha256 === "string",
        );
        expect(matching).toBeDefined();
        if (matching === undefined) continue;
        const evidencePath = string(matching.path);
        expect(matching.acceptanceId).toBe(entry.acceptanceId);
        expect(string(matching.assertionLocator)).toContain(
          string(entry.acceptanceId),
        );
        expect(matching.sourceSha256).toBe(fileHash(evidencePath));
      }
    }
  });

  it("keeps missing upstream and real-chain evidence fail-closed", () => {
    const ledger = object(
      readJson("reports/v0.4/geospatial/acceptance-ledger.json"),
    );
    const entries = array(ledger.entries).map(object);
    const s14 = entries.filter(({ phase }) => phase === "S14");
    const s20 = entries.filter(({ phase }) => phase === "S20");
    const s21 = entries.filter(({ phase }) => phase === "S21");
    const s22 = entries.filter(({ phase }) => phase === "S22");
    const realCases = entries.filter(({ acceptanceId }) =>
      /^AC-R\d{3}$/u.test(string(acceptanceId)),
    );

    expect(s14).toHaveLength(28);
    expect(s20).toHaveLength(22);
    expect(s21).toHaveLength(15);
    expect(s22).toHaveLength(13);
    expect(realCases).toHaveLength(18);
    for (const group of [s14, s20, s21, s22, realCases]) {
      expect(group.every(({ status }) => status === "BLOCKED")).toBe(true);
    }
  });

  it("does not use generated ledgers as circular evidence", () => {
    const evidenceMap = object(
      readJson("reports/v0.4/geospatial/acceptance-evidence-map.json"),
    );
    const entries = array(evidenceMap.entries).map(object);
    const forbidden = new Set([
      "reports/v0.4/geospatial/acceptance-ledger.json",
      "reports/v0.4/geospatial/acceptance-evidence-map.json",
    ]);

    for (const entry of entries) {
      for (const evidence of array(entry.evidence).map(object)) {
        expect(forbidden.has(string(evidence.path))).toBe(false);
      }
    }
  });
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
}

function fileHash(path: string): string {
  return `sha256:${createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")}`;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
