export class UnexpectedA2aAuthenticationStateError extends Error {
  readonly code = "UNEXPECTED_A2A_AUTH_REQUIRED";
  readonly statusCode = 502;

  constructor() {
    super(
      "SDAR A2A authentication state is incompatible with the trusted deployment.",
    );
    this.name = "UnexpectedA2aAuthenticationStateError";
  }
}

export function isUnexpectedA2aAuthenticationStateError(
  value: unknown,
): value is UnexpectedA2aAuthenticationStateError {
  return (
    value instanceof UnexpectedA2aAuthenticationStateError ||
    (value instanceof Error &&
      (value as Error & { readonly code?: unknown }).code ===
        "UNEXPECTED_A2A_AUTH_REQUIRED")
  );
}
