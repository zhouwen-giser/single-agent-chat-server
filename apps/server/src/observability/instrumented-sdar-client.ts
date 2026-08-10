import type {
  OperationOptions,
  SdarA2aClient,
} from "../../../../packages/sdar-a2a-adapter/src/index.js";

import type { SecureTelemetry } from "./telemetry.js";

export function instrumentSdarClient(
  client: SdarA2aClient,
  telemetry: SecureTelemetry,
): SdarA2aClient {
  return {
    protocolBinding: client.protocolBinding,
    protocolVersion: client.protocolVersion,
    endpoint: client.endpoint,
    ...(client.agentCard === undefined ? {} : { agentCard: client.agentCard }),
    async *submitTaskStream(input, options) {
      const timed = telemetry.beginA2a("send_message_stream");
      telemetry.streamStarted("a2a");
      try {
        yield* client.submitTaskStream(input, options);
        timed.end(options?.signal?.aborted === true ? "aborted" : "ok");
      } catch (error) {
        timed.end(options?.signal?.aborted === true ? "aborted" : "error");
        throw error;
      } finally {
        telemetry.streamEnded("a2a");
        timed.end(options?.signal?.aborted === true ? "aborted" : "ok");
      }
    },
    sendFollowUp: (input, options) =>
      measure(telemetry, "send_message", options, () =>
        client.sendFollowUp(input, options),
      ),
    getTask: (taskId, options) =>
      measure(telemetry, "get_task", options, () =>
        client.getTask(taskId, options),
      ),
    cancelTask: (taskId, options) =>
      measure(telemetry, "cancel_task", options, () =>
        client.cancelTask(taskId, options),
      ),
  };
}

async function measure<T>(
  telemetry: SecureTelemetry,
  operation: string,
  options: OperationOptions | undefined,
  invoke: () => Promise<T>,
): Promise<T> {
  const timed = telemetry.beginA2a(operation);
  try {
    const result = await invoke();
    timed.end(options?.signal?.aborted === true ? "aborted" : "ok");
    return result;
  } catch (error) {
    timed.end(options?.signal?.aborted === true ? "aborted" : "error");
    throw error;
  }
}
