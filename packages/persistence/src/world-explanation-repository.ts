import type { Pool, PoolClient } from "pg";

import {
  canonicalJson,
  hashWorldExplanation,
  parseExplanationReplayKey,
  parseWorldExplanationV1,
  type ExplanationReplayKey,
  type WorldExplanationV1,
} from "../../world-explanation-contract/src/index.js";
import {
  worldReferenceIdentityHash,
  type WorldFocusReference,
} from "../../conversation-world-focus/src/index.js";

import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";

export const WORLD_EXPLANATION_MAX_JSON_BYTES = 4 * 1024 * 1024;

export interface WorldExplanationFindingLink {
  readonly findingId: string;
  readonly ordinal: number;
  readonly referenceKey: WorldFocusReference["referenceKey"];
}

export interface StoredWorldExplanation extends ExplanationReplayKey {
  readonly explanationId: string;
  readonly groundingId: string;
  readonly contractVersion: string;
  readonly explanationStatus: WorldExplanationV1["explanationStatus"];
  readonly explanationHash: string;
  readonly explanation: WorldExplanationV1;
  readonly createdAt: Date;
}

export class WorldExplanationRepository {
  constructor(private readonly pool: Pool) {}

  async findExact(
    identityValue: ExplanationReplayKey,
  ): Promise<StoredWorldExplanation | undefined> {
    const identity = parseExplanationReplayKey(identityValue);
    const result = await this.pool.query<WorldExplanationRow>(
      `
        SELECT *
        FROM chat_service.world_explanation
        WHERE principal_id = $1
          AND thread_id = $2
          AND grounding_result_hash = $3
          AND locale = $4
          AND contract_hash = $5
          AND renderer_policy_hash = $6
      `,
      replayKeyValues(identity),
    );
    return result.rows[0] === undefined ? undefined : mapRow(result.rows[0]);
  }

