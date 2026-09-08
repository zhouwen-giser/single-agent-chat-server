import { isProxy } from "node:util/types";

import {
  ANALYSIS_MAX_PUBLIC_ARGS_BYTES,
  toolInteractionDescriptorSchema,
  type ToolInteractionDescriptor,
} from "../../analysis-contract/src/index.js";
import type {
  WsgsCancelRequest,
  WsgsCancelResult,
  WsgsCompileRevisionRequest,
  WsgsCompileRevisionResult,
  WsgsInterventionResolutionRequest,
  WsgsInterventionResolutionResult,
} from "../../analysis-runtime/src/revision-coordinator.js";
import {
  calculateCanonicalJsonHash,
  parseWsgsAnalysisEventEnvelope,
  WSGS_ANALYSIS_HANDOFF_NOT_READY,
  type WsgsAnalysisEventEnvelope,
} from "../../wsgs-analysis-consumer/src/index.js";
import type {
  JsonObject,
  JsonValue,
} from "../../world-explanation-contract/src/index.js";

export type {
  WsgsCancelRequest,
  WsgsCancelResult,
  WsgsCompileRevisionRequest,
  WsgsCompileRevisionResult,
  WsgsInterventionResolutionRequest,
  WsgsInterventionResolutionResult,
} from "../../analysis-runtime/src/revision-coordinator.js";
export type { WsgsAnalysisEventEnvelope } from "../../wsgs-analysis-consumer/src/index.js";

export const FIXTURE_WSGS_ANALYSIS_SUPPORT = [
  "PLAN",
  "EVENTS",
  "COMPILE_REVISION",
  "CANCEL",
  "INTERVENTION",
  "DATA_GAP",
] as const;

export const FIXTURE_WSGS_ANALYSIS_SCENARIOS = [
  "SUCCESS",
  "AMBIGUITY",
  "DATA_GAP",
] as const;

export type FixtureWsgsAnalysisCapability =
  (typeof FIXTURE_WSGS_ANALYSIS_SUPPORT)[number];
export type FixtureWsgsAnalysisScenario =
  (typeof FIXTURE_WSGS_ANALYSIS_SCENARIOS)[number];

export interface FixtureWsgsAnalysisManifest {
  readonly schemaVersion: "sacs-v05-fixture-adapter/1.0";
  readonly adapterId: "FixtureWsgsAnalysisAdapter";
  readonly environmentEligibility: readonly [
    "test",
    "development",
    "local-compose",
  ];
  readonly supports: typeof FIXTURE_WSGS_ANALYSIS_SUPPORT;
  readonly productionEligible: false;
}

export const FIXTURE_WSGS_ANALYSIS_MANIFEST = deepFreeze({
  schemaVersion: "sacs-v05-fixture-adapter/1.0",
  adapterId: "FixtureWsgsAnalysisAdapter",
  environmentEligibility: ["test", "development", "local-compose"],
  supports: FIXTURE_WSGS_ANALYSIS_SUPPORT,
  productionEligible: false,
} satisfies FixtureWsgsAnalysisManifest);

export interface WsgsAnalysisPlanNode {
  readonly nodeId: string;
  readonly displayName: string;
  readonly phase:
    | "REFERENCE_GROUNDING"
    | "WORLD_STATE"
    | "WORLD_GEOMETRY"
    | "SPATIOTEMPORAL_QUERY"
    | "GEOSPATIAL_PRODUCT_QUERY"
    | "SPATIAL_COMPOSITION"
    | "RESULT_NORMALIZATION"
    | "EXPLANATION";
  readonly operationKey?: string;
  readonly dependencyNodeIds: readonly string[];
  readonly riskLevel:
    "READ_ONLY" | "REVERSIBLE" | "CONTROLLED" | "IRREVERSIBLE";
  readonly executionPolicy:
    | "AUTO_EXECUTE"
    | "AUTO_EXECUTE_WITH_NOTIFICATION"
    | "INTERRUPT_ON_AMBIGUITY"
    | "REQUIRE_APPROVAL";
  readonly cancellable: boolean;
  readonly toolInteraction?: ToolInteractionDescriptor;
  readonly inputMapArtifacts: readonly Readonly<Record<string, unknown>>[];
  readonly expectedOutputRoles: readonly string[];
}

export interface WsgsAnalysisPlanEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

/**
 * Stable SACS-side snapshot. The plan fields follow the provisional WSGS plan
 * contract; the run, scenario, and flattened identity fields are local adapter
 * metadata used to seed the development runtime deterministically.
 */
