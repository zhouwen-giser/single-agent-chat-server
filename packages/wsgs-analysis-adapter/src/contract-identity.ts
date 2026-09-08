import {
  parseGroundingContractIdentity,
  type GroundingContractIdentity,
} from "../../analysis-contract/src/source.js";
import {
  createWsgsHttpClient,
  type WsgsHttpAdapterConfig,
  type WsgsHttpClient,
} from "../../wsgs-http-adapter/src/index.js";

/** Two explicit published consumers, never a protocol conversion/fallback registry. */
export function createGroundingClientSelector(config: WsgsHttpAdapterConfig) {
  const clients = new Map<string, WsgsHttpClient>();
  return (identity: GroundingContractIdentity): WsgsHttpClient => {
    const saved = parseGroundingContractIdentity(identity);
    let client = clients.get(saved.contractVersion);
    if (!client) {
      client = createWsgsHttpClient({
        ...config,
        contractVersion: saved.contractVersion,
      });
      clients.set(saved.contractVersion, client);
    }
    return client;
  };
}
export function groundingClientIdentity(
  client: WsgsHttpClient,
): GroundingContractIdentity {
  return parseGroundingContractIdentity({
    contractVersion: client.contractVersion,
    resultProfile:
      client.contractVersion === "sacs-wsgs-grounding/1.2"
        ? "wsgs-world-analysis-findings/1.0"
        : "sacs-wsgs-geospatial-findings/1.0",
  });
}