  async findById(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly explanationId: string;
  }): Promise<StoredWorldExplanation | undefined> {
    const result = await this.pool.query<WorldExplanationRow>(
      `
        SELECT *
        FROM chat_service.world_explanation
        WHERE principal_id = $1
          AND thread_id = $2
          AND explanation_id = $3
      `,
      [input.principalId, input.threadId, input.explanationId],
    );
    return result.rows[0] === undefined ? undefined : mapRow(result.rows[0]);
  }

  async saveOrReplay(
    input: ExplanationReplayKey & {
      readonly explanation: WorldExplanationV1;
      readonly findingLinks?: readonly WorldExplanationFindingLink[];
    },
  ): Promise<{
    readonly created: boolean;
    readonly explanation: StoredWorldExplanation;
  }> {
    const identity = parseExplanationReplayKey({
      principalId: input.principalId,
      threadId: input.threadId,
      groundingResultHash: input.groundingResultHash,
      locale: input.locale,
      contractHash: input.contractHash,
      rendererPolicyHash: input.rendererPolicyHash,
    });
    const explanation = parseWorldExplanationV1(input.explanation);
    assertExplanationMatchesIdentity(explanation, identity);
    const explanationJson = JSON.stringify(explanation);
    if (
      Buffer.byteLength(explanationJson, "utf8") >
      WORLD_EXPLANATION_MAX_JSON_BYTES
    ) {
      throw new PersistenceConflictError(
        "World explanation JSON exceeds the persistence budget",
      );
    }
    const findingLinks = validateFindingLinks(
      explanation,
      input.findingLinks ?? [],
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await assertAuthorizedScope(client, identity);
      await assertAuthorizedGrounding(client, identity, explanation);
      await ensureAndLockFocus(client, identity);
      const inserted = await client.query<WorldExplanationRow>(
        `
          INSERT INTO chat_service.world_explanation(
            explanation_id, principal_id, thread_id, grounding_id,
            grounding_result_hash, locale, contract_version, contract_hash,
            renderer_policy_hash, explanation_status, explanation_json,
            explanation_hash, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
            $12, $13::timestamptz
          )
          ON CONFLICT DO NOTHING
          RETURNING *
        `,
        [
          explanation.explanationId,
          identity.principalId,
          identity.threadId,
          explanation.grounding.groundingId,
          identity.groundingResultHash,
          identity.locale,
          explanation.schemaVersion,
          identity.contractHash,
          identity.rendererPolicyHash,
          explanation.explanationStatus,
          explanationJson,
          explanation.explanationHash,
          explanation.createdAt,
        ],
      );
      const createdRow = inserted.rows[0];
      if (createdRow !== undefined) {
        await applyFindingLinks(client, identity, explanation, findingLinks);
        await client.query(
          `
            UPDATE chat_service.conversation_world_focus
            SET revision = revision + 1,
                last_explanation_id = $3,
                last_explanation_hash = $4
            WHERE principal_id = $1 AND thread_id = $2
          `,
          [
            identity.principalId,
            identity.threadId,
            explanation.explanationId,
            explanation.explanationHash,
          ],
        );
        await client.query("COMMIT");
        return { created: true, explanation: mapRow(createdRow) };
      }
      const existing = await findExactWithClient(client, identity);
      if (existing === undefined) {
        throw new PersistenceConflictError(
          "World explanation identity conflicts with another stored record",
        );
      }
      assertImmutableReplay(existing, explanation);
      await client.query("COMMIT");
      return { created: false, explanation: existing };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface WorldExplanationRow {
  explanation_id: string;
  principal_id: string;
  thread_id: string;
  grounding_id: string;
  grounding_result_hash: string;
  locale: string;
  contract_version: string;
  contract_hash: string;
  renderer_policy_hash: string;
  explanation_status: WorldExplanationV1["explanationStatus"];
  explanation_json: unknown;
  explanation_hash: string;
  created_at: Date;
}

async function assertAuthorizedScope(
  client: PoolClient,
  identity: ExplanationReplayKey,
): Promise<void> {
  const authorized = await client.query(
    `
      SELECT 1
      FROM chat_service.conversation_thread
      WHERE thread_id = $1 AND principal_id = $2
    `,
    [identity.threadId, identity.principalId],
  );
  if (authorized.rows[0] === undefined) {
    throw new PersistenceAuthorizationError(
      "World explanation scope is not authorized for principal",
    );
  }
}

async function assertAuthorizedGrounding(
  client: PoolClient,
  identity: ExplanationReplayKey,
  explanation: WorldExplanationV1,
): Promise<void> {
  const grounding = await client.query<{
    grounding_result_hash: string | null;
  }>(
    `
      SELECT grounding_result_hash
      FROM chat_service.grounding_execution
      WHERE principal_id = $1
        AND thread_id = $2
        AND wsgs_grounding_id = $3
      FOR SHARE
    `,
    [
      identity.principalId,
      identity.threadId,
      explanation.grounding.groundingId,
    ],
  );
  if (grounding.rows.length === 0) {
    throw new PersistenceAuthorizationError(
      "World explanation grounding is not authorized for principal",
    );
  }
  if (
    !grounding.rows.some(
      ({ grounding_result_hash: resultHash }) =>
        resultHash === identity.groundingResultHash,
    )
  ) {
    throw new PersistenceConflictError(
      "World explanation grounding result hash does not match durable grounding",
    );
  }
}

async function ensureAndLockFocus(
  client: PoolClient,
  identity: ExplanationReplayKey,
): Promise<void> {
  await client.query(
    `
      INSERT INTO chat_service.conversation_world_focus(principal_id, thread_id)
      SELECT principal_id, thread_id
      FROM chat_service.conversation_thread
      WHERE principal_id = $1 AND thread_id = $2
      ON CONFLICT (principal_id, thread_id) DO NOTHING
    `,
    [identity.principalId, identity.threadId],
  );
  const locked = await client.query(
    `
      SELECT 1
      FROM chat_service.conversation_world_focus
      WHERE principal_id = $1 AND thread_id = $2
      FOR UPDATE
    `,
    [identity.principalId, identity.threadId],
  );
  if (locked.rows[0] === undefined) {
    throw new PersistenceAuthorizationError(
      "World explanation focus is not authorized for principal",
    );
  }
}

async function findExactWithClient(
  client: PoolClient,
  identity: ExplanationReplayKey,
): Promise<StoredWorldExplanation | undefined> {
  const result = await client.query<WorldExplanationRow>(
    `
      SELECT *
      FROM chat_service.world_explanation
      WHERE principal_id = $1
        AND thread_id = $2
        AND grounding_result_hash = $3
        AND locale = $4
        AND contract_hash = $5
        AND renderer_policy_hash = $6
    `,
    replayKeyValues(identity),
  );
  return result.rows[0] === undefined ? undefined : mapRow(result.rows[0]);
}

async function applyFindingLinks(
  client: PoolClient,
  identity: ExplanationReplayKey,
  explanation: WorldExplanationV1,
  links: readonly ValidatedFindingLink[],
): Promise<void> {
  for (const link of links) {
    await client.query(
      `
        UPDATE chat_service.conversation_world_reference
        SET source_explanation_id = $4,
            source_explanation_hash = $5,
            source_finding_id = $6,
            source_finding_ordinal = $7,
            updated_at = now()
        WHERE principal_id = $1
          AND thread_id = $2
          AND reference_identity_hash = $3
          AND reference_key_json = $8::jsonb
      `,
      [
        identity.principalId,
        identity.threadId,
        link.referenceIdentityHash,
        explanation.explanationId,
        explanation.explanationHash,
        link.findingId,
        link.ordinal,
        JSON.stringify(link.referenceKey),
      ],
    );
  }
}

interface ValidatedFindingLink extends WorldExplanationFindingLink {
  readonly referenceIdentityHash: string;
}

function validateFindingLinks(
  explanation: WorldExplanationV1,
  values: readonly WorldExplanationFindingLink[],
): readonly ValidatedFindingLink[] {
  if (values.length > 128) {
    throw new PersistenceConflictError(
      "World explanation finding links exceed the persistence budget",
    );
  }
  const byReference = new Map<string, ValidatedFindingLink>();
  for (const value of values) {
    if (
      !Number.isInteger(value.ordinal) ||
      value.ordinal < 1 ||
      value.ordinal > explanation.findings.length ||
      explanation.findings[value.ordinal - 1]?.findingId !== value.findingId
    ) {
      throw new PersistenceConflictError(
        "World explanation finding link does not match deterministic order",
      );
    }
    const referenceIdentityHash = worldReferenceIdentityHash(
      value.referenceKey,
    );
    const candidate = { ...value, referenceIdentityHash };
    const existing = byReference.get(referenceIdentityHash);
    if (
      existing === undefined ||
      value.ordinal < existing.ordinal ||
      (value.ordinal === existing.ordinal &&
        value.findingId < existing.findingId)
    ) {
      byReference.set(referenceIdentityHash, candidate);
    }
  }
  return [...byReference.values()].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      left.findingId.localeCompare(right.findingId),
  );
}

function assertExplanationMatchesIdentity(
  explanation: WorldExplanationV1,
  identity: ExplanationReplayKey,
): void {
  if (
    explanation.grounding.resultHash !== identity.groundingResultHash ||
    explanation.locale !== identity.locale ||
    explanation.provenance.rendererPolicyHash !== identity.rendererPolicyHash
  ) {
    throw new PersistenceConflictError(
      "World explanation does not match its replay identity",
    );
  }
  if (hashWorldExplanation(explanation) !== explanation.explanationHash) {
    throw new PersistenceConflictError(
      "World explanation hash does not match canonical content",
    );
  }
}

function assertImmutableReplay(
  stored: StoredWorldExplanation,
  explanation: WorldExplanationV1,
): void {
  if (
    stored.groundingId !== explanation.grounding.groundingId ||
    stored.contractVersion !== explanation.schemaVersion ||
    stored.explanationStatus !== explanation.explanationStatus ||
    stored.explanationHash !== explanation.explanationHash ||
    canonicalJson(stored.explanation) !== canonicalJson(explanation)
  ) {
    throw new PersistenceConflictError(
      "World explanation replay does not match the immutable stored result",
    );
  }
}

function replayKeyValues(identity: ExplanationReplayKey): string[] {
  return [
    identity.principalId,
    identity.threadId,
    identity.groundingResultHash,
    identity.locale,
    identity.contractHash,
    identity.rendererPolicyHash,
  ];
}

function mapRow(row: WorldExplanationRow): StoredWorldExplanation {
  return {
    explanationId: row.explanation_id,
    principalId: row.principal_id,
    threadId: row.thread_id,
    groundingId: row.grounding_id,
    groundingResultHash: row.grounding_result_hash,
    locale: row.locale,
    contractVersion: row.contract_version,
    contractHash: row.contract_hash,
    rendererPolicyHash: row.renderer_policy_hash,
    explanationStatus: row.explanation_status,
    explanationHash: row.explanation_hash,
    explanation: parseWorldExplanationV1(row.explanation_json),
    createdAt: row.created_at,
  };
}
