import { z } from "zod";

export const GAME_RULESET_VERSION = "1";

export const gameCodes = [
  "completion-hell",
  "bracket-balance",
  "slack-off-breakout"
] as const;

export type GameCode = (typeof gameCodes)[number];
export const gameCodeSchema = z.enum(gameCodes);

export interface GameDescriptor {
  code: GameCode;
  name: string;
  maxScore: number;
  rulesetVersion: string;
}

export const gameDescriptors: readonly GameDescriptor[] = Object.freeze([
  {
    code: "completion-hell",
    name: "Completion Hell",
    maxScore: 1_500,
    rulesetVersion: GAME_RULESET_VERSION
  },
  {
    code: "bracket-balance",
    name: "Bracket Balance",
    maxScore: 1_900,
    rulesetVersion: GAME_RULESET_VERSION
  },
  {
    code: "slack-off-breakout",
    name: "Slack-off Breakout",
    maxScore: 900,
    rulesetVersion: GAME_RULESET_VERSION
  }
]);

export function parseGameCode(value: string): GameCode | undefined {
  return gameCodes.find((code) => code === value);
}

function createRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16_777_619) >>> 0;
  }
  if (state === 0) state = 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = result[index];
    const replacement = result[target];
    if (current === undefined || replacement === undefined) {
      throw new Error("Shuffle index was outside the source array");
    }
    result[index] = replacement;
    result[target] = current;
  }
  return result;
}

const completionQuestionBank = [
  {
    prompt: "const active = items.___(item => item.active);",
    correct: "filter",
    distractors: ["map", "reduce", "find"]
  },
  {
    prompt: "const names = users.___(user => user.name);",
    correct: "map",
    distractors: ["filter", "some", "every"]
  },
  {
    prompt: "const total = prices.___((sum, price) => sum + price, 0);",
    correct: "reduce",
    distractors: ["map", "find", "sort"]
  },
  {
    prompt: "const first = queue.___();",
    correct: "shift",
    distractors: ["pop", "push", "slice"]
  },
  {
    prompt: "const copy = structuredClone(___);",
    correct: "source",
    distractors: ["target", "prototype", "constructor"]
  },
  {
    prompt: "await Promise.___(jobs.map(run));",
    correct: "all",
    distractors: ["race", "resolve", "reject"]
  },
  {
    prompt: "if (value ___ null) return fallback;",
    correct: "===",
    distractors: ["=", "=>", "!=="]
  },
  {
    prompt: "const unique = [...new ___(values)];",
    correct: "Set",
    distractors: ["Map", "Array", "WeakMap"]
  },
  {
    prompt: "const parsed = JSON.___(payload);",
    correct: "parse",
    distractors: ["stringify", "encode", "decode"]
  },
  {
    prompt: "controller.___();",
    correct: "abort",
    distractors: ["cancel", "close", "destroy"]
  },
  {
    prompt: "const exists = values.___(value => value === target);",
    correct: "some",
    distractors: ["every", "map", "flat"]
  },
  {
    prompt: "const sorted = values.toSorted((a, b) => a ___ b);",
    correct: "-",
    distractors: ["+", "===", "&&"]
  }
] as const;

export const COMPLETION_HELL_ROUNDS = 10;
export const COMPLETION_HELL_TIMEOUT_BUCKET = 50;

export interface CompletionHellQuestion {
  prompt: string;
  options: readonly string[];
  correctOption: number;
}

export interface CompletionHellTraceRound {
  choice: number;
  elapsedBucket: number;
}

export interface CompletionHellTrace {
  game: "completion-hell";
  rulesetVersion: typeof GAME_RULESET_VERSION;
  rounds: readonly CompletionHellTraceRound[];
}

export function generateCompletionHellQuestion(
  seed: string,
  roundIndex: number
): CompletionHellQuestion {
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= COMPLETION_HELL_ROUNDS) {
    throw new RangeError("Completion Hell round index is invalid");
  }
  const random = createRandom(`${seed}:completion-hell:${roundIndex}`);
  const questions = shuffled(completionQuestionBank, random);
  const selected = questions[roundIndex % questions.length];
  if (!selected) throw new Error("Completion Hell question bank is empty");
  const options = shuffled(
    [selected.correct, ...selected.distractors].map((text, index) => ({
      correct: index === 0,
      text
    })),
    random
  );
  return {
    prompt: selected.prompt,
    options: options.map((option) => option.text),
    correctOption: options.findIndex((option) => option.correct)
  };
}

