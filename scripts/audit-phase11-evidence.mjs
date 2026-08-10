import process from "node:process";

import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.PHASE11_DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("PHASE11_DATABASE_URL is required");
}

const pool = new Pool({ connectionString, max: 1 });
try {
  const bindings = await pool.query(
    `SELECT t.openwebui_chat_id,t.user_id,b.sdar_task_id,b.status
       FROM chat_service.chat_thread_binding t
       LEFT JOIN chat_service.conversation_task_binding b ON b.thread_id=t.thread_id
      WHERE t.openwebui_chat_id=ANY($1::text[])
      ORDER BY t.openwebui_chat_id,t.user_id`,
    [
      [
        "phase11-openwebui-normal-chat",
        "phase11-openwebui-task-chat",
        "p11-reject",
        "p11-revise",
        "p11-input-v2",
        "p11-pause-v2",
        "p11-cancel",
        "p11-gap-v2",
        "p11-restart-chat",
        "p11-isolation-shared-v2",
        "p11-utility-chat",
      ],
    ],
  );
  const byChat = Map.groupBy(bindings.rows, (row) => row.openwebui_chat_id);

  assertNoTask(byChat, "phase11-openwebui-normal-chat");
  assertNoTask(byChat, "p11-utility-chat");
  assertStatus(byChat, "phase11-openwebui-task-chat", "COMPLETED");
  assertStatus(byChat, "p11-reject", "CANCELED");
  assertStatus(byChat, "p11-revise", "COMPLETED");
  assertStatus(byChat, "p11-input-v2", "COMPLETED");
  assertStatus(byChat, "p11-pause-v2", "COMPLETED");
  assertStatus(byChat, "p11-cancel", "CANCELED");
  assertStatus(byChat, "p11-gap-v2", "FAILED");
  assertStatus(byChat, "p11-restart-chat", "COMPLETED");

  const isolation = byChat.get("p11-isolation-shared-v2") ?? [];
  assert(isolation.length === 2, "Cross-user chat must map to two threads");
  assert(
    isolation.filter((row) => row.sdar_task_id !== null).length === 1,
    "Only the task owner may have a binding",
  );

  const events = await pool.query(
    `SELECT t.openwebui_chat_id,e.event_kind,e.status,e.summary_json
       FROM chat_service.chat_thread_binding t
       JOIN chat_service.conversation_task_binding b ON b.thread_id=t.thread_id
       JOIN chat_service.a2a_event_cache e ON e.task_id=b.sdar_task_id
      WHERE t.openwebui_chat_id=ANY($1::text[])
      ORDER BY t.openwebui_chat_id,e.received_at`,
    [
      [
        "phase11-openwebui-task-chat",
        "p11-input-v2",
        "p11-pause-v2",
        "p11-gap-v2",
      ],
    ],
  );
  const eventMap = Map.groupBy(events.rows, (row) => row.openwebui_chat_id);

  const primary = eventMap.get("phase11-openwebui-task-chat") ?? [];
  assertPhase(primary, "awaiting_plan_confirmation");
  assertPhase(primary, "completed");
  const completed = primary.find(
    (event) => event.event_kind === "task" && event.status === "COMPLETED",
  );
  const artifact = completed?.summary_json?.artifacts?.[0];
  assert(
    artifact?.parts?.some((part) => part.text === "Device is online."),
    "Completed Task must contain the published text artifact",
  );
  assert(
    artifact?.parts?.some((part) => part.data?.status === "online"),
    "Completed Task must contain the published JSON artifact",
  );

  const input = eventMap.get("p11-input-v2") ?? [];
  assertPhase(input, "awaiting_user_input");
  assertPhase(input, "awaiting_plan_confirmation");
  assertPhase(input, "completed");

  const paused = eventMap.get("p11-pause-v2") ?? [];
  assertPhase(paused, "paused");
  assertPhase(paused, "completed");

  const gap = eventMap.get("p11-gap-v2") ?? [];
  const gapTask = gap.find(
    (event) => event.event_kind === "task" && event.status === "FAILED",
  );
  assert(
    gapTask?.summary_json?.internalPhase === "capability_gap" &&
      gapTask.summary_json?.capabilityGap?.missingCapability ===
        "Read Phase 11 device pressure.",
    "Failed Task must preserve the published Capability Gap",
  );

  const enrichedBoundary = primary.some(
    (event, index) =>
      event.event_kind === "status" &&
      event.status === "INPUT_REQUIRED" &&
      primary
        .slice(index + 1)
        .some(
          (next) =>
            next.event_kind === "task" &&
            next.status === "INPUT_REQUIRED" &&
            next.summary_json?.internalPhase === "awaiting_plan_confirmation",
        ),
  );
  assert(
    enrichedBoundary,
    "Bounded status boundary must be enriched by a persisted getTask observation",
  );

  const idempotency = await pool.query(
    `SELECT count(*)::int AS claim_count,
            count(DISTINCT result_task_id)::int AS task_count
       FROM chat_service.request_idempotency
      WHERE openwebui_chat_id='phase11-openwebui-task-chat'
        AND idempotency_key='phase11-owui-task-user-1'
        AND status='COMPLETED'`,
  );
  assert(
    idempotency.rows[0]?.claim_count === 1 &&
      idempotency.rows[0]?.task_count === 1,
    "Open WebUI retry must retain one completed claim and one remote Task",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        result: "passed",
        persistedScenarios: {
          normalChatWithoutTask: true,
          completedArtifact: true,
          boundedBoundaryGetTaskEnrichment: true,
          rejectPlan: true,
          revisePlan: true,
          provideInput: true,
          pauseResume: true,
          cancelTask: true,
          capabilityGap: true,
          restartRecovery: true,
          crossUserIsolation: true,
          utilityIsolation: true,
          retryIdempotency: true,
        },
        auditedBindings: bindings.rows.length,
        auditedEvents: events.rows.length,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await pool.end();
}

function assertStatus(byChat, chatId, status) {
  const rows = byChat.get(chatId) ?? [];
  assert(
    rows.length === 1 && rows[0]?.status === status,
    `${chatId} must have status ${status}`,
  );
}

function assertNoTask(byChat, chatId) {
  const rows = byChat.get(chatId) ?? [];
  assert(
    rows.length === 1 && rows[0]?.sdar_task_id === null,
    `${chatId} must not have a Task binding`,
  );
}

function assertPhase(events, phase) {
  assert(
    events.some((event) => event.summary_json?.internalPhase === phase),
    `Expected internalPhase ${phase}`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
