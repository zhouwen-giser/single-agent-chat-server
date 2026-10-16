import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
/** Browser-only alias for the existing synchronous canonical SHA-256 checks. */
export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw Error("BROWSER_HASH_ALGORITHM_UNAVAILABLE");
  let text = "";
  return {
    update(value: string, encoding = "utf8") {
      if (encoding !== "utf8") throw Error("BROWSER_HASH_ENCODING_UNAVAILABLE");
      text += value;
      return this;
    },
    digest(encoding: string) {
      if (encoding !== "hex") throw Error("BROWSER_HASH_ENCODING_UNAVAILABLE");
      return bytesToHex(sha256(new TextEncoder().encode(text)));
    },
  };
}
