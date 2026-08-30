import type { Pool, PoolClient } from "pg";

import {
  calculateStructuredWorldSelectionSourceHash,
  canonicalJson,
  hashCanonicalJson,
  identifierSchema,
  parseWorldExplanationV1,
  sha256Schema,
  structuredWorldSelectionSchema,
  type StructuredWorldSelection,
  type WorldExplanationV1,
} from "../../world-explanation-contract/src/index.js";

import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";

export interface StructuredWorldSelectionScope {
  readonly principalId: string;
  readonly threadId: string;
}

export interface UpstreamSelectionTokenValidation {
  readonly validUntil: string;
  readonly validationProofHash: string;
}

export type VerifyUpstreamSelectionToken = (input: {
  readonly selection: StructuredWorldSelection;
  readonly explanation: WorldExplanationV1;
  readonly now: string;
}) => Promise<UpstreamSelectionTokenValidation | undefined>;

export interface StructuredWorldSelectionRepositoryOptions {
  readonly verifyUpstreamSelectionToken?: VerifyUpstreamSelectionToken;
}

interface ExplanationSelectionSource {
  readonly explanation: WorldExplanationV1;
  readonly explanationHash: string;
}

interface SelectionRow {
  readonly selection_json: unknown;
  readonly active?: boolean;
}

interface SelectionIdentityValidation {
  readonly validUntil: string;
  readonly validationProofHash: string;
  readonly sourceOperation:
    "VALIDATE_REFERENCES" | "UPSTREAM_SELECTION_TOKEN_VALIDATE";
}

export class StructuredWorldSelectionRepository {
  constructor(
    private readonly pool: Pool,
    private readonly options: StructuredWorldSelectionRepositoryOptions = {},
  ) {}

