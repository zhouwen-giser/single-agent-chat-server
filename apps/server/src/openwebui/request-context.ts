import type { FastifyRequest } from "fastify";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(256);

export interface OpenWebUiRequestContext {
  readonly chatId: string;
  readonly messageId: string;
  readonly userMessageId: string;
  readonly userMessageParentId?: string;
  readonly utilityTask?: string;
}

export function parseOpenWebUiRequestContext(
  request: FastifyRequest,
): OpenWebUiRequestContext {
  const parsed = z
    .object({
      chatId: identifierSchema,
      messageId: identifierSchema,
      userMessageId: identifierSchema,
      userMessageParentId: identifierSchema.optional(),
      utilityTask: z.string().trim().min(1).max(128).optional(),
    })
    .safeParse({
      chatId: header(request, "x-openwebui-chat-id"),
      messageId: header(request, "x-openwebui-message-id"),
      userMessageId: header(request, "x-openwebui-user-message-id"),
      userMessageParentId: optionalHeader(
        request,
        "x-openwebui-user-message-parent-id",
      ),
      utilityTask: optionalHeader(request, "x-openwebui-task"),
    });
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .filter((value) => value.length > 0)
      .join(", ");
    throw new OpenWebUiContextError(
      `Invalid or missing Open WebUI request headers: ${missing}`,
    );
  }
  return parsed.data;
}

export class OpenWebUiContextError extends Error {
  readonly statusCode = 400;
}

function optionalHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = header(request, name);
  return value === undefined || value.trim() === "" ? undefined : value;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
