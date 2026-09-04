import { randomUUID } from "node:crypto";
import {
  apiPaths,
  createGameRunSignaturePayload,
  createGameScoreSignaturePayload,
  GAME_RULESET_VERSION,
  type GameCode,
  type GameResultTrace
} from "./shared/index.js";
import type { ArcadeConfig } from "./config.js";
import {
  ensureLocalDevice,
  loadLocalDevice,
  saveLinkedDevice,
  signCanonicalPayload,
  type LocalDevice
} from "./device.js";
import { requestData } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: Record<string, unknown>,
  ...names: readonly string[]
): string {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  throw new Error(`Arcade response is missing ${names[0] ?? "a field"}`);
}

export interface LinkResult {
  deviceId: string;
  publicKey: string;
  algorithm: "ed25519";
}

export interface OnlineRunTicket {
  runId: string;
  game: GameCode;
  seed: string;
  challengeNonce: string;
  rulesetVersion: typeof GAME_RULESET_VERSION;
  expiresAt: string;
  device: LocalDevice;
}

export interface ScoreReceipt {
  id: string;
  ranked: boolean;
}

export async function linkDevice(
  config: ArcadeConfig,
  environment: NodeJS.ProcessEnv,
  pairingCode: string
): Promise<LinkResult> {
  const normalizedCode = pairingCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
    throw new Error("Pairing code must contain exactly six letters or digits");
  }
  const device = await ensureLocalDevice(environment);
  const data = await requestData(config, apiPaths.devices, {
    method: "POST",
    body: JSON.stringify({
      pairingCode: normalizedCode,
      publicKey: device.publicKey,
      algorithm: device.algorithm
    })
  });
  if (!isRecord(data)) throw new Error("Pairing response is invalid");
  const deviceId = requiredString(data, "id", "device_id", "deviceId");
  await saveLinkedDevice(environment, device, deviceId);
  return { deviceId, publicKey: device.publicKey, algorithm: "ed25519" };
}

export async function startOnlineRun(
  config: ArcadeConfig,
  environment: NodeJS.ProcessEnv,
  game: GameCode
): Promise<OnlineRunTicket> {
  const device = await loadLocalDevice(environment);
  if (!device?.deviceId) {
    throw new Error("This CLI is not linked. Generate a Pending Club pairing code, then run boring-arcade link CODE");
  }
  const signedRequest = createGameRunSignaturePayload({
    device_id: device.deviceId,
    game,
    request_nonce: randomUUID(),
    requested_at: new Date().toISOString()
  });
  const data = await requestData(config, apiPaths.gameRuns, {
    method: "POST",
    body: JSON.stringify({
      ...signedRequest,
      algorithm: device.algorithm,
      signature: signCanonicalPayload(device, signedRequest)
    })
  });
  if (!isRecord(data)) throw new Error("Game run ticket is invalid");
  const ticketGame = requiredString(data, "game");
  if (ticketGame !== game) throw new Error("Game run ticket does not match the requested game");
  const rulesetVersion = requiredString(data, "ruleset_version", "rulesetVersion");
  if (rulesetVersion !== GAME_RULESET_VERSION) {
    throw new Error(`Unsupported server ruleset: ${rulesetVersion}`);
  }
  const expiresAt = requiredString(data, "expires_at", "expiresAt");
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error("Game run ticket is already expired");
  }
  return {
    runId: requiredString(data, "run_id", "runId", "id"),
    game,
    seed: requiredString(data, "seed"),
    challengeNonce: requiredString(data, "challenge_nonce", "challengeNonce", "nonce"),
    rulesetVersion,
    expiresAt,
    device
  };
}

export async function submitOnlineScore(
  config: ArcadeConfig,
  ticket: OnlineRunTicket,
  score: number,
  runSeconds: number,
  resultTrace: GameResultTrace
): Promise<ScoreReceipt> {
  if (!Number.isInteger(score) || score < 0) throw new Error("Score is invalid");
  const signedPayload = createGameScoreSignaturePayload({
    run_id: ticket.runId,
    game: ticket.game,
    score,
    run_seconds: runSeconds,
    challenge_nonce: ticket.challengeNonce,
    ruleset_version: ticket.rulesetVersion,
    result_trace: resultTrace
  });
  const data = await requestData(config, apiPaths.gameScore(ticket.runId), {
    method: "POST",
    body: JSON.stringify({
      ...signedPayload,
      device_id: ticket.device.deviceId,
      algorithm: ticket.device.algorithm,
      signature: signCanonicalPayload(ticket.device, signedPayload)
    })
  });
  if (!isRecord(data)) throw new Error("Score receipt is invalid");
  return {
    id: requiredString(data, "id", "score_id", "scoreId"),
    ranked: typeof data.ranked === "boolean" ? data.ranked : true
  };
}