export function scoreCompletionHell(
  seed: string,
  trace: CompletionHellTrace
): number {
  if (trace.game !== "completion-hell" || trace.rulesetVersion !== GAME_RULESET_VERSION) {
    throw new TypeError("Completion Hell trace uses an unsupported ruleset");
  }
  if (trace.rounds.length > COMPLETION_HELL_ROUNDS) {
    throw new RangeError("Completion Hell trace contains too many rounds");
  }

  let score = 0;
  trace.rounds.forEach((round, roundIndex) => {
    if (
      !Number.isInteger(round.choice) ||
      round.choice < -1 ||
      round.choice > 3 ||
      !Number.isInteger(round.elapsedBucket) ||
      round.elapsedBucket < 0 ||
      round.elapsedBucket > COMPLETION_HELL_TIMEOUT_BUCKET
    ) {
      throw new RangeError("Completion Hell trace contains an invalid choice or time bucket");
    }
    const question = generateCompletionHellQuestion(seed, roundIndex);
    if (round.choice === question.correctOption) {
      score += 100 + Math.max(0, 50 - round.elapsedBucket);
    }
  });
  return score;
}

const bracketQuestionBank = [
  "()[]{}",
  "([{}])",
  "{[()()]}",
  "(((())))",
  "[({}){}]",
  "(){}[([])]",
  "([)]",
  "((())",
  "{[(])}",
  "]{}[",
  "(()))(",
  "{[}",
  "[]((){})",
  "{{[[(())]]}}",
  "([{}{}])[]",
  "{()[]({})}",
  "({[()]})",
  "[[]]{{}}(())",
  "([{})]",
  "(([]){}",
  "{][}",
  "(()[])}",
  "[({}])(",
  "())(()"
] as const;

export const BRACKET_BALANCE_ROUNDS = 20;
export const BRACKET_BALANCE_TIMEOUT_BUCKET = 5;

export interface BracketBalanceQuestion {
  sequence: string;
  balanced: boolean;
}

export interface BracketBalanceTraceRound {
  answer: boolean | null;
  elapsedBucket: number;
}

export interface BracketBalanceTrace {
  game: "bracket-balance";
  rulesetVersion: typeof GAME_RULESET_VERSION;
  rounds: readonly BracketBalanceTraceRound[];
}

export function isBalancedBrackets(sequence: string): boolean {
  const stack: string[] = [];
  const openings = new Set(["(", "[", "{"]);
  const pairs: Readonly<Record<string, string>> = {
    ")": "(",
    "]": "[",
    "}": "{"
  };
  for (const character of sequence) {
    if (openings.has(character)) {
      stack.push(character);
      continue;
    }
    const opening = pairs[character];
    if (!opening || stack.pop() !== opening) return false;
  }
  return stack.length === 0;
}

export function generateBracketBalanceQuestion(
  seed: string,
  roundIndex: number
): BracketBalanceQuestion {
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= BRACKET_BALANCE_ROUNDS) {
    throw new RangeError("Bracket Balance round index is invalid");
  }
  const questions = shuffled(
    bracketQuestionBank,
    createRandom(`${seed}:bracket-balance`)
  );
  const sequence = questions[roundIndex];
  if (!sequence) throw new Error("Bracket Balance question bank is incomplete");
  return { sequence, balanced: isBalancedBrackets(sequence) };
}

export function scoreBracketBalance(
  seed: string,
  trace: BracketBalanceTrace
): number {
  if (trace.game !== "bracket-balance" || trace.rulesetVersion !== GAME_RULESET_VERSION) {
    throw new TypeError("Bracket Balance trace uses an unsupported ruleset");
  }
  if (trace.rounds.length > BRACKET_BALANCE_ROUNDS) {
    throw new RangeError("Bracket Balance trace contains too many rounds");
  }

  let score = 0;
  let streak = 0;
  trace.rounds.forEach((round, roundIndex) => {
    if (
      !Number.isInteger(round.elapsedBucket) ||
      round.elapsedBucket < 0 ||
      round.elapsedBucket > BRACKET_BALANCE_TIMEOUT_BUCKET
    ) {
      throw new RangeError("Bracket Balance trace contains an invalid time bucket");
    }
    const question = generateBracketBalanceQuestion(seed, roundIndex);
    if (round.answer === question.balanced) {
      streak += 1;
      score += 50 + Math.min(50, streak * 10);
    } else {
      streak = 0;
    }
  });
  return score;
}

