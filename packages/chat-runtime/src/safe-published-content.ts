import type { JsonValue } from "../../persistence/src/index.js";

const secretAssignment =
  /(password|secret|token|api[_-]?key|x-api-key)\s*[:=]\s*\S+/giu;
const secretJsonProperty =
  /"(authorization|proxy-authorization|cookie|set-cookie|password|secret|token|api[_-]?key|x-api-key)"\s*:\s*"[^"]*"/giu;
const sensitiveHeader =
  /(^|\n)(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]*/giu;
const databaseUrl =
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/giu;

export function safePublishedText(
  value: string | undefined,
  limit: number,
): string | undefined {
  if (value === undefined) return undefined;
  const redacted = redactSecrets(value)
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join("")
    .trim();
  if (redacted.length === 0) return undefined;
  const bounded =
    redacted.length <= limit
      ? redacted
      : redacted.slice(0, limit) + "... truncated";
  return escapeUntrustedMarkdown(bounded);
}

export function boundedPublishedJson(value: JsonValue, limit = 4_000): string {
  const rendered = redactSecrets(JSON.stringify(value, null, 2))
    .replace(secretJsonProperty, '"$1":"[REDACTED]"')
    .replaceAll("`", "\\u0060")
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return rendered.length <= limit
    ? rendered
    : rendered.slice(0, limit) + "\n... truncated";
}

function redactSecrets(value: string): string {
  return value
    .replace(sensitiveHeader, "$1$2: [REDACTED]")
    .replace(databaseUrl, "$1://[REDACTED]@")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(secretAssignment, "$1=[REDACTED]");
}

function escapeUntrustedMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#!|~]/gu, "\\$&")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)-/u, "$1\\-")
        .replace(/^(\s*)\+/u, "$1\\+")
        .replace(/^(\s*)(\d+)\./u, "$1$2\\."),
    )
    .join("\n");
}
