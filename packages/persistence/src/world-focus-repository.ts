import pg, { type PoolClient } from "pg";
import { z } from "zod";

import {
  conversationWorldFocusSchema,
  effectiveReferenceStatus,
  parsePendingGroundingChoice,
  pendingGroundingCandidateSchema,
  worldFocusReferenceSchema,
  worldReferenceIdentityHash,
  type ConversationWorldFocus,
  type ContextReadyWorldReference,
  type PendingGroundingChoice,
  type UpsertWorldFocusReference,
  type WorldFocusRepository,
  type WorldFocusScope,
} from "../../conversation-world-focus/src/index.js";

import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";

const { Pool } = pg;

export class PostgresWorldFocusRepository implements WorldFocusRepository {
  constructor(private readonly pool: InstanceType<typeof Pool>) {}

  async getFocus(scope: WorldFocusScope): Promise<ConversationWorldFocus> {
    await this.ensureFocus(scope);
    const [focus, references] = await Promise.all([
      this.pool.query<FocusRow>(
        `
          SELECT *
          FROM chat_service.conversation_world_focus
          WHERE principal_id = $1 AND thread_id = $2
        `,
        [scope.principalId, scope.threadId],
      ),
      this.pool.query<ReferenceRow>(
        `
          SELECT *
          FROM chat_service.conversation_world_reference
          WHERE principal_id = $1 AND thread_id = $2
          ORDER BY last_used_at DESC, reference_identity_hash
          LIMIT 64
        `,
        [scope.principalId, scope.threadId],
      ),
    ]);
    return mapFocus(requiredRow(focus.rows, "world focus"), references.rows);
  }