export const BREAKOUT_COLUMNS = 10;
export const BREAKOUT_ROWS = 6;
export const BREAKOUT_LIVES = 3;
export const BREAKOUT_MAX_STEPS = 12_000;
export const BREAKOUT_STEP_MS = 50;
export type BreakoutDirection = -1 | 0 | 1;

const breakoutWidth = 40;
const breakoutHeight = 22;
const breakoutBrickTop = 2;
const breakoutBrickWidth = breakoutWidth / BREAKOUT_COLUMNS;
const breakoutPaddleY = 20;
const breakoutPaddleWidth = 8;

export interface BreakoutInputChange {
  step: number;
  direction: BreakoutDirection;
}

export interface BreakoutTrace {
  game: "slack-off-breakout";
  rulesetVersion: typeof GAME_RULESET_VERSION;
  inputChanges: readonly BreakoutInputChange[];
  steps: number;
}

export interface BreakoutState {
  seed: string;
  step: number;
  paddleX: number;
  ballX: number;
  ballY: number;
  velocityX: number;
  velocityY: number;
  bricks: readonly boolean[];
  lives: number;
  score: number;
  finished: boolean;
  won: boolean;
}

function breakoutVelocity(seed: string, lives: number): number {
  const random = createRandom(`${seed}:breakout:${lives}`);
  return random() < 0.5 ? -0.43 : 0.43;
}

export function createBreakoutState(seed: string): BreakoutState {
  return {
    seed,
    step: 0,
    paddleX: (breakoutWidth - breakoutPaddleWidth) / 2,
    ballX: breakoutWidth / 2,
    ballY: breakoutPaddleY - 2,
    velocityX: breakoutVelocity(seed, BREAKOUT_LIVES),
    velocityY: -0.5,
    bricks: Array.from(
      { length: BREAKOUT_COLUMNS * BREAKOUT_ROWS },
      () => true
    ),
    lives: BREAKOUT_LIVES,
    score: 0,
    finished: false,
    won: false
  };
}

export function stepBreakout(
  state: BreakoutState,
  direction: BreakoutDirection
): BreakoutState {
  if (state.finished) return state;
  if (direction !== -1 && direction !== 0 && direction !== 1) {
    throw new RangeError("Breakout direction is invalid");
  }

  const paddleX = Math.max(
    0,
    Math.min(breakoutWidth - breakoutPaddleWidth, state.paddleX + direction * 0.9)
  );
  let ballX = state.ballX + state.velocityX;
  let ballY = state.ballY + state.velocityY;
  let velocityX = state.velocityX;
  let velocityY = state.velocityY;
  let bricks = state.bricks;
  let lives = state.lives;
  let score = state.score;
  let finished = false;
  let won = false;

  if (ballX <= 0 || ballX >= breakoutWidth - 0.01) {
    ballX = Math.max(0, Math.min(breakoutWidth - 0.01, ballX));
    velocityX *= -1;
  }
  if (ballY <= 0) {
    ballY = 0;
    velocityY = Math.abs(velocityY);
  }

  const brickRow = Math.floor(ballY - breakoutBrickTop);
  const brickColumn = Math.floor(ballX / breakoutBrickWidth);
  if (
    brickRow >= 0 &&
    brickRow < BREAKOUT_ROWS &&
    brickColumn >= 0 &&
    brickColumn < BREAKOUT_COLUMNS
  ) {
    const brickIndex = brickRow * BREAKOUT_COLUMNS + brickColumn;
    if (bricks[brickIndex]) {
      const nextBricks = [...bricks];
      nextBricks[brickIndex] = false;
      bricks = nextBricks;
      score += 10;
      velocityY = state.velocityY > 0 ? -Math.abs(velocityY) : Math.abs(velocityY);
      if (bricks.every((brick) => !brick)) {
        score += lives * 100;
        finished = true;
        won = true;
      }
    }
  }

  const crossesPaddle =
    velocityY > 0 && state.ballY < breakoutPaddleY && ballY >= breakoutPaddleY;
  if (
    crossesPaddle &&
    ballX >= paddleX - 0.5 &&
    ballX <= paddleX + breakoutPaddleWidth + 0.5
  ) {
    ballY = breakoutPaddleY - 0.01;
    velocityY = -Math.abs(velocityY);
    const hit =
      (ballX - (paddleX + breakoutPaddleWidth / 2)) /
      (breakoutPaddleWidth / 2);
    velocityX = Math.max(-0.78, Math.min(0.78, velocityX + hit * 0.18));
    if (Math.abs(velocityX) < 0.24) velocityX = velocityX < 0 ? -0.24 : 0.24;
  } else if (ballY > breakoutHeight) {
    lives -= 1;
    if (lives === 0) {
      finished = true;
    } else {
      ballX = breakoutWidth / 2;
      ballY = breakoutPaddleY - 2;
      velocityX = breakoutVelocity(state.seed, lives);
      velocityY = -0.5;
    }
  }

  return {
    seed: state.seed,
    step: state.step + 1,
    paddleX,
    ballX,
    ballY,
    velocityX,
    velocityY,
    bricks,
    lives,
    score: Math.min(900, score),
    finished,
    won
  };
}

