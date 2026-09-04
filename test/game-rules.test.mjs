import assert from "node:assert/strict";
import test from "node:test";
import {
  BRACKET_BALANCE_ROUNDS,
  COMPLETION_HELL_ROUNDS,
  GAME_RULESET_VERSION,
  canonicalJson,
  createGameScoreSignaturePayload,
  generateBracketBalanceQuestion,
  generateCompletionHellQuestion,
  scoreBracketBalance,
  scoreCompletionHell,
  scoreGameTrace
} from "../dist/shared/index.js";

test("fixed seeds generate repeatable questions and locked maximum scores", () => {
  const seed = "arcade-unit-seed";
  assert.deepEqual(
    generateCompletionHellQuestion(seed, 3),
    generateCompletionHellQuestion(seed, 3)
  );
  assert.deepEqual(
    generateBracketBalanceQuestion(seed, 7),
    generateBracketBalanceQuestion(seed, 7)
  );

  const completionTrace = {
    game: "completion-hell",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds: Array.from({ length: COMPLETION_HELL_ROUNDS }, (_, round) => ({
      choice: generateCompletionHellQuestion(seed, round).correctOption,
      elapsedBucket: 0
    }))
  };
  const bracketTrace = {
    game: "bracket-balance",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds: Array.from({ length: BRACKET_BALANCE_ROUNDS }, (_, round) => ({
      answer: generateBracketBalanceQuestion(seed, round).balanced,
      elapsedBucket: 0
    }))
  };

  assert.equal(scoreCompletionHell(seed, completionTrace), 1_500);
  assert.equal(scoreBracketBalance(seed, bracketTrace), 1_900);
  assert.equal("prompt" in completionTrace.rounds[0], false);
  assert.equal("sequence" in bracketTrace.rounds[0], false);
});

test("canonical JSON sorts keys recursively and rejects unsafe values", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, b: [3, "x"] } }),
    '{"a":{"b":[3,"x"],"y":true},"z":1}'
  );
  assert.throws(() => canonicalJson({ value: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
});

test("ranked verification rejects incomplete traces and game-specific overflow", () => {
  const incomplete = {
    game: "completion-hell",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds: []
  };
  assert.throws(
    () => scoreGameTrace("completion-hell", "seed", incomplete),
    /must contain ten rounds/
  );
  assert.throws(
    () =>
      createGameScoreSignaturePayload({
        run_id: "run-1",
        game: "completion-hell",
        score: 1_501,
        run_seconds: 1,
        challenge_nonce: "nonce-1",
        ruleset_version: GAME_RULESET_VERSION,
        result_trace: incomplete
      }),
    /Score exceeds the game maximum/
  );
});
