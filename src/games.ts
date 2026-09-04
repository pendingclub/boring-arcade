import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  BRACKET_BALANCE_ROUNDS,
  BRACKET_BALANCE_TIMEOUT_BUCKET,
  BREAKOUT_COLUMNS,
  BREAKOUT_MAX_STEPS,
  BREAKOUT_ROWS,
  BREAKOUT_STEP_MS,
  COMPLETION_HELL_ROUNDS,
  COMPLETION_HELL_TIMEOUT_BUCKET,
  GAME_RULESET_VERSION,
  createBreakoutState,
  generateBracketBalanceQuestion,
  generateCompletionHellQuestion,
  replayBreakout,
  scoreBracketBalance,
  scoreCompletionHell,
  stepBreakout,
  type BracketBalanceTrace,
  type BreakoutDirection,
  type BreakoutInputChange,
  type BreakoutState,
  type BreakoutTrace,
  type CompletionHellTrace,
  type GameCode,
  type GameResultTrace
} from "./shared/index.js";

interface TerminalInput extends Readable {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
}

interface TerminalOutput extends Writable {
  isTTY?: boolean;
}

export interface GameStreams {
  input: TerminalInput;
  output: TerminalOutput;
  error: TerminalOutput;
}

export interface GameRunResult {
  game: GameCode;
  score: number;
  runSeconds: number;
  resultTrace: GameResultTrace;
  completed: boolean;
  exited: boolean;
}

interface TimedAnswer {
  answer: string | null;
  elapsedMs: number;
}

