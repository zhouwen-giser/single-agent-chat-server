export function createSecureLoggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.x-openwebui-user-jwt",
        "request.headers.authorization",
        "request.headers.x-openwebui-user-jwt",
        "authorization",
        "credentials",
        "token",
        "prompt",
        "artifact",
        "body",
      ],
      censor: "[REDACTED]",
    },
  };
}
