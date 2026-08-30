import type { StructuredWorldSelection } from "../../../../packages/world-explanation-contract/src/index.js";
import type { MapSelection } from "../../../../packages/wsgs-http-adapter/src/index.js";

export interface ActiveStructuredSelectionSource {
  findActive(
    scope: { readonly principalId: string; readonly threadId: string },
    selectionId: string,
    now?: string,
  ): Promise<StructuredWorldSelection | undefined>;
}

export async function resolveStructuredMapSelections(
  source: ActiveStructuredSelectionSource,
  input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly selectionIds: readonly string[];
    readonly now?: string;
  },
): Promise<readonly MapSelection[] | undefined> {
  const selections = await Promise.all(
    input.selectionIds.map((selectionId) =>
      source.findActive(
        { principalId: input.principalId, threadId: input.threadId },
        selectionId,
        input.now,
      ),
    ),
  );
  if (
    selections.some(
      (selection) =>
        selection === undefined || selection.referenceKey === undefined,
    )
  ) {
    return undefined;
  }
  return selections.map((selection) => {
    if (selection?.referenceKey === undefined) {
      throw new Error("STRUCTURED_SELECTION_RESOLUTION_INVARIANT");
    }
    return {
      selectionId: selection.selectionId,
      kind: "FEATURE",
      revision: selection.selectionRevision,
      referenceKey: selection.referenceKey,
    };
  });
}
