import { parseGameCode, type GameCode } from "./shared/index.js";

export type CliCommand = "doctor" | "help" | "link" | "list" | "menu" | "play" | "version";

export interface CliOptions {
  command: CliCommand;
  game: GameCode | undefined;
  json: boolean;
  mode: "offline" | "online";
  pairingCode: string | undefined;
  scriptedInput: string | undefined;
  seed: string | undefined;
}

export class CliUsageError extends Error {
  override readonly name = "CliUsageError";
}

function optionValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`${name} requires a value`);
  }
  return value;
}

export function parseCliOptions(args: readonly string[]): CliOptions {
  let command: CliCommand = args.length === 0 ? "menu" : "play";
  let game: GameCode | undefined;
  let json = false;
  let mode: "offline" | "online" = "offline";
  let pairingCode: string | undefined;
  let scriptedInput: string | undefined;
  let seed: string | undefined;
  let modeWasSet = false;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (argument === "--json") {
      json = true;
    } else if (argument === "--help" || argument === "-h") {
      command = "help";
    } else if (argument === "--version" || argument === "-v") {
      command = "version";
    } else if (argument === "--list") {
      command = "list";
    } else if (argument === "--offline" || argument === "--online") {
      const nextMode = argument === "--online" ? "online" : "offline";
      if (modeWasSet && mode !== nextMode) {
        throw new CliUsageError("--offline and --online cannot be combined");
      }
      mode = nextMode;
      modeWasSet = true;
    } else if (argument === "--game") {
      const value = optionValue(args, index, "--game");
      index += 1;
      game = parseGameCode(value);
      if (!game) throw new CliUsageError(`Unknown game: ${value}`);
    } else if (argument.startsWith("--game=")) {
      const value = argument.slice("--game=".length);
      game = parseGameCode(value);
      if (!game) throw new CliUsageError(`Unknown game: ${value}`);
    } else if (argument === "--scripted-input") {
      scriptedInput = optionValue(args, index, "--scripted-input");
      index += 1;
    } else if (argument.startsWith("--scripted-input=")) {
      scriptedInput = argument.slice("--scripted-input=".length);
    } else if (argument === "--seed") {
      seed = optionValue(args, index, "--seed");
      index += 1;
    } else if (argument.startsWith("--seed=")) {
      seed = argument.slice("--seed=".length);
    } else if (argument.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  const first = positional[0];
  if (first === "doctor") {
    command = "doctor";
  } else if (first === "link") {
    command = "link";
    pairingCode = positional[1];
    if (positional.length > 2) throw new CliUsageError("link accepts one pairing code");
  } else if (first) {
    const positionalGame = parseGameCode(first);
    if (!positionalGame) throw new CliUsageError(`Unknown command: ${first}`);
    if (game && game !== positionalGame) {
      throw new CliUsageError("Game was provided more than once");
    }
    game = positionalGame;
  }

  if (command === "play" && !game) command = "menu";
  if (scriptedInput !== undefined && scriptedInput.trim().length === 0) {
    throw new CliUsageError("--scripted-input must not be empty");
  }
  if (seed !== undefined && (seed.trim().length === 0 || seed.length > 128)) {
    throw new CliUsageError("--seed must contain between 1 and 128 characters");
  }
  if (mode === "online" && seed !== undefined) {
    throw new CliUsageError("Online runs receive their seed from the server");
  }
  if (mode === "online" && scriptedInput !== undefined) {
    throw new CliUsageError("Scripted input is restricted to offline verification runs");
  }

  return {
    command,
    game,
    json,
    mode,
    pairingCode,
    scriptedInput,
    seed: seed?.trim()
  };
}
