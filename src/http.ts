import type { ArcadeConfig } from "./config.js";

const maximumResponseBytes = 1_048_576;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ArcadeApiError extends Error {
  override readonly name = "ArcadeApiError";

  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: string | undefined,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export async function requestData(
  config: ArcadeConfig,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(new URL(path, config.apiOrigin), {
      ...init,
      headers,
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
  } catch (error) {
    throw new ArcadeApiError("The Arcade service is unavailable", undefined, undefined, {
      cause: error
    });
  }

  const content = await response.text();
  if (Buffer.byteLength(content, "utf8") > maximumResponseBytes) {
    throw new ArcadeApiError("The Arcade service returned too much data", response.status, undefined);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    throw new ArcadeApiError("The Arcade service returned an invalid response", response.status, undefined, {
      cause: error
    });
  }

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const code = typeof errorPayload?.code === "string" ? errorPayload.code : undefined;
    const message = typeof errorPayload?.message === "string"
      ? errorPayload.message.slice(0, 300)
      : `The Arcade service rejected the request (HTTP ${response.status})`;
    throw new ArcadeApiError(message, response.status, code);
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw new ArcadeApiError("The Arcade service response has no data envelope", response.status, undefined);
  }
  return payload.data;
}
