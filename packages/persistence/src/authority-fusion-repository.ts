import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  parseAuthorityFusionResultV2,
  type AuthorityFusionResultV2,
} from "../../authority-fusion/src/index.js";

import { hashJson } from "./hash.js";
import { PersistenceConflictError } from "./repository.js";

export interface AuthorityFusionIdentity {
  readonly principalId: string;
  readonly threadId: string;
  readonly taskId: string;
  readonly taskSnapshotHash: string;
  readonly requirementHash: string;
  readonly groundingResultHash: string;
}

export interface StoredAuthorityFusion extends AuthorityFusionIdentity {
  readonly fusionId: string;
  readonly groundingId: string;
  readonly fusionResultHash: string;
  readonly result: AuthorityFusionResultV2;
  readonly createdAt: Date;
}

export class AuthorityFusionRepository {
  constructor(private readonly pool: Pool) {}

  async findExact(
    identity: AuthorityFusionIdentity,
  ): Promise<StoredAuthorityFusion | undefined> {
    const result = await this.pool.query<AuthorityFusionRow>(
      `
        SELECT *
        FROM chat_service.authority_fusion_evaluation
        WHERE principal_id = $1
          AND thread_id = $2
          AND task_id = $3
          AND task_snapshot_hash = $4
          AND requirement_hash = $5
          AND grounding_result_hash = $6
      `,
      [
        identity.principalId,
        identity.threadId,
        identity.taskId,
        identity.taskSnapshotHash,
        identity.requirementHash,
        identity.groundingResultHash,
      ],
    );
    return result.rows[0] === undefined ? undefined : mapRow(result.rows[0]);
  }

  async saveOrReplay(
    input: AuthorityFusionIdentity & {
      readonly groundingId: string;
      readonly result: AuthorityFusionResultV2;
    },
  ): Promise<{
    readonly created: boolean;
    readonly fusion: StoredAuthorityFusion;
  }> {
    const parsed = parseAuthorityFusionResultV2(input.result);
    const fusionResultHash = "sha256:" + hashJson(parsed);
    const fusionId = "fusion-" + randomUUID();
    const inserted = await this.pool.query<AuthorityFusionRow>(
      `
        INSERT INTO chat_service.authority_fusion_evaluation(
          fusion_id, principal_id, thread_id, task_id, task_snapshot_hash,
          requirement_hash, grounding_id, grounding_result_hash,
          fusion_result_hash, fusion_result_json
        )
        SELECT $1, $2, thread_id, $4, $5, $6, $7, $8, $9, $10::jsonb
        FROM chat_service.conversation_thread
        WHERE thread_id = $3 AND principal_id = $2
        ON CONFLICT (
          principal_id, thread_id, task_id, task_snapshot_hash,
          requirement_hash, grounding_result_hash
        ) DO NOTHING
        RETURNING *
      `,
      [
        fusionId,
        input.principalId,
        input.threadId,
        input.taskId,
        input.taskSnapshotHash,
        input.requirementHash,
        input.groundingId,
        input.groundingResultHash,
        fusionResultHash,
        JSON.stringify(parsed),
      ],
    );
    if (inserted.rows[0] !== undefined) {
      return { created: true, fusion: mapRow(inserted.rows[0]) };
    }
    const existing = await this.findExact(input);
    if (existing === undefined) {
      throw new PersistenceConflictError(
        "Authority fusion scope is not authorized for principal",
      );
    }
    if (
      existing.groundingId !== input.groundingId ||
      existing.fusionResultHash !== fusionResultHash
    ) {
      throw new PersistenceConflictError(
        "Authority fusion replay does not match the immutable stored result",
      );
    }
    return { created: false, fusion: existing };
  }
}

interface AuthorityFusionRow {
  fusion_id: string;
  principal_id: string;
  thread_id: string;
  task_id: string;
  task_snapshot_hash: string;
  requirement_hash: string;
  grounding_id: string;
  grounding_result_hash: string;
  fusion_result_hash: string;
  fusion_result_json: unknown;
  created_at: Date;
}

function mapRow(row: AuthorityFusionRow): StoredAuthorityFusion {
  return {
    fusionId: row.fusion_id,
    principalId: row.principal_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    taskSnapshotHash: row.task_snapshot_hash,
    requirementHash: row.requirement_hash,
    groundingId: row.grounding_id,
    groundingResultHash: row.grounding_result_hash,
    fusionResultHash: row.fusion_result_hash,
    result: parseAuthorityFusionResultV2(row.fusion_result_json),
    createdAt: row.created_at,
  };
}