export interface WsgsAnalysisPlanSnapshot {
  readonly schemaVersion: "sacs-wsgs-analysis-plan/1.0";
  readonly upstreamAnalysisId: string;
  readonly upstreamRunId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly planRevision: number;
  readonly scenario: FixtureWsgsAnalysisScenario;
  readonly status: "RUNNING";
  readonly nodes: readonly WsgsAnalysisPlanNode[];
  readonly nodeIds: readonly string[];
  readonly edges: readonly WsgsAnalysisPlanEdge[];
  readonly toolInteractions: readonly ToolInteractionDescriptor[];
  readonly generatedAt: string;
}

export interface AnalysisPlanPort {
  getAnalysisSnapshot(groundingId: string): Promise<WsgsAnalysisPlanSnapshot>;
}

export interface AnalysisEventPort {
  subscribeAnalysisEvents(
    groundingId: string,
    afterSequence?: number,
  ): AsyncIterable<WsgsAnalysisEventEnvelope>;
}

export interface AnalysisRevisionCompilerPort {
  compileRevision(
    request: WsgsCompileRevisionRequest,
  ): Promise<WsgsCompileRevisionResult>;
}

export interface AnalysisCancelPort {
  cancelRun(request: WsgsCancelRequest): Promise<WsgsCancelResult>;
}

export interface AnalysisInterventionPort {
  resolveIntervention(
    request: WsgsInterventionResolutionRequest,
  ): Promise<WsgsInterventionResolutionResult>;
}

export interface WsgsAnalysisAdapter
  extends
    AnalysisPlanPort,
    AnalysisEventPort,
    AnalysisRevisionCompilerPort,
    AnalysisCancelPort,
    AnalysisInterventionPort {
  readonly productionEligible: boolean;
}

type FixtureCommand = Exclude<FixtureWsgsAnalysisCapability, "DATA_GAP">;

export interface FixtureWsgsAnalysisCounters {
  readonly commands: Readonly<Record<FixtureCommand, number>>;
  readonly executions: Readonly<Record<FixtureCommand, number>>;
  readonly eventDeliveries: number;
  readonly toolExecutions: number;
  readonly dataGapCompletions: number;
  readonly clientPublicArgsExecutions: 0;
}

export interface FixtureWsgsAnalysisAdapterOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly generatedAt?: string;
  readonly defaultScenario?: FixtureWsgsAnalysisScenario;
  readonly scenarios?: Readonly<Record<string, FixtureWsgsAnalysisScenario>>;
  readonly cancelSupported?: boolean;
}

export class WsgsAnalysisAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WsgsAnalysisAdapterError";
  }
}

interface MaterializedFixture {
  readonly snapshot: WsgsAnalysisPlanSnapshot;
  readonly events: readonly WsgsAnalysisEventEnvelope[];
  readonly interventionId?: string;
  readonly interruptId?: string;
  executed: boolean;
}

interface PlanLineage {
  readonly upstreamAnalysisId: string;
  readonly nodeIds: readonly string[];
}

interface IdempotentCompileResult {
  readonly requestHash: string;
  readonly result: WsgsCompileRevisionResult;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const dangerousJsonKeys = new Set(["__proto__", "constructor", "prototype"]);
const defaultGeneratedAt = "2026-09-05T00:00:00.000Z";
const maxJsonDepth = 32;
const maxJsonNodes = 10_000;

export class FixtureWsgsAnalysisAdapter implements WsgsAnalysisAdapter {
  static readonly productionEligible = false as const;
  static readonly supports = FIXTURE_WSGS_ANALYSIS_SUPPORT;
  static readonly manifest = FIXTURE_WSGS_ANALYSIS_MANIFEST;

  readonly productionEligible = false as const;
  readonly supports = FIXTURE_WSGS_ANALYSIS_SUPPORT;
  readonly manifest = FIXTURE_WSGS_ANALYSIS_MANIFEST;

  private readonly generatedAt: string;
  private readonly defaultScenario: FixtureWsgsAnalysisScenario;
  private readonly configuredScenarios = new Map<
    string,
    FixtureWsgsAnalysisScenario
  >();
  private readonly cancelSupported: boolean;
  private readonly fixtures = new Map<string, MaterializedFixture>();
  private readonly planLineages = new Map<string, PlanLineage>();
  private readonly compileCache = new Map<string, IdempotentCompileResult>();
  private readonly cancelCache = new Map<string, WsgsCancelResult>();
  private readonly interventionCache = new Map<
    string,
    WsgsInterventionResolutionResult
  >();
  private readonly commandCounts = emptyCommandCounts();
  private readonly executionCounts = emptyCommandCounts();
  private eventDeliveries = 0;
  private toolExecutions = 0;
  private dataGapCompletions = 0;