function validateBreakoutTrace(trace: BreakoutTrace): void {
  if (trace.game !== "slack-off-breakout" || trace.rulesetVersion !== GAME_RULESET_VERSION) {
    throw new TypeError("Breakout trace uses an unsupported ruleset");
  }
  if (!Number.isInteger(trace.steps) || trace.steps < 0 || trace.steps > BREAKOUT_MAX_STEPS) {
    throw new RangeError("Breakout trace step count is invalid");
  }
  let previousStep = -1;
  for (const change of trace.inputChanges) {
    if (
      !Number.isInteger(change.step) ||
      change.step < 0 ||
      change.step >= trace.steps ||
      change.step <= previousStep ||
      (change.direction !== -1 && change.direction !== 0 && change.direction !== 1)
    ) {
      throw new RangeError("Breakout trace contains an invalid input change");
    }
    previousStep = change.step;
  }
}

export function replayBreakout(seed: string, trace: BreakoutTrace): BreakoutState {
  validateBreakoutTrace(trace);
  let state = createBreakoutState(seed);
  let direction: BreakoutDirection = 0;
  let changeIndex = 0;
  while (state.step < trace.steps && !state.finished) {
    const change = trace.inputChanges[changeIndex];
    if (change && change.step === state.step) {
      direction = change.direction;
      changeIndex += 1;
    }
    state = stepBreakout(state, direction);
  }
  return state;
}

export type GameResultTrace =
  | CompletionHellTrace
  | BracketBalanceTrace
  | BreakoutTrace;

export const completionHellTraceSchema = z
  .object({
    game: z.literal("completion-hell"),
    rulesetVersion: z.literal(GAME_RULESET_VERSION),
    rounds: z
      .array(
        z
          .object({
            choice: z.number().int().min(-1).max(3),
            elapsedBucket: z
              .number()
              .int()
              .min(0)
              .max(COMPLETION_HELL_TIMEOUT_BUCKET)
          })
          .strict()
      )
      .max(COMPLETION_HELL_ROUNDS)
  })
  .strict();

export const bracketBalanceTraceSchema = z
  .object({
    game: z.literal("bracket-balance"),
    rulesetVersion: z.literal(GAME_RULESET_VERSION),
    rounds: z
      .array(
        z
          .object({
            answer: z.boolean().nullable(),
            elapsedBucket: z
              .number()
              .int()
              .min(0)
              .max(BRACKET_BALANCE_TIMEOUT_BUCKET)
          })
          .strict()
      )
      .max(BRACKET_BALANCE_ROUNDS)
  })
  .strict();

