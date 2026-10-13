/** Only UTF-8 byte counting is needed by the existing public client contracts. */
export const Buffer = {
  byteLength(value: string, encoding = "utf8"): number {
    if (encoding !== "utf8") throw Error("BROWSER_ENCODING_UNAVAILABLE");
    return new TextEncoder().encode(value).byteLength;
  },
};
