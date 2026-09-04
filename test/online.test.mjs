import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  COMPLETION_HELL_ROUNDS,
  GAME_RULESET_VERSION,
  canonicalJson,
  generateCompletionHellQuestion,
  scoreCompletionHell
} from "../dist/shared/index.js";
import { deviceFilePath, loadLocalDevice } from "../dist/device.js";
import { loadArcadeConfig } from "../dist/config.js";
import { linkDevice, startOnlineRun, submitOnlineScore } from "../dist/online.js";

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.once("end", () => resolve(JSON.parse(body)));
    request.once("error", reject);
  });
}

function send(response, status, data) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ data }));
}

test("remote arcade API origins require HTTPS", () => {
  assert.equal(loadArcadeConfig({}).apiOrigin, "https://pendingclub.com");
  assert.throws(
    () =>
      loadArcadeConfig({
        BORING_ARCADE_API_ORIGIN: "http://api.example.test"
      }),
    /must use HTTPS/
  );
  assert.equal(
    loadArcadeConfig({
      BORING_ARCADE_API_ORIGIN: "http://127.0.0.1:3210"
    }).apiOrigin,
    "http://127.0.0.1:3210"
  );
  assert.equal(
    loadArcadeConfig({
      BORING_ARCADE_API_ORIGIN: "https://boring.example"
    }).apiOrigin,
    "https://boring.example"
  );
});

test("link, online ticket, and score submission use one persistent Ed25519 key", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "boring-arcade-test-"));
  t.after(() => rm(home, { force: true, recursive: true }));
  const environment = { ...process.env, BORING_ARCADE_HOME: home };
  let publicKeyBase64;
  let scorePayload;
  let scoreSignature;

  const server = createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      if (request.url === "/api/v1/devices") {
        assert.equal(body.pairingCode, "ABC123");
        assert.equal(body.algorithm, "ed25519");
        assert.equal(typeof body.privateKey, "undefined");
        publicKeyBase64 = body.publicKey;
        send(response, 201, { id: "device-1" });
        return;
      }

      const publicKey = createPublicKey({
        format: "der",
        key: Buffer.from(publicKeyBase64, "base64"),
        type: "spki"
      });
      if (request.url === "/api/v1/game-runs") {
        const signed = {
          device_id: body.device_id,
          game: body.game,
          request_nonce: body.request_nonce,
          requested_at: body.requested_at
        };
        assert.equal(
          verify(
            null,
            Buffer.from(canonicalJson(signed)),
            publicKey,
            Buffer.from(body.signature, "base64")
          ),
          true
        );
        send(response, 201, {
          run_id: "run-1",
          game: "completion-hell",
          seed: "online-seed",
          challenge_nonce: "challenge-1",
          ruleset_version: GAME_RULESET_VERSION,
          expires_at: new Date(Date.now() + 60_000).toISOString()
        });
        return;
      }
      if (request.url === "/api/v1/game-runs/run-1/score") {
        scoreSignature = body.signature;
        scorePayload = {
          run_id: body.run_id,
          game: body.game,
          score: body.score,
          run_seconds: body.run_seconds,
          challenge_nonce: body.challenge_nonce,
          ruleset_version: body.ruleset_version,
          result_trace: body.result_trace
        };
        assert.equal(
          verify(
            null,
            Buffer.from(canonicalJson(scorePayload)),
            publicKey,
            Buffer.from(body.signature, "base64")
          ),
          true
        );
        send(response, 201, { id: "score-1", ranked: true });
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = {
    apiOrigin: `http://127.0.0.1:${address.port}`,
    requestTimeoutMs: 5_000,
    version: "test"
  };

  const linked = await linkDevice(config, environment, "abc123");
  assert.equal(linked.deviceId, "device-1");
  const stored = JSON.parse(await readFile(deviceFilePath(environment), "utf8"));
  assert.equal(typeof stored.privateKey, "string");
  assert.equal(stored.deviceId, "device-1");
  if (process.platform !== "win32") {
    assert.equal((await stat(deviceFilePath(environment))).mode & 0o077, 0);
  }

  const ticket = await startOnlineRun(config, environment, "completion-hell");
  assert.equal(ticket.runId, "run-1");
  const trace = {
    game: "completion-hell",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds: Array.from({ length: COMPLETION_HELL_ROUNDS }, (_, round) => ({
      choice: generateCompletionHellQuestion(ticket.seed, round).correctOption,
      elapsedBucket: 0
    }))
  };
  const receipt = await submitOnlineScore(
    config,
    ticket,
    scoreCompletionHell(ticket.seed, trace),
    1,
    trace
  );
  assert.deepEqual(receipt, { id: "score-1", ranked: true });
  assert.equal(scorePayload.score, 1_500);
  assert.equal(JSON.stringify(scorePayload).includes("privateKey"), false);
  const publicKey = createPublicKey({
    format: "der",
    key: Buffer.from(publicKeyBase64, "base64"),
    type: "spki"
  });
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson({ ...scorePayload, score: 1_499 })),
      publicKey,
      Buffer.from(scoreSignature, "base64")
    ),
    false
  );
  assert.equal((await loadLocalDevice(environment)).deviceId, "device-1");
});
