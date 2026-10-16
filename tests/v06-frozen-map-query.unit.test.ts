import { describe, expect, it } from "@jest/globals";
import { planFrozenGroundingRequest } from "../packages/grounding-request-planner/src/frozen-request.js";
import {
  queryScopeSchema,
  type QueryScope,
} from "../packages/analysis-contract/src/query-scope.js";
import {
  FrozenWorldAnalysisContract,
  publicCanonicalHash,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";

const base = {
  principalId: "scope-principal",
  threadId: "scope-thread",
  analysisId: "scope-analysis",
  commandId: "scope-command",
  text: "查询此范围内历史观测",
  createdAt: "2026-09-06T02:00:30.000Z",
};
const scopes: QueryScope[] = [
  { geometry: { type: "Point", coordinates: [120, 30] } },
  {
    geometry: {
      type: "LineString",
      coordinates: [
        [120, 30],
        [121, 31],
      ],
    },
  },
  {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [120, 30],
          [121, 30],
          [121, 31],
          [120, 30],
        ],
      ],
    },
  },
  { geometry: { type: "Circle", center: [120, 30], radiusMeters: 150 } },
];
describe("frozen map query request planning", () => {
  it.each(scopes)(
    "S05 preserves exact user $geometry.type in the public MapSelection envelope",
    (queryScope) => {
      // The frozen public validator intentionally rejects non-JSON prototypes;
      // keep the comparison object in this Jest VM's JSON realm.
      const before = JSON.parse(JSON.stringify(queryScope)) as QueryScope;
      const plan = planFrozenGroundingRequest({ ...base, queryScope });
      if (plan.kind !== "QUERY") throw Error("EXPECTED_QUERY");
      new FrozenWorldAnalysisContract().parse("request", plan.request);
      const selection = plan.request.contextCapsule.mapSelections[0]!;
      expect(plan.request.contextCapsule.mapSelections).toHaveLength(1);
      expect(selection.geometry).toEqual(before.geometry);
      expect(selection.geometryHash).toBe(publicCanonicalHash(before.geometry));
      expect(selection.kind).toBe(
        queryScope.geometry.type === "Point"
          ? "POINT"
          : queryScope.geometry.type === "LineString"
            ? "LINE"
            : "AREA",
      );
      expect(selection.revision).toBe(1); // Unique identity for this submitted scope, not a Finding revision.
      expect(selection.referenceKey).toBeUndefined();
      expect(plan.request.executionPolicy).toMatchObject({
        readOnly: true,
        allowApproximation: false,
      });
      expect(plan.request.analysisSelections).toBeUndefined();
      expect(queryScope).toEqual(before);
    },
  );
  it("S05 changed scope retains command key but changes durable request/semantic hashes", () => {
    const first = planFrozenGroundingRequest({
      ...base,
      queryScope: scopes[0]!,
    });
    const changed = planFrozenGroundingRequest({
      ...base,
      queryScope: scopes[1]!,
    });
    if (first.kind !== "QUERY" || changed.kind !== "QUERY")
      throw Error("EXPECTED_QUERY");
    expect(first.idempotencyKey).toBe(changed.idempotencyKey);
    expect(first.requestHash).not.toBe(changed.requestHash);
    expect(first.semanticHash).not.toBe(changed.semanticHash);
  });
  it("S05 an explicit geometry query cannot be swallowed as local presentation", () => {
    expect(
      planFrozenGroundingRequest({
        ...base,
        text: "聚焦地图",
        queryScope: scopes[0]!,
      }).kind,
    ).toBe("QUERY");
    expect(planFrozenGroundingRequest({ ...base, text: "聚焦地图" }).kind).toBe(
      "PRESENTATION",
    );
  });
  it.each([
    { geometry: { type: "Point", coordinates: [Infinity, 30] } },
    { geometry: { type: "Point", coordinates: [120, 91] } },
    { geometry: { type: "Circle", center: [120, 30], radiusMeters: 1000001 } },
    { geometry: { type: "Polygon", coordinates: [] } },
    {
      geometry: {
        type: "LineString",
        coordinates: Array.from({ length: 257 }, () => [120, 30]),
      },
    },
    {
      geometry: {
        type: "Point",
        coordinates: [120, 30],
        executionAuthorized: true,
      },
    },
    {
      geometry: { type: "Point", coordinates: [120, 30] },
      sourceAuthority: "WSGS",
    },
  ])(
    "S05 rejects nonfinite, unbounded or authority-injecting input %#",
    (queryScope) => {
      expect(queryScopeSchema.safeParse(queryScope).success).toBe(false);
      expect(() =>
        planFrozenGroundingRequest({
          ...base,
          queryScope: queryScope as QueryScope,
        }),
      ).toThrow();
    },
  );
});
