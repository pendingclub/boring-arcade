import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const arcadeEntry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function run(...args) {
  const result = await execFileAsync(process.execPath, [arcadeEntry, ...args], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  return { ...result, output: JSON.parse(result.stdout) };
}

test("CLI lists exactly the three launch games", async () => {
  const { stderr, output } = await run("--list", "--json");
  assert.equal(stderr, "");
  assert.deepEqual(
    output.games.map((game) => game.code),
    ["completion-hell", "bracket-balance", "slack-off-breakout"]
  );
});

test("fixed seed scripted runs are deterministic, offline, and bounded", async () => {
  const common = ["--offline", "--seed", "cli-fixed-seed", "--scripted-input", "auto", "--json"];
  const first = await run("--game", "completion-hell", ...common);
  const second = await run("--game", "completion-hell", ...common);
  assert.deepEqual(first.output, second.output);
  assert.equal(first.output.score, 1_500);

  const bracket = await run("--game", "bracket-balance", ...common);
  assert.equal(bracket.output.score, 1_900);

  const breakout = await run("--game", "slack-off-breakout", ...common);
  assert.equal(breakout.output.score, 900);
  assert.equal(breakout.output.completed, true);

  for (const result of [first.output, bracket.output, breakout.output]) {
    assert.equal(result.ranked, false);
    assert.equal(result.uploaded, false);
    assert.ok(result.score >= 0 && result.score <= result.maxScore);
  }
});

test("Q exits a question game without uploading", async () => {
  const { output } = await run(
    "--game",
    "completion-hell",
    "--offline",
    "--seed",
    "quit-seed",
    "--scripted-input",
    "q",
    "--json"
  );
  assert.equal(output.exited, true);
  assert.equal(output.completed, false);
  assert.equal(output.uploaded, false);
});