function scriptedTokens(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

async function timedQuestion(
  terminal: ReturnType<typeof createInterface>,
  prompt: string,
  timeoutMs: number
): Promise<TimedAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const answer = await terminal.question(prompt, { signal: controller.signal });
    return { answer: answer.trim().toLowerCase(), elapsedMs: performance.now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { answer: null, elapsedMs: timeoutMs };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function secondsFromMilliseconds(milliseconds: number): number {
  return Math.max(0.001, Number((milliseconds / 1_000).toFixed(3)));
}

function parseChoiceToken(token: string): { choice: number; elapsedBucket: number } | "exit" {
  const match = /^(q|[1-4])(?:[@:](\d+))?$/.exec(token);
  if (!match) throw new Error(`Invalid Completion Hell scripted input: ${token}`);
  if (match[1] === "q") return "exit";
  const choice = Number(match[1]) - 1;
  const elapsedBucket = Number(match[2] ?? 0);
  if (elapsedBucket < 0 || elapsedBucket > COMPLETION_HELL_TIMEOUT_BUCKET) {
    throw new Error(`Completion Hell time bucket must be 0-${COMPLETION_HELL_TIMEOUT_BUCKET}`);
  }
  return { choice, elapsedBucket };
}

async function runCompletionHell(
  seed: string,
  streams: GameStreams,
  scriptedInput: string | undefined
): Promise<GameRunResult> {
  const rounds: Array<{ choice: number; elapsedBucket: number }> = [];
  const isAuto = scriptedInput?.trim().toLowerCase() === "auto";
  const tokens = scriptedInput && !isAuto ? scriptedTokens(scriptedInput) : [];
  const promptOutput = streams.output;
  const terminal = scriptedInput
    ? null
    : createInterface({ input: streams.input, output: promptOutput, terminal: Boolean(streams.input.isTTY) });
  let exited = false;
  let elapsedMs = 0;

  try {
    for (let roundIndex = 0; roundIndex < COMPLETION_HELL_ROUNDS; roundIndex += 1) {
      const question = generateCompletionHellQuestion(seed, roundIndex);
      if (isAuto) {
        rounds.push({ choice: question.correctOption, elapsedBucket: 0 });
        continue;
      }
      if (scriptedInput) {
        const token = tokens[roundIndex];
        if (!token) {
          rounds.push({ choice: -1, elapsedBucket: COMPLETION_HELL_TIMEOUT_BUCKET });
          elapsedMs += 15_000;
          continue;
        }
        const parsed = parseChoiceToken(token);
        if (parsed === "exit") {
          exited = true;
          break;
        }
        rounds.push(parsed);
        elapsedMs += parsed.elapsedBucket * 300;
        continue;
      }

      const options = question.options
        .map((option, index) => `  ${index + 1}. ${option}`)
        .join("\n");
      const response = await timedQuestion(
        terminal!,
        `\n${roundIndex + 1}/${COMPLETION_HELL_ROUNDS}\n${question.prompt}\n${options}\nChoice 1-4 (Q exits): `,
        15_000
      );
      elapsedMs += response.elapsedMs;
      if (response.answer === "q") {
        exited = true;
        break;
      }
      const choice = response.answer && /^[1-4]$/.test(response.answer)
        ? Number(response.answer) - 1
        : -1;
      rounds.push({
        choice,
        elapsedBucket: response.answer === null
          ? COMPLETION_HELL_TIMEOUT_BUCKET
          : Math.min(COMPLETION_HELL_TIMEOUT_BUCKET, Math.floor(response.elapsedMs / 300))
      });
    }
  } finally {
    terminal?.close();
  }

  const resultTrace: CompletionHellTrace = {
    game: "completion-hell",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds
  };
  return {
    game: "completion-hell",
    score: scoreCompletionHell(seed, resultTrace),
    runSeconds: secondsFromMilliseconds(elapsedMs),
    resultTrace,
    completed: rounds.length === COMPLETION_HELL_ROUNDS,
    exited
  };
}

function parseBracketToken(
  token: string
): { answer: boolean | null; elapsedBucket: number } | "exit" {
  const match = /^(q|balanced|unbalanced|true|false|yes|no|y|n|1|0)(?:[@:](\d+))?$/.exec(token);
  if (!match) throw new Error(`Invalid Bracket Balance scripted input: ${token}`);
  if (match[1] === "q") return "exit";
  const elapsedBucket = Number(match[2] ?? 0);
  if (elapsedBucket < 0 || elapsedBucket > BRACKET_BALANCE_TIMEOUT_BUCKET) {
    throw new Error(`Bracket Balance time bucket must be 0-${BRACKET_BALANCE_TIMEOUT_BUCKET}`);
  }
  return {
    answer: ["balanced", "true", "yes", "y", "1"].includes(match[1] ?? ""),
    elapsedBucket
  };
}

async function runBracketBalance(
  seed: string,
  streams: GameStreams,
  scriptedInput: string | undefined
): Promise<GameRunResult> {
  const rounds: Array<{ answer: boolean | null; elapsedBucket: number }> = [];
  const isAuto = scriptedInput?.trim().toLowerCase() === "auto";
  const tokens = scriptedInput && !isAuto ? scriptedTokens(scriptedInput) : [];
  const terminal = scriptedInput
    ? null
    : createInterface({ input: streams.input, output: streams.output, terminal: Boolean(streams.input.isTTY) });
  let exited = false;
  let elapsedMs = 0;

  try {
    for (let roundIndex = 0; roundIndex < BRACKET_BALANCE_ROUNDS; roundIndex += 1) {
      const question = generateBracketBalanceQuestion(seed, roundIndex);
      if (isAuto) {
        rounds.push({ answer: question.balanced, elapsedBucket: 0 });
        continue;
      }
      if (scriptedInput) {
        const token = tokens[roundIndex];
        if (!token) {
          rounds.push({ answer: null, elapsedBucket: BRACKET_BALANCE_TIMEOUT_BUCKET });
          elapsedMs += 5_000;
          continue;
        }
        const parsed = parseBracketToken(token);
        if (parsed === "exit") {
          exited = true;
          break;
        }
        rounds.push(parsed);
        elapsedMs += parsed.elapsedBucket * 1_000;
        continue;
      }

      const response = await timedQuestion(
        terminal!,
        `\n${roundIndex + 1}/${BRACKET_BALANCE_ROUNDS}  ${question.sequence}\nBalanced? Y/N (Q exits): `,
        5_000
      );
      elapsedMs += response.elapsedMs;
      if (response.answer === "q") {
        exited = true;
        break;
      }
      const answer = response.answer === null
        ? null
        : ["y", "yes", "1", "true", "balanced"].includes(response.answer)
          ? true
          : ["n", "no", "0", "false", "unbalanced"].includes(response.answer)
            ? false
            : null;
      rounds.push({
        answer,
        elapsedBucket: response.answer === null
          ? BRACKET_BALANCE_TIMEOUT_BUCKET
          : Math.min(BRACKET_BALANCE_TIMEOUT_BUCKET, Math.floor(response.elapsedMs / 1_000))
      });
    }
  } finally {
    terminal?.close();
  }

  const resultTrace: BracketBalanceTrace = {
    game: "bracket-balance",
    rulesetVersion: GAME_RULESET_VERSION,
    rounds
  };
  return {
    game: "bracket-balance",
    score: scoreBracketBalance(seed, resultTrace),
    runSeconds: secondsFromMilliseconds(elapsedMs),
    resultTrace,
    completed: rounds.length === BRACKET_BALANCE_ROUNDS,
    exited
  };
}

function breakoutDirection(value: string): BreakoutDirection {
  if (["left", "l", "a", "-1"].includes(value)) return -1;
  if (["right", "r", "d", "1"].includes(value)) return 1;
  if (["none", "stop", "0"].includes(value)) return 0;
  throw new Error(`Invalid Breakout direction: ${value}`);
}

function parseBreakoutChanges(value: string): BreakoutInputChange[] {
  const tokens = scriptedTokens(value);
  const changes: BreakoutInputChange[] = [];
  let lastDirection: BreakoutDirection = 0;
  tokens.forEach((token, index) => {
    const explicit = /^(\d+):(left|right|none|stop|l|r|a|d|-1|0|1)$/.exec(token);
    const step = explicit ? Number(explicit[1]) : index;
    const direction = breakoutDirection(explicit?.[2] ?? token);
    if (direction !== lastDirection) {
      changes.push({ step, direction });
      lastDirection = direction;
    }
  });
  for (let index = 1; index < changes.length; index += 1) {
    const previous = changes[index - 1];
    const current = changes[index];
    if (!previous || !current || current.step <= previous.step) {
      throw new Error("Breakout scripted steps must be strictly increasing");
    }
  }
  return changes;
}

function automaticDirection(state: BreakoutState): BreakoutDirection {
  const paddleCenter = state.paddleX + 4;
  if (state.ballX < paddleCenter - 0.35) return -1;
  if (state.ballX > paddleCenter + 0.35) return 1;
  return 0;
}

function breakoutFrame(state: BreakoutState): string {
  const width = 40;
  const height = 22;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  for (let row = 0; row < BREAKOUT_ROWS; row += 1) {
    for (let column = 0; column < BREAKOUT_COLUMNS; column += 1) {
      if (!state.bricks[row * BREAKOUT_COLUMNS + column]) continue;
      for (let offset = 0; offset < 4; offset += 1) {
        const target = rows[row + 2];
        if (target) target[column * 4 + offset] = "#";
      }
    }
  }
  const paddle = rows[20];
  if (paddle) {
    for (let offset = 0; offset < 8; offset += 1) {
      const column = Math.round(state.paddleX) + offset;
      if (column >= 0 && column < width) paddle[column] = "=";
    }
  }
  const ballRow = Math.max(0, Math.min(height - 1, Math.round(state.ballY)));
  const ballColumn = Math.max(0, Math.min(width - 1, Math.round(state.ballX)));
  const target = rows[ballRow];
  if (target) target[ballColumn] = "o";
  return [
    `Slack-off Breakout  Score ${state.score}/900  Lives ${state.lives}  Q exits`,
    `+${"-".repeat(width)}+`,
    ...rows.map((row) => `|${row.join("")}|`),
    `+${"-".repeat(width)}+`
  ].join("\n");
}

async function runBreakout(
  seed: string,
  streams: GameStreams,
  scriptedInput: string | undefined
): Promise<GameRunResult> {
  let state = createBreakoutState(seed);
  let direction: BreakoutDirection = 0;
  let exited = false;
  const changes: BreakoutInputChange[] = [];
  const isAuto = scriptedInput?.trim().toLowerCase() === "auto";
  const scriptedChanges = scriptedInput && !isAuto ? parseBreakoutChanges(scriptedInput) : [];
  let scriptedChangeIndex = 0;

  if (scriptedInput) {
    while (!state.finished && state.step < BREAKOUT_MAX_STEPS) {
      const nextDirection: BreakoutDirection = isAuto
        ? automaticDirection(state)
        : scriptedChanges[scriptedChangeIndex]?.step === state.step
          ? scriptedChanges[scriptedChangeIndex]!.direction
          : direction;
      if (!isAuto && scriptedChanges[scriptedChangeIndex]?.step === state.step) {
        scriptedChangeIndex += 1;
      }
      if (nextDirection !== direction) {
        direction = nextDirection;
        changes.push({ step: state.step, direction });
      }
      state = stepBreakout(state, direction);
    }
  } else {
    if (!streams.input.isTTY || typeof streams.input.setRawMode !== "function") {
      throw new Error("Breakout needs an interactive terminal or --scripted-input");
    }
    let requestedDirection: BreakoutDirection = 0;
    let requestedExit = false;
    const onKeypress = (_input: string, key: Key): void => {
      if (key.ctrl && key.name === "c") requestedExit = true;
      else if (key.name === "q") requestedExit = true;
      else if (key.name === "left" || key.name === "a") requestedDirection = -1;
      else if (key.name === "right" || key.name === "d") requestedDirection = 1;
      else if (key.name === "space" || key.name === "down") requestedDirection = 0;
    };
    emitKeypressEvents(streams.input);
    streams.input.setRawMode(true);
    streams.input.resume();
    streams.input.on("keypress", onKeypress);
    try {
      while (!state.finished && state.step < BREAKOUT_MAX_STEPS) {
        if (requestedExit) {
          exited = true;
          break;
        }
        if (requestedDirection !== direction) {
          direction = requestedDirection;
          changes.push({ step: state.step, direction });
        }
        state = stepBreakout(state, direction);
        if (state.step % 2 === 0) {
          streams.output.write(`\u001b[2J\u001b[H${breakoutFrame(state)}`);
        }
        await delay(BREAKOUT_STEP_MS);
      }
    } finally {
      streams.input.off("keypress", onKeypress);
      streams.input.setRawMode(false);
      streams.output.write("\n");
    }
  }

  const resultTrace: BreakoutTrace = {
    game: "slack-off-breakout",
    rulesetVersion: GAME_RULESET_VERSION,
    inputChanges: changes,
    steps: state.step
  };
  return {
    game: "slack-off-breakout",
    score: replayBreakout(seed, resultTrace).score,
    runSeconds: secondsFromMilliseconds(state.step * BREAKOUT_STEP_MS),
    resultTrace,
    completed: state.finished,
    exited
  };
}

export function runGame(
  game: GameCode,
  seed: string,
  streams: GameStreams,
  scriptedInput: string | undefined
): Promise<GameRunResult> {
  switch (game) {
    case "completion-hell":
      return runCompletionHell(seed, streams, scriptedInput);
    case "bracket-balance":
      return runBracketBalance(seed, streams, scriptedInput);
    case "slack-off-breakout":
      return runBreakout(seed, streams, scriptedInput);
  }
}
