export interface OpenAiErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly param: string | null;
    readonly code: string;
  };
}

export function openAiError(
  code: string,
  message: string,
  type = "invalid_request_error",
  param: string | null = null,
): OpenAiErrorResponse {
  return { error: { message, type, param, code } };
}
