export const DEFAULT_CHAT_MODEL_ID = "sdar-single-agent";

export interface ModelObject {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: "single-agent-chat-server";
}

export interface ModelsResponse {
  readonly object: "list";
  readonly data: readonly ModelObject[];
}

export function createModelsResponse(
  modelId: string,
  created: number,
): ModelsResponse {
  return {
    object: "list",
    data: [
      {
        id: modelId,
        object: "model",
        created,
        owned_by: "single-agent-chat-server",
      },
    ],
  };
}