  constructor(options: FixtureWsgsAnalysisAdapterOptions = {}) {
    const environment = options.environment ?? process.env;
    if (
      !new Set(["test", "development"]).has(environment["NODE_ENV"] ?? "") ||
      environment["SACS_ANALYSIS_ADAPTER_MODE"] !== "fixture"
    ) {
      throw new WsgsAnalysisAdapterError(
        "FIXTURE_WSGS_ANALYSIS_ADAPTER_FORBIDDEN",
      );
    }

    this.generatedAt = options.generatedAt ?? defaultGeneratedAt;
    assertDateTime(this.generatedAt, "FIXTURE_GENERATED_AT_INVALID");
    this.defaultScenario = options.defaultScenario ?? "SUCCESS";
    assertScenario(this.defaultScenario);
    this.cancelSupported = options.cancelSupported ?? true;

    for (const [groundingId, scenario] of Object.entries(
      options.scenarios ?? {},
    )) {
      assertIdentifier(groundingId, "FIXTURE_GROUNDING_ID_INVALID");
      assertScenario(scenario);
      this.configuredScenarios.set(groundingId, scenario);
    }
  }

  /** Fixture-only control used before the stable PLAN port is invoked. */
  configureScenario(
    groundingId: string,
    scenario: FixtureWsgsAnalysisScenario,
  ): void {
    assertIdentifier(groundingId, "FIXTURE_GROUNDING_ID_INVALID");
    assertScenario(scenario);
    const materialized = this.fixtures.get(groundingId);
    if (materialized !== undefined) {
      if (materialized.snapshot.scenario === scenario) return;
      throw new WsgsAnalysisAdapterError(
        "FIXTURE_SCENARIO_ALREADY_MATERIALIZED",
      );
    }
    this.configuredScenarios.set(groundingId, scenario);
  }

  async getAnalysisSnapshot(
    groundingId: string,
  ): Promise<WsgsAnalysisPlanSnapshot> {
    this.commandCounts.PLAN += 1;
    return this.fixtureFor(groundingId).snapshot;
  }

  subscribeAnalysisEvents(
    groundingId: string,
    afterSequence?: number,
  ): AsyncIterable<WsgsAnalysisEventEnvelope> {
    this.commandCounts.EVENTS += 1;
    assertAfterSequence(afterSequence);
    const fixture = this.fixtureFor(groundingId);
    if (!fixture.executed) {
      fixture.executed = true;
      this.executionCounts.EVENTS += 1;
      this.toolExecutions += fixture.snapshot.scenario === "AMBIGUITY" ? 0 : 1;
      if (fixture.snapshot.scenario === "DATA_GAP") {
        this.dataGapCompletions += 1;
      }
    }
    const cursor = afterSequence ?? 0;
    const events = fixture.events.filter((event) => event.sequence > cursor);
    return this.deliver(events);
  }

  async compileRevision(
    request: WsgsCompileRevisionRequest,
  ): Promise<WsgsCompileRevisionResult> {
    this.commandCounts.COMPILE_REVISION += 1;
    const safeRequest = normalizeCompileRequest(request);
    const operationKey = calculateCanonicalJsonHash({
      analysisId: safeRequest.analysisId,
      commandId: safeRequest.commandId,
      idempotencyKey: safeRequest.idempotencyKey,
    });
    const commandKey = `command:${calculateCanonicalJsonHash({
      analysisId: safeRequest.analysisId,
      commandId: safeRequest.commandId,
    })}`;
    const idempotencyKey = `idempotency:${calculateCanonicalJsonHash({
      analysisId: safeRequest.analysisId,
      idempotencyKey: safeRequest.idempotencyKey,
    })}`;
    const requestHash = calculateCanonicalJsonHash(safeRequest);
    const cachedByCommand = this.compileCache.get(commandKey);
    const cachedByIdempotency = this.compileCache.get(idempotencyKey);
    if (cachedByCommand !== undefined || cachedByIdempotency !== undefined) {
      if (
        cachedByCommand === undefined ||
        cachedByIdempotency === undefined ||
        cachedByCommand !== cachedByIdempotency ||
        cachedByCommand.requestHash !== requestHash
      ) {
        throw new WsgsAnalysisAdapterError(
          "FIXTURE_COMPILE_IDEMPOTENCY_CONFLICT",
        );
      }
      return cachedByCommand.result;
    }

    const parentLineage = this.planLineages.get(
      planLineageKey(safeRequest.parentPlanId, safeRequest.parentPlanHash),
    );
    const nodeIds = parentLineage?.nodeIds ?? fixtureNodeIds;
    const revision = safeRequest.parentRevisionNumber + 1;
    const identityDigest = operationKey.slice("sha256:".length, 18);
    let planId = `fixture-plan-${identityDigest}-r${revision}`;
    if (planId === safeRequest.parentPlanId) planId += "-next";
    let planHash = calculateCanonicalJsonHash({
      adapter: "FixtureWsgsAnalysisAdapter",
      planId,
      parentPlanId: safeRequest.parentPlanId,
      parentPlanHash: safeRequest.parentPlanHash,
      revision,
      changedPaths: safeRequest.changedPaths,
      publicArgs: safeRequest.publicArgs,
      nodeIds,
    });
    if (planHash === safeRequest.parentPlanHash) {
      planHash = calculateCanonicalJsonHash({ planHash, next: true });
    }
    const result = deepFreeze({
      upstreamAnalysisId:
        parentLineage?.upstreamAnalysisId ??
        fixtureIdentity("analysis", safeRequest.analysisId),
      planId,
      planHash,
      planRevision: revision,
      parentPlanId: safeRequest.parentPlanId,
      parentPlanHash: safeRequest.parentPlanHash,
      nodeIds: [...nodeIds],
      reusedNodeIds: ["reference"],
      invalidatedNodeIds: [],
      rerunNodeIds: ["query", "explanation"],
    } satisfies WsgsCompileRevisionResult);
    const stored = { requestHash, result };
    this.compileCache.set(commandKey, stored);
    this.compileCache.set(idempotencyKey, stored);
    this.planLineages.set(planLineageKey(planId, planHash), {
      upstreamAnalysisId: result.upstreamAnalysisId,
      nodeIds: result.nodeIds,
    });
    this.executionCounts.COMPILE_REVISION += 1;
    return result;
  }

