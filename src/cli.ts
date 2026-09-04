#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import process, { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  gameDescriptors,
  type GameCode,
  type GameDescriptor
} from "./shared/index.js";
import { CliUsageError, parseCliOptions } from "./args.js";
import { runDoctor } from "./commands/doctor.js";
import { loadArcadeConfig } from "./config.js";
import { runGame, type GameRunResult, type GameStreams } from "./games.js";
import { linkDevice, startOnlineRun, submitOnlineScore } from "./online.js";

const help = `Usage: boring-arcade [command] [options]

Commands:
  link CODE                         Pair this CLI with a Pending Club account
  doctor                            Check the runtime and API configuration

Game options:
  --list --json                     List the three launch games
  --game GAME                       completion-hell, bracket-balance, or slack-off-breakout
  --offline                         Play locally and never upload (default)
  --online                          Request a signed ranked run and upload the result
  --seed SEED                       Use a repeatable offline seed
  --scripted-input INPUT            Deterministic offline input for verification
  --json                            Print machine-readable output
  --help                            Show this help
  --version                         Show the CLI version

Inside a game, press Q to exit. Breakout uses Left/Right or A/D; Space stops the paddle.
`;

interface CliStreams extends GameStreams {
  input: typeof stdin;
  output: typeof stdout;
  error: typeof stderr;
}

function descriptor(game: GameCode): GameDescriptor {
  const value = gameDescriptors.find((candidate) => candidate.code === game);
  if (!value) throw new Error(`Game descriptor is missing: ${game}`);
  return value;
}

async function selectGame(streams: CliStreams): Promise<GameCode | undefined> {
  if (!streams.input.isTTY) {
    throw new CliUsageError("Choose a game with --game when no interactive terminal is attached");
  }
  const terminal = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: true
  });
  try {
    while (true) {
      streams.output.write(
        "\nPending Club · Waiting Games\n" +
          gameDescriptors.map((game, index) => `  ${index + 1}. ${game.name}`).join("\n") +
          "\n"
      );
      const answer = (await terminal.question("Choose 1-3 (Q exits): ")).trim().toLowerCase();
      if (answer === "q") return undefined;
      if (/^[1-3]$/.test(answer)) return gameDescriptors[Number(answer) - 1]?.code;
      streams.output.write("Choose 1, 2, 3, or Q.\n");
    }
  } finally {
    terminal.close();
  }
}

async function pairingCode(
  provided: string | undefined,
  json: boolean,
  streams: CliStreams
): Promise<string> {
  if (provided) return provided;
  if (json || !streams.input.isTTY) {
    throw new CliUsageError("link requires a six-character pairing code");
  }
  const terminal = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: true
  });
  try {
    return (await terminal.question("Pending Club pairing code: ")).trim();
  } finally {
    terminal.close();
  }
}

function resultOutput(
  result: GameRunResult,
  seed: string,
  ranked: boolean,
  uploaded: boolean,
  receiptId?: string
) {
  const game = descriptor(result.game);
  return {
    game: result.game,
    name: game.name,
    score: result.score,
    maxScore: game.maxScore,
    seed,
    rulesetVersion: game.rulesetVersion,
    runSeconds: result.runSeconds,
    resultTrace: result.resultTrace,
    completed: result.completed,
    exited: result.exited,
    ranked,
    uploaded,
    ...(receiptId ? { receiptId } : {})
  };
}

function writeHumanResult(
  streams: CliStreams,
  result: ReturnType<typeof resultOutput>
): void {
  streams.output.write(`\n${result.name}: ${result.score}/${result.maxScore}\n`);
  if (result.uploaded) {
    streams.output.write(`Uploaded${result.ranked ? " for leaderboard validation" : ""}.\n`);
  } else if (result.exited) {
    streams.output.write("Run exited; no score was uploaded.\n");
  } else {
    streams.output.write("Offline result: not ranked and not uploaded.\n");
  }
}

export async function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  streams: CliStreams = { input: stdin, output: stdout, error: stderr }
): Promise<number> {
  const options = parseCliOptions(args);
  const config = loadArcadeConfig(environment);

  if (options.command === "help") {
    streams.output.write(help);
    return 0;
  }
  if (options.command === "version") {
    streams.output.write(`${config.version}\n`);
    return 0;
  }
  if (options.command === "doctor") {
    const result = runDoctor(config);
    streams.output.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `Runtime: ${result.runtime}\nAPI: ${result.apiOrigin}\n`
    );
    return 0;
  }
  if (options.command === "list") {
    const result = { version: config.version, games: gameDescriptors };
    streams.output.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `${gameDescriptors.map((game) => `${game.code}\t${game.name}\tmax ${game.maxScore}`).join("\n")}\n`
    );
    return 0;
  }
  if (options.command === "link") {
    const result = await linkDevice(
      config,
      environment,
      await pairingCode(options.pairingCode, options.json, streams)
    );
    streams.output.write(
      options.json
        ? `${JSON.stringify({ status: "linked", ...result })}\n`
        : `Linked device ${result.deviceId}. The private key remains on this machine.\n`
    );
    return 0;
  }

  if (options.json && !options.game) {
    throw new CliUsageError("--json requires --game, --list, doctor, link, or --version");
  }
  const game = options.game ?? (await selectGame(streams));
  if (!game) return 0;
  const gameStreams: GameStreams = options.json
    ? { input: streams.input, output: streams.error, error: streams.error }
    : streams;

  if (options.mode === "offline") {
    const seed = options.seed ?? randomBytes(16).toString("hex");
    const gameResult = await runGame(game, seed, gameStreams, options.scriptedInput);
    const output = resultOutput(gameResult, seed, false, false);
    if (options.json) streams.output.write(`${JSON.stringify(output)}\n`);
    else writeHumanResult(streams, output);
    return 0;
  }

  const ticket = await startOnlineRun(config, environment, game);
  const gameResult = await runGame(game, ticket.seed, gameStreams, undefined);
  if (!gameResult.completed || gameResult.exited) {
    const output = resultOutput(gameResult, ticket.seed, false, false);
    if (options.json) streams.output.write(`${JSON.stringify(output)}\n`);
    else writeHumanResult(streams, output);
    return 0;
  }
  try {
    const receipt = await submitOnlineScore(
      config,
      ticket,
      gameResult.score,
      gameResult.runSeconds,
      gameResult.resultTrace
    );
    const output = resultOutput(
      gameResult,
      ticket.seed,
      receipt.ranked,
      true,
      receipt.id
    );
    if (options.json) streams.output.write(`${JSON.stringify(output)}\n`);
    else writeHumanResult(streams, output);
    return 0;
  } catch (error) {
    const output = resultOutput(gameResult, ticket.seed, false, false);
    if (options.json) streams.output.write(`${JSON.stringify(output)}\n`);
    else writeHumanResult(streams, output);
    throw error;
  }
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown Arcade failure";
  stderr.write(`Arcade failed: ${message}.\n`);
  if (error instanceof CliUsageError) stderr.write("Run boring-arcade --help for usage.\n");
  process.exitCode = 1;
}
