import { z } from "zod";
import { queryScopeSchema } from "../../packages/analysis-contract/src/query-scope.js";
import type { GroundingResult12 } from "../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
export const realCaseIds = [
  "FC-23",
  "FC-24",
  "FC-25",
  "FC-26",
  "FC-27",
  "FC-28",
  "FC-29",
  "FC-30",
  "FC-31",
] as const;
const findingKind = z.enum([
  "HISTORICAL_TRACE",
  "ROAD_ASSOCIATION",
  "TEMPORAL_EVENT",
  "METRIC_RANKING",
  "ACTION_TARGET_CANDIDATE",
]);
const caseSchema = z.strictObject({
  id: z.enum(realCaseIds),
  queryText: z.string().trim().min(1).max(32768),
  expectedFindingKinds: z.array(findingKind).min(1).max(5),
  maxSubmissions: z.number().int().min(1).max(2),
  allowSelection: z.boolean().default(false),
  allowCancelOwned: z.boolean().default(false),
  queryScope: queryScopeSchema.optional(),
  expectedEventTypes: z
    .array(z.enum(["STOP", "CROSS"]))
    .max(2)
    .optional(),
});
export const realCaseFileSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-functional-real-cases/1.0"),
    authorized: z.literal(true),
    authorizedAt: z.iso.datetime({ offset: true }),
    notAfter: z.iso.datetime({ offset: true }),
    wsgsBaseUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }),
    wsgsBearerToken: z.string().max(4096).optional(),
    cases: z.array(caseSchema).min(1).max(9),
  })
  .superRefine((file, context) => {
    const ids = file.cases.map((c) => c.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "CASE_ID_DUPLICATE" });
    const required: Partial<
      Record<(typeof realCaseIds)[number], z.infer<typeof findingKind>>
    > = {
      "FC-25": "HISTORICAL_TRACE",
      "FC-26": "ROAD_ASSOCIATION",
      "FC-27": "TEMPORAL_EVENT",
      "FC-28": "METRIC_RANKING",
      "FC-29": "ACTION_TARGET_CANDIDATE",
    };
    for (const entry of file.cases) {
      if (
        required[entry.id] &&
        !entry.expectedFindingKinds.includes(required[entry.id]!)
      )
        context.addIssue({
          code: "custom",
          message: "CASE_FINDING_KIND_REQUIRED",
        });
      if (
        entry.id === "FC-24" &&
        (!entry.allowSelection || entry.maxSubmissions < 2)
      )
        context.addIssue({
          code: "custom",
          message: "CHOICE_AUTHORIZATION_REQUIRED",
        });
      if (
        entry.id === "FC-30" &&
        (!entry.queryScope || entry.maxSubmissions < 2)
      )
        context.addIssue({ code: "custom", message: "QUERY_SCOPE_REQUIRED" });
      if (
        entry.id === "FC-31" &&
        (!entry.allowCancelOwned || entry.maxSubmissions < 2)
      )
        context.addIssue({
          code: "custom",
          message: "OWNED_CANCEL_AUTHORIZATION_REQUIRED",
        });
    }
  });
export function parseRealCaseFile(value: unknown, now = Date.now()) {
  const file = realCaseFileSchema.parse(value),
    start = Date.parse(file.authorizedAt),
    end = Date.parse(file.notAfter);
  if (
    start > now ||
    end <= now ||
    end <= start ||
    end - start > 7 * 24 * 60 * 60 * 1000
  )
    throw Error("AUTHORIZED_CONTEXT_EXPIRED_OR_INVALID");
  return file;
}
/** Successful transport or an empty result cannot satisfy positive/finding acceptance. */
export function verifyRealFindingExpectation(
  result: GroundingResult12,
  kinds: readonly z.infer<typeof findingKind>[],
  eventTypes: readonly ("STOP" | "CROSS")[] = [],
): void {
  if (!["COMPLETED", "PARTIAL"].includes(result.status))
    throw Error("REAL_POSITIVE_RESULT_REQUIRED");
  const findings = result.worldAnalysisFindings.findings;
  for (const kind of kinds)
    if (
      !findings.some(
        (f) =>
          f.findingKind === kind && ["COMPLETED", "PARTIAL"].includes(f.status),
      )
    )
      throw Error("REAL_FINDING_KIND_MISSING");
  for (const type of eventTypes)
    if (
      !findings.some(
        (f) =>
          f.findingKind === "TEMPORAL_EVENT" &&
          f.events.some((event) => event.eventType === type),
      )
    )
      throw Error("REAL_EVENT_SUBTYPE_MISSING");
}