export const breakoutTraceSchema = z
  .object({
    game: z.literal("slack-off-breakout"),
    rulesetVersion: z.literal(GAME_RULESET_VERSION),
    inputChanges: z.array(
      z
        .object({
          step: z.number().int().min(0).max(BREAKOUT_MAX_STEPS - 1),
          direction: z.union([z.literal(-1), z.literal(0), z.literal(1)])
        })
        .strict()
    ),
    steps: z.number().int().min(0).max(BREAKOUT_MAX_STEPS)
  })
  .strict();

export const gameResultTraceSchema = z
  .discriminatedUnion("game", [
    completionHellTraceSchema,
    bracketBalanceTraceSchema,
    breakoutTraceSchema
  ])
  .superRefine((trace, context) => {
    if (trace.game !== "slack-off-breakout") return;
    try {
      validateBreakoutTrace(trace);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Breakout trace is invalid"
      });
    }
  });

export function scoreGameTrace(
  game: GameCode,
  seed: string,
  trace: GameResultTrace
): number {
  if (game !== trace.game) throw new TypeError("Game and result trace do not match");
  switch (trace.game) {
    case "completion-hell": {
      if (trace.rounds.length !== COMPLETION_HELL_ROUNDS) {
        throw new RangeError("Ranked Completion Hell traces must contain ten rounds");
      }
      return scoreCompletionHell(seed, trace);
    }
    case "bracket-balance": {
      if (trace.rounds.length !== BRACKET_BALANCE_ROUNDS) {
        throw new RangeError("Ranked Bracket Balance traces must contain twenty rounds");
      }
      return scoreBracketBalance(seed, trace);
    }
    case "slack-off-breakout": {
      const state = replayBreakout(seed, trace);
      if (!state.finished || state.step !== trace.steps) {
        throw new RangeError("Ranked Breakout traces must end exactly when the game finishes");
      }
      return state.score;
    }
  }
}

export const gameRunSignaturePayloadSchema = z
  .object({
    device_id: z.string().min(1).max(128),
    game: gameCodeSchema,
    request_nonce: z.string().min(1).max(128),
    requested_at: z.iso.datetime()
  })
  .strict();

export const gameScoreSignaturePayloadSchema = z
  .object({
    run_id: z.string().min(1).max(128),
    game: gameCodeSchema,
    score: z.number().int().min(0).max(1_900),
    run_seconds: z.number().finite().positive().max(3_600),
    challenge_nonce: z.string().min(1).max(256),
    ruleset_version: z.literal(GAME_RULESET_VERSION),
    result_trace: gameResultTraceSchema
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.result_trace.game !== payload.game) {
      context.addIssue({ code: "custom", message: "Game and result trace do not match" });
    }
    const maximum = gameDescriptors.find((game) => game.code === payload.game)?.maxScore;
    if (maximum === undefined || payload.score > maximum) {
      context.addIssue({ code: "custom", message: "Score exceeds the game maximum" });
    }
  });

export type GameRunSignaturePayload = z.infer<
  typeof gameRunSignaturePayloadSchema
>;
export type GameScoreSignaturePayload = z.infer<
  typeof gameScoreSignaturePayloadSchema
>;

export interface GameScoreSignaturePayloadInput {
  run_id: string;
  game: GameCode;
  score: number;
  run_seconds: number;
  challenge_nonce: string;
  ruleset_version: typeof GAME_RULESET_VERSION;
  result_trace: GameResultTrace;
}

export function createGameRunSignaturePayload(
  payload: GameRunSignaturePayload
): GameRunSignaturePayload {
  return gameRunSignaturePayloadSchema.parse(payload);
}

export function createGameScoreSignaturePayload(
  payload: GameScoreSignaturePayloadInput
): GameScoreSignaturePayload {
  return gameScoreSignaturePayloadSchema.parse(payload);
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Canonical JSON rejects cyclic values");
    ancestors.add(value);
    const result = `[${value.map((item) => canonicalValue(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    if (ancestors.has(object)) throw new TypeError("Canonical JSON rejects cyclic values");
    ancestors.add(object);
    const result = `{${Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined) {
          throw new TypeError("Canonical JSON rejects undefined values");
        }
        return `${JSON.stringify(key)}:${canonicalValue(object[key], ancestors)}`;
      })
      .join(",")}}`;
    ancestors.delete(object);
    return result;
  }
  throw new TypeError("Canonical JSON received an unsupported value");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}