  async cancelRun(request: WsgsCancelRequest): Promise<WsgsCancelResult> {
    this.commandCounts.CANCEL += 1;
    const safeRequest = normalizeCancelRequest(request);
    const cacheKey = calculateCanonicalJsonHash(safeRequest);
    const cached = this.cancelCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result = deepFreeze({
      supported: this.cancelSupported,
      acknowledged: this.cancelSupported,
      upstreamRunId: safeRequest.upstreamRunId,
    } satisfies WsgsCancelResult);
    this.cancelCache.set(cacheKey, result);
    this.executionCounts.CANCEL += 1;
    return result;
  }

  async resolveIntervention(
    request: WsgsInterventionResolutionRequest,
  ): Promise<WsgsInterventionResolutionResult> {
    this.commandCounts.INTERVENTION += 1;
    const safeRequest = normalizeInterventionRequest(request);
    const fixture = [...this.fixtures.values()].find(
      (candidate) => candidate.interventionId === safeRequest.interventionId,
    );
    if (
      fixture === undefined ||
      fixture.interruptId !== safeRequest.interruptId
    ) {
      throw new WsgsAnalysisAdapterError("FIXTURE_INTERVENTION_NOT_FOUND");
    }
    const cacheKey = calculateCanonicalJsonHash(safeRequest);
    const cached = this.interventionCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result = deepFreeze({
      accepted: true,
      parentUpstreamRunId: fixture.snapshot.upstreamRunId,
      upstreamRunId: fixtureIdentity("run-resumed", cacheKey),
    } satisfies WsgsInterventionResolutionResult);
    this.interventionCache.set(cacheKey, result);
    this.executionCounts.INTERVENTION += 1;
    return result;
  }

  getCounters(): FixtureWsgsAnalysisCounters {
    return deepFreeze({
      commands: { ...this.commandCounts },
      executions: { ...this.executionCounts },
      eventDeliveries: this.eventDeliveries,
      toolExecutions: this.toolExecutions,
      dataGapCompletions: this.dataGapCompletions,
      clientPublicArgsExecutions: 0,
    });
  }

  private fixtureFor(groundingId: string): MaterializedFixture {
    assertIdentifier(groundingId, "FIXTURE_GROUNDING_ID_INVALID");
    const existing = this.fixtures.get(groundingId);
    if (existing !== undefined) return existing;
    const scenario =
      this.configuredScenarios.get(groundingId) ?? this.defaultScenario;
    const fixture = createFixture(groundingId, scenario, this.generatedAt);
    this.fixtures.set(groundingId, fixture);
    this.planLineages.set(
      planLineageKey(fixture.snapshot.planId, fixture.snapshot.planHash),
      {
        upstreamAnalysisId: fixture.snapshot.upstreamAnalysisId,
        nodeIds: fixture.snapshot.nodeIds,
      },
    );
    this.executionCounts.PLAN += 1;
    return fixture;
  }