  async saveOrReplay(
    value: StructuredWorldSelection,
    now = new Date().toISOString(),
  ): Promise<{
    readonly created: boolean;
    readonly selection: StructuredWorldSelection;
  }> {
    const selection = structuredWorldSelectionSchema.parse(value);
    assertUsableTime(selection, now);
    const source = await this.loadExplanationSource(selection);
    assertSelectionSource(selection, source.explanation);
    const identityValidation = await this.validateCurrentIdentity(
      selection,
      source.explanation,
      now,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [selection.selectionId],
      );
      const databaseClock = await client.query<{ current_time: Date }>(
        "SELECT clock_timestamp() AS current_time",
      );
      const commitTime = databaseClock.rows[0]?.current_time;
      if (commitTime === undefined) {
        throw new PersistenceConflictError(
          "Structured selection database clock unavailable",
        );
      }
      assertUsableTime(selection, commitTime.toISOString());
      assertValidationFresh(
        selection,
        identityValidation,
        commitTime.toISOString(),
      );
      const lockedSource = await loadExplanationSourceWithClient(
        client,
        selection,
      );
      if (
        lockedSource === undefined ||
        lockedSource.explanationHash !== source.explanationHash
      ) {
        throw unavailableSelectionSource();
      }
      assertSelectionSource(selection, lockedSource.explanation);
      const exact = await client.query<SelectionRow>(
        "SELECT selection_json FROM chat_service.structured_world_selection WHERE selection_id = $1 AND selection_revision = $2",
        [selection.selectionId, selection.selectionRevision],
      );
      const exactExisting =
        exact.rows[0] === undefined
          ? undefined
          : structuredWorldSelectionSchema.parse(exact.rows[0].selection_json);
      if (exactExisting !== undefined) {
        assertSelectionOwner(exactExisting, selection);
        if (canonicalJson(exactExisting) !== canonicalJson(selection)) {
          throw new PersistenceConflictError(
            "Structured selection idempotency conflict",
          );
        }
        await client.query("COMMIT");
        return { created: false, selection: exactExisting };
      }
      const latest = await client.query<SelectionRow>(
        "SELECT selection_json FROM chat_service.structured_world_selection WHERE selection_id = $1 ORDER BY selection_revision DESC LIMIT 1",
        [selection.selectionId],
      );
      const existing =
        latest.rows[0] === undefined
          ? undefined
          : structuredWorldSelectionSchema.parse(latest.rows[0].selection_json);
      if (existing !== undefined) {
        assertSelectionOwner(existing, selection);
        if (selection.selectionRevision !== existing.selectionRevision + 1) {
          throw new PersistenceConflictError(
            "Structured selection revision conflict",
          );
        }
      } else if (selection.selectionRevision !== 1) {
        throw new PersistenceConflictError(
          "Structured selection initial revision must be one",
        );
      }

      await client.query(
        "INSERT INTO chat_service.structured_world_selection(selection_id, selection_revision, principal_id, thread_id, grounding_id, explanation_id, explanation_hash, selection_kind, finding_id, feature_id, reference_key_json, upstream_selection_token, source_hash, selection_json, selected_at, expires_at, validation_source_operation, validation_proof_hash, validation_valid_until) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb, $15::timestamptz, $16::timestamptz, $17, $18, $19::timestamptz)",
        [
          selection.selectionId,
          selection.selectionRevision,
          selection.principalId,
          selection.threadId,
          selection.groundingId,
          selection.explanationId,
          source.explanationHash,
          selection.selectionKind,
          selection.findingId ?? null,
          selection.featureId ?? null,
          selection.referenceKey === undefined
            ? null
            : JSON.stringify(selection.referenceKey),
          selection.upstreamSelectionToken ?? null,
          selection.sourceHash,
          JSON.stringify(selection),
          selection.selectedAt,
          selection.expiresAt,
          identityValidation.sourceOperation,
          identityValidation.validationProofHash,
          identityValidation.validUntil,
        ],
      );
      await client.query("COMMIT");
      return { created: true, selection };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findActive(
    scopeValue: StructuredWorldSelectionScope,
    selectionIdValue: string,
    now = new Date().toISOString(),
  ): Promise<StructuredWorldSelection | undefined> {
    const scope = {
      principalId: identifierSchema.parse(scopeValue.principalId),
      threadId: identifierSchema.parse(scopeValue.threadId),
    };
    const selectionId = identifierSchema.parse(selectionIdValue);
    assertTimestamp(now, "now");
    const result = await this.pool.query<SelectionRow>(
      "SELECT selection_json, expires_at > $4::timestamptz AS active FROM chat_service.structured_world_selection WHERE selection_id = $1 AND principal_id = $2 AND thread_id = $3 ORDER BY selection_revision DESC LIMIT 1",
      [selectionId, scope.principalId, scope.threadId, now],
    );
    return result.rows[0] === undefined || result.rows[0].active !== true
      ? undefined
      : structuredWorldSelectionSchema.parse(result.rows[0].selection_json);
  }

  private async loadExplanationSource(
    selection: StructuredWorldSelection,
  ): Promise<ExplanationSelectionSource> {
    const source = await loadExplanationSourceWithPool(this.pool, selection);
    if (source === undefined) throw unavailableSelectionSource();
    return source;
  }

  private async validateCurrentIdentity(
    selection: StructuredWorldSelection,
    explanation: WorldExplanationV1,
    now: string,
  ): Promise<SelectionIdentityValidation> {
    if (selection.referenceKey !== undefined) {
      const reference = explanation.references.find(
        ({ referenceKey }) =>
          canonicalJson(referenceKey) === canonicalJson(selection.referenceKey),
      );
      if (
        reference?.sourceOperation !== "VALIDATE_REFERENCES" ||
        reference.revalidationRequired !== false ||
        reference.validUntil === undefined ||
        Date.parse(reference.validUntil) <= Date.parse(now) ||
        Date.parse(selection.expiresAt) > Date.parse(reference.validUntil)
      ) {
        throw new PersistenceConflictError(
          "Structured selection reference requires revalidation",
        );
      }
      return {
        validUntil: reference.validUntil,
        validationProofHash: hashCanonicalJson({
          schemaVersion: "sacs-structured-selection-reference-proof/1.0",
          referenceKey: reference.referenceKey,
          sourceOperation: reference.sourceOperation,
          revalidationRequired: reference.revalidationRequired,
          validUntil: reference.validUntil,
        }),
        sourceOperation: "VALIDATE_REFERENCES",
      };
    }
    const verification =
      this.options.verifyUpstreamSelectionToken === undefined
        ? undefined
        : await this.options.verifyUpstreamSelectionToken({
            selection,
            explanation,
            now,
          });
    if (
      verification === undefined ||
      !Number.isFinite(Date.parse(verification.validUntil)) ||
      !sha256Schema.safeParse(verification.validationProofHash).success ||
      Date.parse(verification.validUntil) <= Date.parse(now) ||
      Date.parse(selection.expiresAt) > Date.parse(verification.validUntil)
    ) {
      throw new PersistenceConflictError(
        "Structured selection token requires authoritative validation",
      );
    }
    return {
      validUntil: verification.validUntil,
      validationProofHash: sha256Schema.parse(verification.validationProofHash),
      sourceOperation: "UPSTREAM_SELECTION_TOKEN_VALIDATE",
    };
  }
}

function assertSelectionOwner(
  existing: StructuredWorldSelection,
  requested: StructuredWorldSelection,
): void {
  if (
    existing.principalId !== requested.principalId ||
    existing.threadId !== requested.threadId
  ) {
    throw unavailableSelectionSource();
  }
}

function assertValidationFresh(
  selection: StructuredWorldSelection,
  validation: SelectionIdentityValidation,
  now: string,
): void {
  if (
    Date.parse(validation.validUntil) <= Date.parse(now) ||
    Date.parse(selection.expiresAt) > Date.parse(validation.validUntil)
  ) {
    throw new PersistenceConflictError(
      "Structured selection validation expired before commit",
    );
  }
}

function assertSelectionSource(
  selection: StructuredWorldSelection,
  explanation: WorldExplanationV1,
): void {
  if (explanation.grounding.groundingId !== selection.groundingId) {
    throw unavailableSelectionSource();
  }
  const { sourceHash: ignoredSourceHash, ...sourceInput } = selection;
  void ignoredSourceHash;
  const expected = calculateStructuredWorldSelectionSourceHash({
    explanation,
    selection: sourceInput,
  });
  if (selection.sourceHash !== expected) {
    throw new PersistenceConflictError(
      "Structured selection source hash mismatch",
    );
  }
}

function assertUsableTime(
  selection: StructuredWorldSelection,
  now: string,
): void {
  assertTimestamp(now, "now");
  if (Date.parse(selection.selectedAt) > Date.parse(now)) {
    throw new PersistenceConflictError(
      "Structured selection time is in the future",
    );
  }
  if (Date.parse(selection.expiresAt) <= Date.parse(now)) {
    throw new PersistenceConflictError("Structured selection is stale");
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new PersistenceConflictError("Invalid structured selection " + label);
  }
}

async function loadExplanationSourceWithPool(
  pool: Pool,
  selection: StructuredWorldSelection,
): Promise<ExplanationSelectionSource | undefined> {
  const result = await pool.query<{
    explanation_hash: string;
    explanation_json: unknown;
  }>(explanationSourceSql, explanationSourceValues(selection));
  return mapExplanationSource(result.rows[0]);
}

async function loadExplanationSourceWithClient(
  client: PoolClient,
  selection: StructuredWorldSelection,
): Promise<ExplanationSelectionSource | undefined> {
  const result = await client.query<{
    explanation_hash: string;
    explanation_json: unknown;
  }>(explanationSourceSql + " FOR SHARE", explanationSourceValues(selection));
  return mapExplanationSource(result.rows[0]);
}

const explanationSourceSql =
  "SELECT explanation_hash, explanation_json FROM chat_service.world_explanation WHERE principal_id = $1 AND thread_id = $2 AND grounding_id = $3 AND explanation_id = $4";

function explanationSourceValues(
  selection: StructuredWorldSelection,
): string[] {
  return [
    selection.principalId,
    selection.threadId,
    selection.groundingId,
    selection.explanationId,
  ];
}

function mapExplanationSource(
  row:
    | {
        readonly explanation_hash: string;
        readonly explanation_json: unknown;
      }
    | undefined,
): ExplanationSelectionSource | undefined {
  if (row === undefined) return undefined;
  const explanation = parseWorldExplanationV1(row.explanation_json);
  if (explanation.explanationHash !== row.explanation_hash) {
    throw new PersistenceConflictError(
      "Stored world explanation hash mismatch",
    );
  }
  return {
    explanation,
    explanationHash: row.explanation_hash,
  };
}

function unavailableSelectionSource(): PersistenceAuthorizationError {
  return new PersistenceAuthorizationError(
    "Structured selection source is unavailable",
  );
}
