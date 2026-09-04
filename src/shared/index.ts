// Public API surface required by the standalone Arcade CLI.
export * from "./game-rules.js";

function pathSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return encodeURIComponent(normalized);
}

export const apiPaths = Object.freeze({
  devices: "/api/v1/devices",
  gameRuns: "/api/v1/game-runs",
  gameScore: (runId: string) => `/api/v1/game-runs/${pathSegment(runId, "runId")}/score`
});