  private async *deliver(
    events: readonly WsgsAnalysisEventEnvelope[],
  ): AsyncGenerator<WsgsAnalysisEventEnvelope> {
    for (const event of events) {
      this.eventDeliveries += 1;
      yield event;
    }
  }
}

export function createFixtureWsgsAnalysisAdapter(
  options: FixtureWsgsAnalysisAdapterOptions = {},
): FixtureWsgsAnalysisAdapter {
  return new FixtureWsgsAnalysisAdapter(options);
}

/**
 * Deliberately unavailable until WSGS publishes an authoritative analysis
 * consumer lock. Its constructor has no URL or route options so no provisional
 * route can accidentally become a production dependency.
 */
export class HttpWsgsAnalysisAdapter {
  static readonly availability = "UNAVAILABLE" as const;
  static readonly productionEligible = false as const;
  readonly availability = "UNAVAILABLE" as const;
  readonly productionEligible = false as const;

  constructor() {
    throw new WsgsAnalysisAdapterError(WSGS_ANALYSIS_HANDOFF_NOT_READY);
  }
}

export function createHttpWsgsAnalysisAdapter(): never {
  throw new WsgsAnalysisAdapterError(WSGS_ANALYSIS_HANDOFF_NOT_READY);
}

const fixtureNodeIds = ["reference", "query", "explanation"] as const;

function createFixture(
  groundingId: string,
  scenario: FixtureWsgsAnalysisScenario,
  generatedAt: string,
): MaterializedFixture {
  const upstreamAnalysisId = fixtureIdentity("analysis", groundingId);
  const upstreamRunId = fixtureIdentity("run", groundingId);
  const identity = calculateCanonicalJsonHash({ groundingId, scenario });
  const suffix = identity.slice("sha256:".length, 18);
  const planId = `fixture-plan-${suffix}-r0`;
  const toolInteraction = createToolInteraction(suffix);
  const nodes: readonly WsgsAnalysisPlanNode[] = [
    {
      nodeId: "reference",
      displayName: "Resolve reference",
      phase: "REFERENCE_GROUNDING",
      operationKey: "fixture.reference.resolve",
      dependencyNodeIds: [],
      riskLevel: "READ_ONLY",
      executionPolicy: "INTERRUPT_ON_AMBIGUITY",
      cancellable: true,
      inputMapArtifacts: [],
      expectedOutputRoles: ["RESOLVED_REFERENCE"],
    },
    {
      nodeId: "query",
      displayName: "Query geospatial product",
      phase: "GEOSPATIAL_PRODUCT_QUERY",
      operationKey: toolInteraction.operationKey,
      dependencyNodeIds: ["reference"],
      riskLevel: "READ_ONLY",
      executionPolicy: "AUTO_EXECUTE",
      cancellable: true,
      toolInteraction,
      inputMapArtifacts: [],
      expectedOutputRoles: ["GEOSPATIAL_FINDING"],
    },
    {
      nodeId: "explanation",
      displayName: "Explain published result",
      phase: "EXPLANATION",
      operationKey: "fixture.explanation.render",
      dependencyNodeIds: ["query"],
      riskLevel: "READ_ONLY",
      executionPolicy: "AUTO_EXECUTE",
      cancellable: true,
      inputMapArtifacts: [],
      expectedOutputRoles: ["QUALIFIED_EXPLANATION"],
    },
  ];
  const edges: readonly WsgsAnalysisPlanEdge[] = [
    { fromNodeId: "reference", toNodeId: "query" },
    { fromNodeId: "query", toNodeId: "explanation" },
  ];
  const planHash = calculateCanonicalJsonHash({
    schemaVersion: "sacs-wsgs-analysis-plan/1.0",
    upstreamAnalysisId,
    planId,
    planRevision: 0,
    nodes,
    edges,
    generatedAt,
  });
  const snapshot = deepFreeze({
    schemaVersion: "sacs-wsgs-analysis-plan/1.0",
    upstreamAnalysisId,
    upstreamRunId,
    planId,
    planHash,
    planRevision: 0,
    scenario,
    status: "RUNNING",
    nodes,
    nodeIds: [...fixtureNodeIds],
    edges,
    toolInteractions: [toolInteraction],
    generatedAt,
  } satisfies WsgsAnalysisPlanSnapshot);
  const interventionId =
    scenario === "AMBIGUITY" ? `fixture-intervention-${suffix}` : undefined;
  const interruptId =
    scenario === "AMBIGUITY" ? `fixture-interrupt-${suffix}` : undefined;
  const events = createFixtureEvents(snapshot, interventionId, interruptId);
  return {
    snapshot,
    events,
    interventionId,
    interruptId,
    executed: false,
  };
}

function createToolInteraction(suffix: string): ToolInteractionDescriptor {
  const publicArgs = { radiusMeters: 500, relation: "near" };
  const publicEditSchema = {
    type: "object",
    additionalProperties: false,
    required: ["radiusMeters", "relation"],
    properties: {
      radiusMeters: { type: "number", minimum: 1, maximum: 10_000 },
      relation: { enum: ["near", "within"] },
    },
  };
  return deepFreeze(
    toolInteractionDescriptorSchema.parse({
      schemaVersion: "sacs-wsgs-tool-interaction/1.0",
      toolCallId: `fixture-tool-${suffix}`,
      nodeId: "query",
      operationKey: "fixture.geospatial.query",
      executionArgsHash: calculateCanonicalJsonHash({
        providerBinding: "fixture.read-only",
        operation: "fixture.geospatial.query",
        serverOwned: true,
      }),
      publicArgs,
      publicArgsHash: calculateCanonicalJsonHash(publicArgs),
      publicEditSchemaUri: "urn:sacs:fixture:wsgs-analysis-public-edit:1.0",
      publicEditSchemaHash: calculateCanonicalJsonHash(publicEditSchema),
      editablePaths: ["/radiusMeters", "/relation"],
      editorHints: [
        {
          path: "/radiusMeters",
          editor: "MAP_RADIUS",
          unit: "m",
          minimum: 1,
          maximum: 10_000,
        },
        { path: "/relation", editor: "ENUM_MULTISELECT" },
      ],
      editSemantics: "CHANGE_CONSTRAINT",
      editPolicy: "SUGGEST_NEXT_REVISION",
    }),
  );
}

function createFixtureEvents(
  snapshot: WsgsAnalysisPlanSnapshot,
  interventionId?: string,
  interruptId?: string,
): readonly WsgsAnalysisEventEnvelope[] {
  const planPayload = {
    plan: {
      upstreamAnalysisId: snapshot.upstreamAnalysisId,
      planId: snapshot.planId,
      planHash: snapshot.planHash,
      planRevision: snapshot.planRevision,
      nodeIds: snapshot.nodeIds,
      generatedAt: snapshot.generatedAt,
    },
    upstreamRunId: snapshot.upstreamRunId,
  };
  const specs: readonly EventSpec[] =
    snapshot.scenario === "AMBIGUITY"
      ? [
          { eventType: "PLAN_PUBLISHED", payload: planPayload },
          {
            eventType: "NODE_READY",
            nodeId: "reference",
            payload: { executionStatus: "READY" },
          },
          {
            eventType: "NODE_STARTED",
            nodeId: "reference",
            payload: { executionStatus: "RUNNING" },
          },
          {
            eventType: "INTERVENTION_REQUIRED",
            nodeId: "reference",
            payload: {
              interventionId,
              interruptId,
              reason: "AMBIGUITY",
              requestPayload: {
                candidateIds: ["fixture-candidate-a", "fixture-candidate-b"],
                selectionRequired: true,
              },
            },
          },
        ]
      : snapshot.scenario === "DATA_GAP"
        ? [
            { eventType: "PLAN_PUBLISHED", payload: planPayload },
            {
              eventType: "NODE_READY",
              nodeId: "query",
              payload: { executionStatus: "READY" },
            },
            {
              eventType: "NODE_STARTED",
              nodeId: "query",
              payload: { executionStatus: "RUNNING" },
            },
            {
              eventType: "TOOL_INTERACTION_PUBLISHED",
              nodeId: "query",
              payload: { toolInteraction: snapshot.toolInteractions[0] },
            },
            {
              eventType: "TOOL_COMPLETED",
              nodeId: "query",
              payload: { upstreamStatus: "NO_DATA" },
            },
            {
              eventType: "FINDING_AVAILABLE",
              nodeId: "query",
              payload: {
                finding: {
                  status: "NO_DATA",
                  gapKind: "DATA_GAP",
                  reasonCode: "PRODUCT_NOT_AVAILABLE",
                  truthValue: "UNKNOWN",
                  falseClaimPrevented: true,
                },
              },
            },
            {
              eventType: "ANALYSIS_COMPLETED",
              payload: {
                status: "PARTIAL",
                terminalGap: "DATA_GAP",
                truthValue: "UNKNOWN",
                interruptRequired: false,
              },
            },
          ]
        : [
            { eventType: "PLAN_PUBLISHED", payload: planPayload },
            {
              eventType: "NODE_READY",
              nodeId: "reference",
              payload: { executionStatus: "READY" },
            },
            {
              eventType: "NODE_STARTED",
              nodeId: "reference",
              payload: { executionStatus: "RUNNING" },
            },
            {
              eventType: "NODE_READY",
              nodeId: "query",
              payload: { executionStatus: "READY" },
            },
            {
              eventType: "NODE_STARTED",
              nodeId: "query",
              payload: { executionStatus: "RUNNING" },
            },
            {
              eventType: "TOOL_INTERACTION_PUBLISHED",
              nodeId: "query",
              payload: { toolInteraction: snapshot.toolInteractions[0] },
            },
            {
              eventType: "TOOL_COMPLETED",
              nodeId: "query",
              payload: { upstreamStatus: "COMPLETED" },
            },
            {
              eventType: "FINDING_AVAILABLE",
              nodeId: "query",
              payload: {
                finding: {
                  status: "COMPLETED",
                  findingId: `fixture-finding-${snapshot.planId}`,
                  summary: "Fixture geospatial result is available.",
                },
              },
            },
            {
              eventType: "ANALYSIS_COMPLETED",
              payload: {
                status: "SUCCEEDED",
                terminalGap: null,
                interruptRequired: false,
              },
            },
          ];
  return deepFreeze(
    specs.map((spec, index) => createEvent(snapshot, index + 1, spec)),
  );
}

interface EventSpec {
  readonly eventType: WsgsAnalysisEventEnvelope["eventType"];
  readonly nodeId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function createEvent(
  snapshot: WsgsAnalysisPlanSnapshot,
  sequence: number,
  spec: EventSpec,
): WsgsAnalysisEventEnvelope {
  const payload = spec.payload;
  return deepFreeze(
    parseWsgsAnalysisEventEnvelope({
      schemaVersion: "sacs-wsgs-analysis-event/1.0",
      eventId: `${snapshot.planId}-event-${sequence}`,
      upstreamAnalysisId: snapshot.upstreamAnalysisId,
      planId: snapshot.planId,
      planHash: snapshot.planHash,
      planRevision: snapshot.planRevision,
      sequence,
      eventType: spec.eventType,
      ...(spec.nodeId === undefined ? {} : { nodeId: spec.nodeId }),
      correlationId: snapshot.upstreamRunId,
      occurredAt: offsetDateTime(snapshot.generatedAt, sequence),
      payload,
      payloadHash: calculateCanonicalJsonHash(payload),
    }),
  );
}

function normalizeCompileRequest(
  request: WsgsCompileRevisionRequest,
): Readonly<{
  analysisId: string;
  commandId: string;
  idempotencyKey: string;
  parentPlanId: string;
  parentPlanHash: string;
  parentRevisionNumber: number;
  changedPaths: readonly string[];
  publicArgs: JsonObject;
}> {
  assertIdentifier(request.analysisId, "FIXTURE_ANALYSIS_ID_INVALID");
  assertIdentifier(request.commandId, "FIXTURE_COMMAND_ID_INVALID");
  assertIdempotencyKey(request.idempotencyKey);
  assertIdentifier(request.parentPlanId, "FIXTURE_PARENT_PLAN_ID_INVALID");
  if (!sha256Pattern.test(request.parentPlanHash)) {
    throw new WsgsAnalysisAdapterError("FIXTURE_PARENT_PLAN_HASH_INVALID");
  }
  if (
    !Number.isSafeInteger(request.parentRevisionNumber) ||
    request.parentRevisionNumber < 0
  ) {
    throw new WsgsAnalysisAdapterError("FIXTURE_PARENT_REVISION_INVALID");
  }
  if (
    request.changedPaths.length === 0 ||
    request.changedPaths.length > 128 ||
    new Set(request.changedPaths).size !== request.changedPaths.length ||
    request.changedPaths.some(
      (path) =>
        typeof path !== "string" ||
        path.length > 1_024 ||
        !path.startsWith("/"),
    )
  ) {
    throw new WsgsAnalysisAdapterError("FIXTURE_CHANGED_PATHS_INVALID");
  }
  return deepFreeze({
    analysisId: request.analysisId,
    commandId: request.commandId,
    idempotencyKey: request.idempotencyKey,
    parentPlanId: request.parentPlanId,
    parentPlanHash: request.parentPlanHash,
    parentRevisionNumber: request.parentRevisionNumber,
    changedPaths: [...request.changedPaths],
    publicArgs: copySafeJsonObject(
      request.publicArgs,
      "FIXTURE_PUBLIC_ARGS_INVALID",
    ),
  });
}

function normalizeCancelRequest(
  request: WsgsCancelRequest,
): Readonly<WsgsCancelRequest> {
  assertIdentifier(request.analysisId, "FIXTURE_ANALYSIS_ID_INVALID");
  assertIdentifier(request.revisionId, "FIXTURE_REVISION_ID_INVALID");
  assertIdentifier(request.upstreamRunId, "FIXTURE_UPSTREAM_RUN_ID_INVALID");
  assertIdentifier(request.commandId, "FIXTURE_COMMAND_ID_INVALID");
  assertIdempotencyKey(request.idempotencyKey);
  if (!new Set(["USER_REQUESTED", "REVISION_RESTART"]).has(request.reason)) {
    throw new WsgsAnalysisAdapterError("FIXTURE_CANCEL_REASON_INVALID");
  }
  return deepFreeze({ ...request });
}

function normalizeInterventionRequest(
  request: WsgsInterventionResolutionRequest,
): Readonly<{
  analysisId: string;
  interventionId: string;
  interruptId: string;
  commandId: string;
  idempotencyKey: string;
  response: JsonObject;
}> {
  assertIdentifier(request.analysisId, "FIXTURE_ANALYSIS_ID_INVALID");
  assertIdentifier(request.interventionId, "FIXTURE_INTERVENTION_ID_INVALID");
  assertIdentifier(request.interruptId, "FIXTURE_INTERRUPT_ID_INVALID");
  assertIdentifier(request.commandId, "FIXTURE_COMMAND_ID_INVALID");
  assertIdempotencyKey(request.idempotencyKey);
  return deepFreeze({
    analysisId: request.analysisId,
    interventionId: request.interventionId,
    interruptId: request.interruptId,
    commandId: request.commandId,
    idempotencyKey: request.idempotencyKey,
    response: copySafeJsonObject(
      request.response,
      "FIXTURE_INTERVENTION_RESPONSE_INVALID",
    ),
  });
}

function copySafeJsonObject(value: unknown, code: string): JsonObject {
  const budget = { nodes: 0 };
  const copied = copySafeJsonValue(value, code, budget, new Set(), 0);
  if (copied === null || Array.isArray(copied) || typeof copied !== "object") {
    throw new WsgsAnalysisAdapterError(code);
  }
  if (
    Buffer.byteLength(JSON.stringify(copied), "utf8") >
    ANALYSIS_MAX_PUBLIC_ARGS_BYTES
  ) {
    throw new WsgsAnalysisAdapterError(code);
  }
  return copied;
}

function copySafeJsonValue(
  value: unknown,
  code: string,
  budget: { nodes: number },
  ancestors: Set<object>,
  depth: number,
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > maxJsonNodes || depth > maxJsonDepth) {
    throw new WsgsAnalysisAdapterError(code);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WsgsAnalysisAdapterError(code);
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) {
    throw new WsgsAnalysisAdapterError(code);
  }
  if (ancestors.has(value)) throw new WsgsAnalysisAdapterError(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)),
        )
      ) {
        throw new WsgsAnalysisAdapterError(code);
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new WsgsAnalysisAdapterError(code);
        }
        result.push(
          copySafeJsonValue(
            descriptor.value,
            code,
            budget,
            ancestors,
            depth + 1,
          ),
        );
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WsgsAnalysisAdapterError(code);
    }
    const result: JsonObject = Object.create(null) as JsonObject;
    for (const key of Reflect.ownKeys(value)) {
      if (
        typeof key !== "string" ||
        dangerousJsonKeys.has(key) ||
        key.length > 1_024
      ) {
        throw new WsgsAnalysisAdapterError(code);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new WsgsAnalysisAdapterError(code);
      }
      result[key] = copySafeJsonValue(
        descriptor.value,
        code,
        budget,
        ancestors,
        depth + 1,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function fixtureIdentity(kind: string, seed: string): string {
  return `fixture-${kind}-${calculateCanonicalJsonHash(seed).slice(7, 23)}`;
}

function planLineageKey(planId: string, planHash: string): string {
  return `${planId}\u0000${planHash}`;
}

function emptyCommandCounts(): Record<FixtureCommand, number> {
  return {
    PLAN: 0,
    EVENTS: 0,
    COMPILE_REVISION: 0,
    CANCEL: 0,
    INTERVENTION: 0,
  };
}

function assertScenario(
  value: unknown,
): asserts value is FixtureWsgsAnalysisScenario {
  if (
    typeof value !== "string" ||
    !FIXTURE_WSGS_ANALYSIS_SCENARIOS.includes(
      value as FixtureWsgsAnalysisScenario,
    )
  ) {
    throw new WsgsAnalysisAdapterError("FIXTURE_SCENARIO_INVALID");
  }
}

function assertIdentifier(
  value: unknown,
  code: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    !identifierPattern.test(value)
  ) {
    throw new WsgsAnalysisAdapterError(code);
  }
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new WsgsAnalysisAdapterError("FIXTURE_IDEMPOTENCY_KEY_INVALID");
  }
}

function assertDateTime(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new WsgsAnalysisAdapterError(code);
  }
}

function assertAfterSequence(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new WsgsAnalysisAdapterError("FIXTURE_EVENT_CURSOR_INVALID");
  }
}

function offsetDateTime(base: string, milliseconds: number): string {
  return new Date(Date.parse(base) + milliseconds).toISOString();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
