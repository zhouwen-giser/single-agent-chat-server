import { describe, it, expect } from "@jest/globals";
import {
  parseRealCaseFile,
  verifyRealFindingExpectation,
} from "../scripts/lib/v06-real-cases.js";
import { frozenResult } from "./helpers/frozen-wsgs-http.js";
const now = Date.parse("2026-10-14T00:00:00Z");
const config = {
  schemaVersion: "sacs-functional-real-cases/1.0",
  authorized: true,
  authorizedAt: "2026-10-13T23:00:00Z",
  notAfter: "2026-10-14T01:00:00Z",
  wsgsBaseUrl: "https://authorized.example",
  cases: [
    {
      id: "FC-25",
      queryText: "private authorized history query",
      expectedFindingKinds: ["HISTORICAL_TRACE"],
      maxSubmissions: 1,
    },
  ],
};
describe("real source input and assertion gates", () => {
  it("accepts fresh scoped authorization without requiring unrelated case material", () => {
    expect(parseRealCaseFile(config, now).cases).toHaveLength(1);
  });
  it.each([
    { ...config, authorized: false },
    { ...config, notAfter: "2026-10-13T23:30:00Z" },
    { ...config, authorizedAt: "2026-10-14T00:30:00Z" },
    { ...config, notAfter: "2026-11-01T00:00:00Z" },
    { ...config, wsgsBaseUrl: "https://user:secret@authorized.example" },
    { ...config, cases: [...config.cases, ...config.cases] },
  ])("rejects absent/stale/future/unbounded or duplicate scope", (value) => {
    expect(() => parseRealCaseFile(value, now)).toThrow();
  });
  it("requires exact finding identity and explicit choice/scope/owned-cancel budgets", () => {
    for (const entry of [
      { id: "FC-25", expectedFindingKinds: ["ROAD_ASSOCIATION"] },
      { id: "FC-24", allowSelection: false },
      { id: "FC-30" },
      { id: "FC-31", allowCancelOwned: false },
    ])
      expect(() =>
        parseRealCaseFile(
          { ...config, cases: [{ ...config.cases[0], ...entry }] },
          now,
        ),
      ).toThrow();
  });
  it("does not promote empty/UNRESOLVED/HTTP-success results into positive or another finding type", () => {
    expect(() =>
      verifyRealFindingExpectation(frozenResult("trace-no-data"), [
        "HISTORICAL_TRACE",
      ]),
    ).toThrow();
    expect(() =>
      verifyRealFindingExpectation(frozenResult("trace"), ["ROAD_ASSOCIATION"]),
    ).toThrow();
    expect(() =>
      verifyRealFindingExpectation(frozenResult("trace"), ["HISTORICAL_TRACE"]),
    ).not.toThrow();
    expect(() =>
      verifyRealFindingExpectation(
        frozenResult("event"),
        ["TEMPORAL_EVENT"],
        ["STOP"],
      ),
    ).toThrow();
  });
});
