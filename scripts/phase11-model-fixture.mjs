import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PHASE11_MODEL_PORT ?? "18001", 10);
const logPath = process.env.PHASE11_MODEL_LOG_PATH;

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    void handle(
      request.url ?? "",
      Buffer.concat(chunks).toString("utf8"),
      response,
    );
  });
});

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "phase11.model.ready", host, port })}\n`,
  );
});

async function handle(path, rawBody, response) {
  response.setHeader("content-type", "application/json");
  const body = JSON.parse(rawBody);
  if (path.endsWith("/embeddings")) {
    record("embedding");
    response.end(
      JSON.stringify({
        model: "phase11-model",
        data: [{ embedding: [1, 0, 0] }],
      }),
    );
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contents = messages.map((message) => String(message.content ?? ""));
  const operation = detectOperation(contents);
  record(operation);

  if (contents.some((content) => content.includes("PHASE11_DELAY_NODE"))) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    respond(response, { status: "online" });
    return;
  }

  switch (operation) {
    case "decide_task_intent":
      respond(response, {
        intent: "execute",
        summary: "The request requires SDAR execution.",
      });
      return;
    case "formulate_goal": {
      const input = embeddedOperation(contents, operation);
      const requestText = String(input.requestText ?? "");
      const inputRequired =
        /phase11 input required/iu.test(requestText) &&
        !/device-17/iu.test(requestText);
      const description = /phase11 capability gap/iu.test(requestText)
        ? "PHASE11_CAPABILITY_GAP TEMPORARY_SKILL_GOAL:mcp.phase11/device_status"
        : /phase11 delay/iu.test(requestText)
          ? "PHASE11_DELAY TEMPORARY_SKILL_GOAL:mcp.phase11/device_status"
          : "PHASE11_NORMAL TEMPORARY_SKILL_GOAL:mcp.phase11/device_status";
      respond(response, {
        title: "Phase 11 real A2A task",
        description,
        constraints: [],
        successCriteria: ["Return a validated result."],
        requiresInput: inputRequired,
        ...(inputRequired
          ? { clarificationQuestion: "Which device should be inspected?" }
          : {}),
      });
      return;
    }
    case "plan_user_goal_skill_goal_dag": {
      const input = embeddedOperation(contents, operation);
      const criteria = Array.isArray(input.contract?.criteria)
        ? input.contract.criteria
        : [];
      respond(response, {
        skillGoals: [
          {
            skillGoalId: `skill-goal-${String(input.contract?.goalId ?? "unknown")}`,
            requiredResult: "Return a validated device status.",
            capabilityNeeds: ["phase11-status"],
            coveredCriterionIds: criteria.map(
              (criterion) => criterion.criterionId,
            ),
            requiredEffectRefs: criteria.flatMap(
              (criterion) => criterion.expectedEffectRefs ?? [],
            ),
            evidenceRequirements: criteria.flatMap(
              (criterion) => criterion.evidenceRequirements ?? [],
            ),
            artifactRequirements: criteria.flatMap(
              (criterion) => criterion.artifactRequirements ?? [],
            ),
            assumptions: [],
            constraints: [],
          },
        ],
        dependencies: [],
      });
      return;
    }
    case "infer_missing_goal_input":
      {
        const input = embeddedOperation(contents, operation);
        const requestText = String(input.requestText ?? "");
        if (!/device-17/iu.test(requestText)) {
          respond(response, {
            outcome: "input_required",
            decisionSummary:
              "Available evidence does not identify the requested device.",
            usedSourceIds: [],
            clarificationQuestion: "Which device should be inspected?",
          });
          return;
        }
        const source = Array.isArray(input.evidence)
          ? input.evidence.find((candidate) =>
              JSON.stringify(candidate).includes("device-17"),
            )
          : undefined;
        if (source?.sourceId === undefined)
          throw new Error("PHASE11_INPUT_EVIDENCE_MISSING");
        respond(response, {
          outcome: "inferred",
          decisionSummary: "The supplied answer identifies device-17.",
          usedSourceIds: [source.sourceId],
          inferredGoal: {
            title: "Phase 11 supplied-input task",
            description:
              "PHASE11_NORMAL TEMPORARY_SKILL_GOAL:mcp.phase11/device_status device-17",
            constraints: [],
            successCriteria: ["Return a validated result."],
          },
        });
      }
      return;
    case "enhance_mcp_tool_metadata":
      respond(response, {
        purpose:
          "Read deterministic device status through the registered MCP Tool.",
        scenarios: ["Phase 11 real SDAR acceptance"],
        constraints: ["Use the declared input schema."],
        returnDescription: "The current device status.",
        commonErrors: ["MCP transport unavailable"],
        tags: ["phase11", "mcp"],
      });
      return;
    case "resolve_temporary_skill": {
      const input = embeddedOperation(contents, operation);
      const requested = /TEMPORARY_SKILL_GOAL:([^/\s]+)\/([^\s]+)/u.exec(
        String(input.goalContract?.description ?? ""),
      );
      const selected = Array.isArray(input.tools)
        ? input.tools.find(
            (tool) =>
              tool.serverId === requested?.[1] &&
              tool.toolName === requested?.[2],
          )
        : undefined;
      if (selected === undefined)
        throw new Error("PHASE11_TEMPORARY_TOOL_MISSING");
      respond(response, {
        serverId: selected.serverId,
        toolName: selected.toolName,
        name: "Phase 11 task-scoped device status",
        description: "Use the registered device Tool for this Task only.",
        outputSchema: { type: "object" },
        decisionSummary:
          "The registered MCP Tool closes the task capability gap.",
      });
      return;
    }
    case "select_skill": {
      const input = embeddedOperation(contents, operation);
      const candidates = Array.isArray(input.candidates)
        ? input.candidates
        : [];
      const selected =
        candidates.find(
          (candidate) => candidate.skillId === "skill.phase11.literal",
        ) ?? candidates[0];
      if (selected === undefined)
        throw new Error("PHASE11_SKILL_CANDIDATE_MISSING");
      respond(response, {
        selectedSkillId: selected.skillId,
        decisionSummary: "Selected the Phase 11 deterministic Skill.",
      });
      return;
    }
    case "resolve_top_level_skill_input":
      respond(response, {
        structuredInput: {},
        unresolvedFields: [],
        sourceRefs: ["phase11:request"],
        decisionSummary: "The Phase 11 Skill requires no structured input.",
      });
      return;
    case "plan_with_skill_usage_policy": {
      const input = embeddedOperation(contents, operation);
      const identity = input.workflowIdentity;
      const delayed = String(input.goalContract?.description ?? "").includes(
        "PHASE11_DELAY",
      );
      respond(response, {
        ...identity,
        entryNodeId: "device",
        exitNodeIds: ["result"],
        nodes: [
          {
            nodeId: "device",
            name: "Read device status",
            type: "mcp_tool",
            tool: { serverId: "mcp.phase11", toolName: "device_status" },
            arguments: {
              deviceId: "device-17",
              ...(delayed ? { delayMs: 300 } : {}),
            },
          },
          {
            nodeId: "result",
            name: "Return governed result",
            type: "result",
            value: {
              op: "ref",
              path: ["nodes", "device", "data", "structuredContent"],
            },
          },
        ],
        edges: [{ sourceNodeId: "device", targetNodeId: "result" }],
      });
      return;
    }
    case "task_initial_plan": {
      const input = embeddedOperation(contents, operation);
      const identity = input.workflowIdentity;
      const delayed = String(input.goalDescription ?? "").includes(
        "PHASE11_DELAY",
      );
      respond(response, {
        ...identity,
        entryNodeId: delayed ? "slow" : "result",
        exitNodeIds: ["result"],
        nodes: delayed
          ? [
              {
                nodeId: "slow",
                name: "Current MCP call",
                type: "mcp_tool",
                tool: { serverId: "mcp.phase11", toolName: "device_status" },
                arguments: { deviceId: "first", delayMs: 300 },
              },
              {
                nodeId: "next",
                name: "Next MCP call",
                type: "mcp_tool",
                tool: { serverId: "mcp.phase11", toolName: "device_status" },
                arguments: { deviceId: "second" },
              },
              {
                nodeId: "result",
                name: "Return delayed result",
                type: "result",
                value: { op: "literal", value: "controlled" },
              },
            ]
          : [
              {
                nodeId: "result",
                name: "Return Phase 11 result",
                type: "result",
                value: { op: "literal", value: "online" },
              },
            ],
        edges: delayed
          ? [
              { sourceNodeId: "slow", targetNodeId: "next" },
              { sourceNodeId: "next", targetNodeId: "result" },
            ]
          : [],
      });
      return;
    }
    case "natural_language_plan_revision": {
      const input = embeddedOperation(contents, operation);
      const source = input.sourceDefinition;
      respond(response, {
        ...source,
        version: Number(source.version) + 1,
        entryNodeId: "result",
        exitNodeIds: ["result"],
        nodes: [
          {
            nodeId: "result",
            name: "Return revised Phase 11 result",
            type: "result",
            value: { op: "literal", value: "online" },
          },
        ],
        edges: [],
      });
      return;
    }
    case "process_workflow_result":
      respond(response, {
        text: "Device is online.",
        structured: { status: "online" },
        keyFacts: [{ name: "status", value: "online", confidence: 1 }],
        valueAssessment: {
          valuable: true,
          summary: "The real SDAR result is useful.",
        },
        memoryCandidates: [],
      });
      return;
    case "evaluate_goal":
    case "goal_evaluation":
    case "unknown": {
      if (
        contents.some((content) => content.includes('"workflow":{"instanceId"'))
      ) {
        if (
          contents.some((content) => content.includes("PHASE11_CAPABILITY_GAP"))
        ) {
          respond(response, {
            decision: "capability_gap",
            summary: "No registered capability can read Phase 11 pressure.",
            missingCapability: "Read Phase 11 device pressure.",
            suggestedToolContract: {
              name: "read_pressure",
              description: "Read pressure for one device.",
              inputSchema: { type: "object", required: ["deviceId"] },
            },
          });
        } else {
          respond(response, {
            decision: "achieved",
            summary: "The real SDAR result satisfies the Goal.",
          });
        }
        return;
      }
      respond(response, generatedSkillMetadata());
      return;
    }
    case "refine_memory": {
      const input = embeddedOperation(contents, operation);
      const candidate = input.candidate;
      const dynamicState = /(?:online|battery|coordinate|occupancy)/iu.test(
        String(candidate.summary ?? ""),
      );
      respond(response, {
        type: candidate.type,
        content: candidate.content,
        summary: candidate.summary,
        confidence: candidate.confidence,
        durability: dynamicState ? "volatile" : "durable",
        authority: dynamicState ? "mcp" : candidate.authorityHint,
        durabilityReason: dynamicState
          ? "Current device state changes and must be queried again."
          : "The capability finding is stable and reusable across tasks.",
      });
      return;
    }
    case "evaluate_task_component":
      respond(response, {
        score: 0.9,
        summary: "Phase 11 evidence satisfies the quality policy.",
        findings: ["The evidence is consistent."],
        evidenceRefs: ["phase11:real-sdar"],
      });
      return;
    case "decide_goal_continuity":
      respond(response, {
        relationship: "new_goal",
        decisionSummary: "Each Phase 11 scenario uses an independent Goal.",
      });
      return;
    case "decide_execution_exception":
      respond(response, {
        strategy: "continue",
        summary: "Continue through the typed error boundary.",
      });
      return;
    default:
      respond(response, generatedSkillMetadata());
  }
}

function detectOperation(contents) {
  const operations = [
    "decide_task_intent",
    "formulate_goal",
    "plan_user_goal_skill_goal_dag",
    "infer_missing_goal_input",
    "enhance_mcp_tool_metadata",
    "resolve_temporary_skill",
    "select_skill",
    "resolve_top_level_skill_input",
    "plan_with_skill_usage_policy",
    "task_initial_plan",
    "natural_language_plan_revision",
    "process_workflow_result",
    "refine_memory",
    "evaluate_task_component",
    "decide_goal_continuity",
    "decide_execution_exception",
    "evaluate_goal",
    "goal_evaluation",
  ];
  return (
    operations.find((operation) =>
      contents.some((content) => content.includes(operation)),
    ) ?? "unknown"
  );
}

function embeddedOperation(contents, operation) {
  const content = contents.find((candidate) =>
    candidate.includes(`"operation":"${operation}"`),
  );
  const start = content?.indexOf('{"operation":') ?? -1;
  if (content === undefined || start < 0)
    throw new Error(`PHASE11_MODEL_OPERATION_MISSING:${operation}`);
  return JSON.parse(content.slice(start));
}

function generatedSkillMetadata() {
  return {
    name: "Phase 11 deterministic Skill",
    summary: "Return a bounded status result.",
    description: "A test-only Skill for the real SDAR vertical slice.",
    capabilities: ["phase11-status"],
    workflowGuidance: "Return the validated status.",
    outputInstruction: "Return status only.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: { status: { type: "string" } },
    },
  };
}

function respond(response, content) {
  response.end(
    JSON.stringify({
      id: "phase11-structured-response",
      model: "phase11-model",
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
}

function record(operation) {
  if (logPath === undefined) return;
  appendFileSync(
    logPath,
    `${JSON.stringify({ at: new Date().toISOString(), operation })}\n`,
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
