export const ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION =
  "ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION" as const;

const maximumDepth = 32;
const maximumNodes = 10_000;
const sensitiveKeyTerms = [
  "apikey",
  "asseturi",
  "asseturl",
  "accesskey",
  "authentication",
  "authheader",
  "authority",
  "authorization",
  "bearer",
  "clientsecret",
  "connectionstring",
  "cookie",
  "credential",
  "datascope",
  "databaseurl",
  "endpoint",
  "executionargs",
  "internalasset",
  "jwt",
  "operationid",
  "operationkey",
  "passphrase",
  "password",
  "passwd",
  "principal",
  "principalid",
  "privatekey",
  "presigned",
  "provider",
  "proxyauthorization",
  "publiceditschema",
  "refreshtoken",
  "scope",
  "secret",
  "security",
  "sessionid",
  "sessionkey",
  "signingkey",
  "signature",
  "setcookie",
  "sourcefingerprint",
  "token",
] as const;
const sensitiveKeyTokens = new Set(["auth", "key", "passphrase"]);
const forbiddenUriScheme =
  /\b(?:asset|artifact|az|abfs|blob|data|file|ftp|gs|internal|mcp|s3|wasb|wasbs):/iu;
const urlCandidate = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>(){}"'\\]+/gu;
const credentialAssignment =
  /(?:authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|api[-_ ]?key|x[-_ ]?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|client[-_ ]?secret|password|passwd|pwd|private[-_ ]?key|secret|session[-_ ]?(?:id|key)|token|credential|signature)\s*[:=]\s*\S+/iu;
const bearerCredential = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{4,}/iu;

/**
 * Rejects credential-bearing or internal-asset values before public analysis
 * arguments cross a persistence or protocol boundary. The thrown message is a
 * stable code and deliberately contains neither a key path nor source data.
 */
export function assertAnalysisPublicArgsNonDisclosure(value: unknown): void {
  const ancestors = new Set<object>();
  const budget = { nodes: 0 };
  let valid = false;
  try {
    valid = visit(value, 0, budget, ancestors);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error(ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION);
  }
}

export function isAnalysisPublicArgsNonDisclosing(value: unknown): boolean {
  try {
    assertAnalysisPublicArgsNonDisclosure(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies the same non-disclosure boundary to an RFC 6902-style public-args
 * patch, including the decoded JSON Pointer path. This must run before a
 * client-supplied patch is made durable.
 */
export function assertAnalysisPublicPatchNonDisclosure(value: unknown): void {
  let valid = false;
  try {
    assertAnalysisPublicArgsNonDisclosure(value);
    valid =
      Array.isArray(value) &&
      value.every((operation) => {
        if (
          operation === null ||
          typeof operation !== "object" ||
          Array.isArray(operation)
        ) {
          return false;
        }
        const path = (operation as Readonly<Record<string, unknown>>)["path"];
        return (
          typeof path === "string" &&
          path.startsWith("/") &&
          decodePointer(path).every((segment) => !isSensitiveKey(segment))
        );
      });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error(ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION);
  }
}

function visit(
  value: unknown,
  depth: number,
  budget: { nodes: number },
  ancestors: Set<object>,
): boolean {
  budget.nodes += 1;
  if (depth > maximumDepth || budget.nodes > maximumNodes) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isNonDisclosingString(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
        )
      ) {
        return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          !visit(descriptor.value, depth + 1, budget, ancestors)
        ) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || isSensitiveKey(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !visit(descriptor.value, depth + 1, budget, ancestors)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function isSensitiveKey(key: string): boolean {
  const compatible = key.normalize("NFKC");
  const normalized = compatible.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
  const tokens = compatible
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/gu)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
  return (
    normalized.length === 0 ||
    normalized === "pwd" ||
    tokens.some((token) => sensitiveKeyTokens.has(token)) ||
    sensitiveKeyTerms.some((term) => normalized.includes(term))
  );
}

function decodePointer(path: string): readonly string[] {
  return path
    .slice(1)
    .split("/")
    .map((segment) => {
      if (/~(?:[^01]|$)/u.test(segment)) {
        throw new Error(ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION);
      }
      return segment.replaceAll("~1", "/").replaceAll("~0", "~");
    });
}

function isNonDisclosingString(value: string): boolean {
  if (
    credentialAssignment.test(value) ||
    bearerCredential.test(value) ||
    forbiddenUriScheme.test(value)
  ) {
    return false;
  }
  for (const match of value.matchAll(urlCandidate)) {
    const candidate = match[0];
    try {
      const url = new URL(candidate);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        !isPublicHost(url.hostname) ||
        [...url.searchParams.keys()].some(isSensitiveKey)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function isPublicHost(value: string): boolean {
  const lower = value.toLowerCase();
  const unwrapped =
    lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  const hostname = unwrapped.endsWith(".") ? unwrapped.slice(0, -1) : unwrapped;
  if (
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".localdomain") ||
    hostname.endsWith(".svc") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".intranet") ||
    hostname.endsWith(".private") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid")
  ) {
    return false;
  }
  if (isIpv4(hostname)) return isPublicIpv4(hostname);
  if (hostname.includes(":")) {
    if (
      hostname === "::" ||
      hostname === "::1" ||
      /^(?:fc|fd|fe[89ab]|ff)/u.test(hostname) ||
      hostname.startsWith("2001:db8:")
    ) {
      return false;
    }
    const mapped = mappedIpv4Address(hostname);
    return mapped === undefined || isPublicIpv4(mapped);
  }
  return hostname.includes(".");
}

function mappedIpv4Address(hostname: string): string | undefined {
  if (!hostname.startsWith("::ffff:")) return undefined;
  const suffix = hostname.slice("::ffff:".length);
  if (isIpv4(suffix)) return suffix;
  const groups = suffix.split(":");
  if (
    groups.length !== 2 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return undefined;
  }
  const high = Number.parseInt(groups[0] ?? "", 16);
  const low = Number.parseInt(groups[1] ?? "", 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function isPublicIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4) return false;
  const [first = 0, second = 0] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function isIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255,
    )
  );
}
