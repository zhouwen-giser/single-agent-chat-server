import { describe, expect, it, jest } from "@jest/globals";

import { resolveStructuredMapSelections } from "../apps/server/src/chat/structured-selection-resolver.js";
import type { StructuredWorldSelection } from "../packages/world-explanation-contract/src/index.js";

describe("C03 structured selection grounding bridge", () => {
  it("loads each selection in authenticated scope and projects ReferenceKey only", async () => {
    const selection = referenceSelection();
    const findActive = jest.fn(async () => selection);

    await expect(
      resolveStructuredMapSelections(
        { findActive },
        {
          principalId: "principal-1",
          threadId: "thread-1",
          selectionIds: [selection.selectionId],
          now: "2026-08-30T00:00:30.000Z",
        },
      ),
    ).resolves.toEqual([
      {
        selectionId: selection.selectionId,
        kind: "FEATURE",
        revision: 1,
        referenceKey: selection.referenceKey,
      },
    ]);
    expect(findActive).toHaveBeenCalledWith(
      { principalId: "principal-1", threadId: "thread-1" },
      selection.selectionId,
      "2026-08-30T00:00:30.000Z",
    );
  });

  it("fails closed when any selection is unavailable or token-only", async () => {
    const reference = referenceSelection();
    const token = {
      ...reference,
      selectionId: "selection-token",
      referenceKey: undefined,
      upstreamSelectionToken: "opaque-token",
    } as StructuredWorldSelection;
    await expect(
      resolveStructuredMapSelections(
        { findActive: async () => undefined },
        {
          principalId: "principal-1",
          threadId: "thread-1",
          selectionIds: ["missing"],
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveStructuredMapSelections(
        { findActive: async () => token },
        {
          principalId: "principal-1",
          threadId: "thread-1",
          selectionIds: [token.selectionId],
        },
      ),
    ).resolves.toBeUndefined();
  });
});

function referenceSelection(): StructuredWorldSelection {
  return {
    schemaVersion: "sacs-structured-world-selection/1.0",
    selectionId: "selection-reference",
    principalId: "principal-1",
    threadId: "thread-1",
    groundingId: "grounding-1",
    explanationId: "explanation-1",
    selectionKind: "REFERENCE_SET_MEMBER",
    referenceKey: {
      namespace: "gowm",
      kind: "DEVICE",
      id: "wrf_" + "a".repeat(32),
      version: "7",
    },
    selectionRevision: 1,
    sourceHash: "sha256:" + "b".repeat(64),
    selectedAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-08-30T00:04:00.000Z",
  };
}
