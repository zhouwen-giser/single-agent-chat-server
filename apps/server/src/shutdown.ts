import process from "node:process";

import type { FastifyInstance } from "fastify";

interface SignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exitCode?: string | number | null;
}

export function installGracefulShutdown(
  server: FastifyInstance,
  signalSource: SignalSource = process,
): { readonly shutdown: (signal: "SIGINT" | "SIGTERM") => Promise<void> } {
  let closing: Promise<void> | undefined;
  const shutdown = (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (closing === undefined) {
      server.log.info({ signal }, "graceful shutdown requested");
      closing = server.close().catch((error: unknown) => {
        signalSource.exitCode = 1;
        server.log.error({ error }, "graceful shutdown failed");
      });
    }
    return closing;
  };
  const onSigInt = () => void shutdown("SIGINT");
  const onSigTerm = () => void shutdown("SIGTERM");
  signalSource.once("SIGINT", onSigInt);
  signalSource.once("SIGTERM", onSigTerm);
  server.addHook("onClose", async () => {
    signalSource.off("SIGINT", onSigInt);
    signalSource.off("SIGTERM", onSigTerm);
  });
  return { shutdown };
}
