import { env } from "node:process";

export interface ArcadeConfig {
  apiOrigin: string;
  requestTimeoutMs: number;
  version: string;
}

function requestTimeout(value: string | undefined): number {
  const parsed = Number(value ?? "10000");
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new Error("BORING_ARCADE_REQUEST_TIMEOUT_MS must be between 100 and 60000");
  }
  return parsed;
}

export function loadArcadeConfig(
  environment: NodeJS.ProcessEnv = env
): ArcadeConfig {
  const apiOrigin = new URL(
    environment.BORING_ARCADE_API_ORIGIN?.trim() || "https://pendingclub.com"
  );
  if (apiOrigin.protocol !== "http:" && apiOrigin.protocol !== "https:") {
    throw new Error("BORING_ARCADE_API_ORIGIN must use HTTP or HTTPS");
  }
  const loopback =
    apiOrigin.hostname === "localhost" ||
    apiOrigin.hostname === "127.0.0.1" ||
    apiOrigin.hostname === "[::1]";
  if (apiOrigin.protocol === "http:" && !loopback) {
    throw new Error("Remote BORING_ARCADE_API_ORIGIN must use HTTPS");
  }
  return {
    apiOrigin: apiOrigin.origin,
    requestTimeoutMs: requestTimeout(environment.BORING_ARCADE_REQUEST_TIMEOUT_MS),
    version: environment.BORING_ARCADE_VERSION?.trim() || "0.1.0"
  };
}
