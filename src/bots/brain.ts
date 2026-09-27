import { Direction, directionMap } from "../engine";
import { ENCODER_SIZE, ENCODER_VERSION, encode } from "./encoder";
import { BotView, Decider } from "./view";

/** What marks a JSON file as a brain. */
export const BRAIN_FORMAT = "snake-brain";

/** Bump this whenever the brain file's layout changes. */
export const BRAIN_FORMAT_VERSION = 1;

export type Activation = "tanh" | "relu" | "sigmoid";

/**
 * A trained snake: a small neural network, saved as JSON. The same format
 * whatever trained it, so any trainer's brain plays through `brainDecider`.
 */
export interface Brain {
  format: typeof BRAIN_FORMAT;
  formatVersion: number;
  /** Which encoder turns a view into its inputs. */
  encoderVersion: number;
  /** The engine's `RULES_VERSION` it was trained under. A mismatch is worth a warning, not a refusal. */
  rulesVersion: number;
  /** The layer sizes, from the input (the encoder's size) to the output (left, straight and right). */
  sizes: number[];
  /** For the hidden layers; the output layer is linear. */
  activation: Activation;
  /** One a layer, after the input: `weights` is output × input. */
  layers: { weights: number[][]; biases: number[] }[];
}

/** How many outputs a brain gives: left, straight and right. */
const OUTPUTS = 3;

/** The encoders a brain can read its view through, by version. */
const encoders: Record<number, { size: number; encode: (view: BotView) => number[] }> = {
  [ENCODER_VERSION]: { size: ENCODER_SIZE, encode }
};

const activations: Record<Activation, (x: number) => number> = {
  tanh: Math.tanh,
  relu: (x) => Math.max(0, x),
  sigmoid: (x) => 1 / (1 + Math.exp(-x))
};

const fields = ["format", "formatVersion", "encoderVersion", "rulesVersion", "sizes", "activation", "layers"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What's wrong with `value` as a brain, or nothing if it's a valid one. Never
 * throws, whatever it's given. A rules version other than the engine's isn't
 * counted against it: the caller decides whether to warn.
 */
export function brainProblems(value: unknown): string[] {
  if (!isObject(value)) return ["a brain must be an object"];
  const problems: string[] = [];
  const brain = value as Partial<Record<(typeof fields)[number], unknown>>;
  fields.forEach((field) => {
    if (brain[field] === undefined) problems.push(`missing field "${field}"`);
  });

  if (brain.format !== undefined && brain.format !== BRAIN_FORMAT) problems.push(`format isn't "${BRAIN_FORMAT}"`);
  if (brain.formatVersion !== undefined && brain.formatVersion !== BRAIN_FORMAT_VERSION) {
    problems.push(`format version ${JSON.stringify(brain.formatVersion)} isn't known`);
  }
  const encoder = typeof brain.encoderVersion === "number" ? encoders[brain.encoderVersion] : undefined;
  if (brain.encoderVersion !== undefined && !encoder) {
    problems.push(`encoder version ${JSON.stringify(brain.encoderVersion)} isn't known`);
  }
  if (brain.rulesVersion !== undefined && !Number.isInteger(brain.rulesVersion)) problems.push("rulesVersion isn't a whole number");
  if (brain.activation !== undefined && !Object.hasOwn(activations, brain.activation as string)) {
    problems.push(`activation ${JSON.stringify(brain.activation)} isn't tanh, relu or sigmoid`);
  }

  const { sizes, layers } = brain;
  if (sizes === undefined) return problems;
  if (!Array.isArray(sizes) || sizes.length < 2 || !sizes.every((size) => Number.isInteger(size) && size > 0)) {
    problems.push("sizes must be at least two whole numbers above 0");
    return problems;
  }
  if (encoder && sizes[0] !== encoder.size) {
    problems.push(`input size ${sizes[0]} isn't encoder v${brain.encoderVersion}'s ${encoder.size}`);
  }
  if (sizes[sizes.length - 1] !== OUTPUTS) problems.push(`output size ${sizes[sizes.length - 1]} isn't ${OUTPUTS}`);

  if (layers === undefined) return problems;
  if (!Array.isArray(layers) || layers.length !== sizes.length - 1) {
    problems.push(`layers must be a list of ${sizes.length - 1}, one for each size after the input`);
    return problems;
  }
  // Each number in `list`, which should be `length` long, must be finite.
  const checkNumbers = (list: unknown, length: number, what: string) => {
    if (!Array.isArray(list) || list.length !== length) return problems.push(`${what} must be a list of ${length}`);
    list.forEach((n, i) => {
      if (typeof n !== "number" || !Number.isFinite(n)) problems.push(`${what}[${i}] isn't a finite number`);
    });
  };
  layers.forEach((layer, l) => {
    const [inputs, outputs] = [sizes[l], sizes[l + 1]];
    if (!isObject(layer)) return problems.push(`layer ${l} must be an object`);
    if (!Array.isArray(layer.weights) || layer.weights.length !== outputs) {
      problems.push(`layer ${l} weights must be ${outputs} rows of ${inputs}`);
    } else {
      layer.weights.forEach((row, r) => checkNumbers(row, inputs, `layer ${l} weights[${r}]`));
    }
    checkNumbers(layer.biases, outputs, `layer ${l} biases`);
  });
  return problems;
}

/** The brain's outputs for `input`: each hidden layer through its activation, the last left linear. */
export function forward(brain: Brain, input: number[]): number[] {
  const activate = activations[brain.activation];
  return brain.layers.reduce((values, { weights, biases }, l) => {
    const hidden = l < brain.layers.length - 1;
    return weights.map((row, o) => {
      let sum = biases[o];
      for (let i = 0; i < row.length; i++) sum += row[i] * values[i];
      return hidden ? activate(sum) : sum;
    });
  }, input);
}

const directions = Object.keys(directionMap) as Direction[];
const directionOf = (x: number, y: number) => directions.find((d) => directionMap[d].x === x && directionMap[d].y === y)!;

/**
 * `brain` as a `Decider`: it reads the view through the brain's encoder and
 * takes the highest of its three outputs, left, straight or right of the way
 * it last moved (right, if it hasn't moved, as the encoder has it). A tie goes
 * to straight, then left. Pure and deterministic. `brain` must be valid.
 */
export function brainDecider(brain: Brain): Decider {
  const { encode } = encoders[brain.encoderVersion];
  return (view) => {
    const [left, straight, right] = forward(brain, encode(view));
    const moved = view.self.movedDirection;
    const [fx, fy] = moved.x === 0 && moved.y === 0 ? [1, 0] : [moved.x, moved.y];
    // Right of the way it's heading; left is its negative.
    const [rx, ry] = [-fy, fx];
    if (straight >= left && straight >= right) return directionOf(fx, fy);
    return left >= right ? directionOf(-rx, -ry) : directionOf(rx, ry);
  };
}