  async listUsableReferences(
    input: WorldFocusScope & { readonly limit: number; readonly now?: string },
  ): Promise<readonly ContextReadyWorldReference[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 64) {
      throw new PersistenceConflictError(
        "World focus reference limit must be between 1 and 64",
      );
    }
    await this.ensureFocus(input);
    const now = input.now ?? new Date().toISOString();
    const result = await this.pool.query<ReferenceRow>(
      `
        SELECT *
        FROM chat_service.conversation_world_reference
        WHERE principal_id = $1
          AND thread_id = $2
          AND status = 'VALID'
          AND revalidation_required = false
          AND (valid_until IS NULL OR valid_until > $3::timestamptz)
        ORDER BY last_used_at DESC, reference_identity_hash
        LIMIT $4
      `,
      [input.principalId, input.threadId, now, input.limit],
    );
    return result.rows.map((row) => ({
      focusReference: mapReference(row, now),
      sourceMessageId: row.source_message_id,
    }));
  }

  async listReferencesRequiringValidation(
    input: WorldFocusScope & { readonly limit: number; readonly now?: string },
  ): Promise<readonly ContextReadyWorldReference[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 64) {
      throw new PersistenceConflictError(
        "World focus reference limit must be between 1 and 64",
      );
    }
    await this.ensureFocus(input);
    const now = input.now ?? new Date().toISOString();
    const result = await this.pool.query<ReferenceRow>(
      `
        SELECT *
        FROM chat_service.conversation_world_reference
        WHERE principal_id = $1
          AND thread_id = $2
          AND (
            status IN ('STALE', 'EXPIRED')
            OR revalidation_required = true
            OR (valid_until IS NOT NULL AND valid_until <= $3::timestamptz)
          )
        ORDER BY last_used_at DESC, reference_identity_hash
        LIMIT $4
      `,
      [input.principalId, input.threadId, now, input.limit],
    );
    return result.rows.map((row) => ({
      focusReference: mapReference(row, now),
      sourceMessageId: row.source_message_id,
    }));
  }

  async applyReferences(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly expectedRevision: number;
    readonly groundingId: string;
    readonly groundingResultHash: string;
    readonly references: readonly UpsertWorldFocusReference[];
  }): Promise<ConversationWorldFocus> {
    if (input.references.length > 64) {
      throw new PersistenceConflictError(
        "A grounding result cannot add more than 64 focus references",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureFocusWithClient(client, input);
      const locked = await client.query<FocusRow>(
        `
          SELECT *
          FROM chat_service.conversation_world_focus
          WHERE principal_id = $1 AND thread_id = $2
          FOR UPDATE
        `,
        [input.principalId, input.threadId],
      );
      const current = requiredRow(locked.rows, "locked world focus");
      if (Number(current.revision) !== input.expectedRevision) {
        throw new PersistenceConflictError(
          "World focus revision changed before update",
        );
      }
      for (const reference of input.references) {
        await upsertReference(client, input, reference);
      }
      await client.query(
        `
          DELETE FROM chat_service.conversation_world_reference
          WHERE (principal_id, thread_id, reference_identity_hash) IN (
            SELECT principal_id, thread_id, reference_identity_hash
            FROM chat_service.conversation_world_reference
            WHERE principal_id = $1 AND thread_id = $2
            ORDER BY last_used_at DESC, reference_identity_hash
            OFFSET 64
          )
        `,
        [input.principalId, input.threadId],
      );
      const updated = await client.query<FocusRow>(
        `
          UPDATE chat_service.conversation_world_focus
          SET revision = revision + 1,
              last_grounding_id = $3,
              last_grounding_result_hash = $4
          WHERE principal_id = $1 AND thread_id = $2
          RETURNING *
        `,
        [
          input.principalId,
          input.threadId,
          input.groundingId,
          input.groundingResultHash,
        ],
      );
      const references = await client.query<ReferenceRow>(
        `
          SELECT *
          FROM chat_service.conversation_world_reference
          WHERE principal_id = $1 AND thread_id = $2
          ORDER BY last_used_at DESC, reference_identity_hash
          LIMIT 64
        `,
        [input.principalId, input.threadId],
      );
      await client.query("COMMIT");
      return mapFocus(
        requiredRow(updated.rows, "updated world focus"),
        references.rows,
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getOpenChoice(
    input: WorldFocusScope & { readonly now?: string },
  ): Promise<PendingGroundingChoice | undefined> {
    const now = input.now ?? new Date().toISOString();
    const result = await this.pool.query<ChoiceRow>(
      `
        SELECT *
        FROM chat_service.pending_grounding_choice
        WHERE principal_id = $1
          AND thread_id = $2
          AND status = 'OPEN'
          AND expires_at > $3::timestamptz
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.principalId, input.threadId, now],
    );
    return result.rows[0] === undefined ? undefined : mapChoice(result.rows[0]);
  }

  async createChoice(
    value: PendingGroundingChoice,
  ): Promise<PendingGroundingChoice> {
    const choice = parsePendingGroundingChoice(value);
    if (choice.status !== "OPEN" || choice.selectedProductId !== undefined) {
      throw new PersistenceConflictError(
        "A new pending grounding choice must be OPEN",
      );
    }
    const result = await this.pool.query<ChoiceRow>(
      `
        INSERT INTO chat_service.pending_grounding_choice(
          choice_id, principal_id, thread_id, origin_message_id,
          origin_grounding_id, origin_result_hash, origin_turn_plan_json,
          origin_request_plan_json, mention_id, surface_text,
          candidate_products_json, status, expires_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
          $11::jsonb, 'OPEN', $12::timestamptz, $13::timestamptz,
          $14::timestamptz
        )
        RETURNING *
      `,
      [
        choice.choiceId,
        choice.principalId,
        choice.threadId,
        choice.originMessageId,
        choice.originGroundingId,
        choice.originResultHash,
        JSON.stringify(choice.originTurnPlan),
        JSON.stringify(choice.originRequestPlan),
        choice.mentionId,
        choice.surfaceText,
        JSON.stringify(choice.candidates),
        choice.expiresAt,
        choice.createdAt,
        choice.updatedAt,
      ],
    );
    return mapChoice(requiredRow(result.rows, "created pending choice"));
  }

  async selectChoice(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly choiceId: string;
    readonly selectedProductId: string;
    readonly now?: string;
  }): Promise<PendingGroundingChoice> {
    const now = input.now ?? new Date().toISOString();
    const result = await this.pool.query<ChoiceRow>(
      `
        UPDATE chat_service.pending_grounding_choice
        SET status = 'SELECTED', selected_product_id = $4
        WHERE choice_id = $1
          AND principal_id = $2
          AND thread_id = $3
          AND status = 'OPEN'
          AND expires_at > $5::timestamptz
          AND candidate_products_json @> $6::jsonb
        RETURNING *
      `,
      [
        input.choiceId,
        input.principalId,
        input.threadId,
        input.selectedProductId,
        now,
        JSON.stringify([{ productId: input.selectedProductId }]),
      ],
    );
    if (result.rows[0] === undefined) {
      throw new PersistenceConflictError(
        "Pending grounding choice is unavailable or does not contain candidate",
      );
    }
    return mapChoice(result.rows[0]);
  }

  async closeChoice(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly choiceId: string;
    readonly status: "EXPIRED" | "CANCELLED";
    readonly now?: string;
  }): Promise<PendingGroundingChoice> {
    const result = await this.pool.query<ChoiceRow>(
      `
        UPDATE chat_service.pending_grounding_choice
        SET status = $4, updated_at = $5::timestamptz
        WHERE choice_id = $1
          AND principal_id = $2
          AND thread_id = $3
          AND status = 'OPEN'
        RETURNING *
      `,
      [
        input.choiceId,
        input.principalId,
        input.threadId,
        input.status,
        input.now ?? new Date().toISOString(),
      ],
    );
    if (result.rows[0] === undefined) {
      throw new PersistenceConflictError(
        "Pending grounding choice is not open",
      );
    }
    return mapChoice(result.rows[0]);
  }

  private async ensureFocus(scope: WorldFocusScope): Promise<void> {
    await ensureFocusWithClient(this.pool, scope);
  }
}

interface FocusRow {
  principal_id: string;
  thread_id: string;
  revision: string | number;
  last_grounding_id: string | null;
  last_grounding_result_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ReferenceRow {
  principal_id: string;
  thread_id: string;
  reference_identity_hash: string;
  reference_key_json: unknown;
  product_id: string;
  display_name: string;
  reference_type: string;
  source_message_id: string;
  source_grounding_id: string;
  source_result_hash: string;
  source_world_version: string | number;
  valid_until: Date | null;
  revalidation_required: boolean;
  status: "VALID" | "STALE" | "EXPIRED" | "UNKNOWN";
  last_used_at: Date;
}

interface ChoiceRow {
  choice_id: string;
  principal_id: string;
  thread_id: string;
  origin_message_id: string;
  origin_grounding_id: string;
  origin_result_hash: string;
  origin_turn_plan_json: unknown;
  origin_request_plan_json: unknown;
  mention_id: string;
  surface_text: string;
  candidate_products_json: unknown;
  status: "OPEN" | "SELECTED" | "EXPIRED" | "CANCELLED";
  selected_product_id: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

async function ensureFocusWithClient(
  client: Pick<InstanceType<typeof Pool>, "query"> | PoolClient,
  scope: WorldFocusScope,
): Promise<void> {
  const inserted = await client.query(
    `
      INSERT INTO chat_service.conversation_world_focus(principal_id, thread_id)
      SELECT $1, thread_id
      FROM chat_service.conversation_thread
      WHERE thread_id = $2 AND principal_id = $1
      ON CONFLICT (principal_id, thread_id) DO NOTHING
    `,
    [scope.principalId, scope.threadId],
  );
  if ((inserted.rowCount ?? 0) > 0) return;
  const authorized = await client.query(
    `
      SELECT 1
      FROM chat_service.conversation_world_focus
      WHERE principal_id = $1 AND thread_id = $2
    `,
    [scope.principalId, scope.threadId],
  );
  if (authorized.rows[0] === undefined) {
    throw new PersistenceAuthorizationError(
      "World focus is not authorized for principal",
    );
  }
}

async function upsertReference(
  client: PoolClient,
  scope: WorldFocusScope,
  input: UpsertWorldFocusReference,
): Promise<void> {
  const identityHash = worldReferenceIdentityHash(input.referenceKey);
  const now = input.lastUsedAt ?? new Date().toISOString();
  const status = effectiveReferenceStatus(
    worldFocusReferenceSchema.parse({
      referenceIdentityHash: identityHash,
      referenceKey: input.referenceKey,
      productId: input.productId,
      displayName: input.displayName,
      referenceType: input.referenceType,
      sourceGroundingId: input.sourceGroundingId,
      sourceResultHash: input.sourceResultHash,
      sourceWorldVersion: input.sourceWorldVersion,
      ...(input.validUntil === undefined
        ? {}
        : { validUntil: input.validUntil }),
      revalidationRequired: input.revalidationRequired,
      status: input.revalidationRequired ? "STALE" : "VALID",
      lastUsedAt: now,
    }),
    new Date(now),
  );
  await client.query(
    `
      INSERT INTO chat_service.conversation_world_reference(
        principal_id, thread_id, reference_identity_hash, reference_key_json,
        product_id, display_name, reference_type, source_message_id,
        source_grounding_id, source_result_hash, source_world_version,
        valid_until, revalidation_required, status, last_used_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
        $12::timestamptz, $13, $14, $15::timestamptz
      )
      ON CONFLICT (principal_id, thread_id, reference_identity_hash)
      DO UPDATE SET
        reference_key_json = EXCLUDED.reference_key_json,
        product_id = EXCLUDED.product_id,
        display_name = EXCLUDED.display_name,
        reference_type = EXCLUDED.reference_type,
        source_message_id = EXCLUDED.source_message_id,
        source_grounding_id = EXCLUDED.source_grounding_id,
        source_result_hash = EXCLUDED.source_result_hash,
        source_world_version = EXCLUDED.source_world_version,
        valid_until = EXCLUDED.valid_until,
        revalidation_required = EXCLUDED.revalidation_required,
        status = EXCLUDED.status,
        last_used_at = EXCLUDED.last_used_at,
        updated_at = now()
    `,
    [
      scope.principalId,
      scope.threadId,
      identityHash,
      JSON.stringify(input.referenceKey),
      input.productId,
      input.displayName,
      input.referenceType,
      input.sourceMessageId,
      input.sourceGroundingId,
      input.sourceResultHash,
      input.sourceWorldVersion,
      input.validUntil ?? null,
      input.revalidationRequired,
      status,
      now,
    ],
  );
}

function mapFocus(
  row: FocusRow,
  references: readonly ReferenceRow[],
): ConversationWorldFocus {
  return conversationWorldFocusSchema.parse({
    schemaVersion: "1.0",
    principalId: row.principal_id,
    threadId: row.thread_id,
    revision: Number(row.revision),
    ...(row.last_grounding_id === null
      ? {}
      : { lastGroundingId: row.last_grounding_id }),
    ...(row.last_grounding_result_hash === null
      ? {}
      : { lastGroundingResultHash: row.last_grounding_result_hash }),
    references: references.map((reference) => mapReference(reference)),
    updatedAt: row.updated_at.toISOString(),
  });
}

function mapReference(row: ReferenceRow, now?: string) {
  const parsed = worldFocusReferenceSchema.parse({
    referenceIdentityHash: row.reference_identity_hash,
    referenceKey: row.reference_key_json,
    productId: row.product_id,
    displayName: row.display_name,
    referenceType: row.reference_type,
    sourceGroundingId: row.source_grounding_id,
    sourceResultHash: row.source_result_hash,
    sourceWorldVersion: Number(row.source_world_version),
    ...(row.valid_until === null
      ? {}
      : { validUntil: row.valid_until.toISOString() }),
    revalidationRequired: row.revalidation_required,
    status: row.status,
    lastUsedAt: row.last_used_at.toISOString(),
  });
  return {
    ...parsed,
    status: effectiveReferenceStatus(
      parsed,
      now === undefined ? new Date() : new Date(now),
    ),
  };
}

function mapChoice(row: ChoiceRow): PendingGroundingChoice {
  const candidates = z
    .array(pendingGroundingCandidateSchema)
    .min(2)
    .max(20)
    .parse(row.candidate_products_json);
  return parsePendingGroundingChoice({
    schemaVersion: "1.0",
    choiceId: row.choice_id,
    principalId: row.principal_id,
    threadId: row.thread_id,
    originMessageId: row.origin_message_id,
    originGroundingId: row.origin_grounding_id,
    originResultHash: row.origin_result_hash,
    originTurnPlan: row.origin_turn_plan_json,
    originRequestPlan: row.origin_request_plan_json,
    mentionId: row.mention_id,
    surfaceText: row.surface_text,
    candidates,
    status: row.status,
    ...(row.selected_product_id === null
      ? {}
      : { selectedProductId: row.selected_product_id }),
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new PersistenceConflictError(operation + " did not return a row");
  }
  return row;
}
