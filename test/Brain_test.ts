import assert from "assert";

import { RULES_VERSION } from "../src/engine";
import {
  BRAIN_FORMAT,
  BRAIN_FORMAT_VERSION,
  Brain,
  BotView,
  ENCODER_SIZE,
  ENCODER_VERSION,
  INPUT_LABELS,
  OUTPUT_LABELS,
  brainDecider,
  dummyBrain,
  encode,
  layerValues,
  brainProblems,
  forward
} from "../src/bots";

/** A brain of `sizes` with every weight 0 and the biases given, so its outputs are exactly the last biases. */
const flatBrain = (sizes: number[], lastBiases: number[], activation: Brain["activation"] = "tanh"): Brain => ({
  format: BRAIN_FORMAT,
  formatVersion: BRAIN_FORMAT_VERSION,
  encoderVersion: ENCODER_VERSION,
  rulesVersion: RULES_VERSION,
  sizes,
  activation,
  layers: sizes.slice(1).map((size, i) => ({
    weights: Array.from({ length: size }, () => new Array<number>(sizes[i]).fill(0)),
    biases: i === sizes.length - 2 ? [...lastBiases] : new Array<number>(size).fill(0)
  }))
});

/** 2 inputs, 2 hidden, 1 output, with weights small enough to work through by hand. */
const tiny = (activation: Brain["activation"]): Brain => ({
  ...flatBrain([2, 2, 1], [0], activation),
  layers: [
    { weights: [[1, -2], [0.5, 1]], biases: [0, -1] },
    { weights: [[2, -1]], biases: [0.5] }
  ]
});

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} isn't ${expected}`);

const view = (movedDirection: { x: number; y: number }): BotView => ({
  grid: { width: 20, height: 20 },
  mode: "timed",
  ticksLeft: 100,
  tickLimit: 100,
  self: { head: { x: 5, y: 5 }, body: [], movedDirection, score: 0, hunger: 0 },
  others: [],
  food: []
});

describe("brain forward pass", () => {
  // From the input [1, 2] the hidden layer's sums are 1 - 4 + 0 = -3 and 0.5 + 2 - 1 = 1.5,
  // and the output is 2 × the first hidden value - the second + 0.5.
  it("runs a tanh hidden layer", () => {
    // 2 × tanh(-3) - tanh(1.5) + 0.5
    close(forward(tiny("tanh"), [1, 2])[0], 2 * -0.9950547536867305 - 0.9051482536448664 + 0.5);
  });

  it("runs a relu hidden layer", () => {
    // 2 × 0 - 1.5 + 0.5
    assert.deepStrictEqual(forward(tiny("relu"), [1, 2]), [-1]);
  });

  it("runs a sigmoid hidden layer", () => {
    // 2 × 1 / (1 + e³) - 1 / (1 + e^-1.5) + 0.5
    close(forward(tiny("sigmoid"), [1, 2])[0], 2 * 0.04742587317756678 - 0.8175744761936437 + 0.5);
  });

  it("leaves the output layer linear", () => {
    // With no hidden layer, relu would clip these to 0 if it touched the output.
    const brain = { ...flatBrain([2, 2], [0, 0], "relu"), layers: [{ weights: [[1, 0], [0, -1]], biases: [-3, 0] }] };
    assert.deepStrictEqual(forward(brain, [1, 2]), [-2, -2]);
  });
});

describe("brain layer values", () => {
  it("holds the input, the hidden layer after its activation, and the linear outputs", () => {
    // Sums of -3 and 1.5, as above.
    const [input, hidden, out] = layerValues(tiny("tanh"), [1, 2]);
    assert.deepStrictEqual(input, [1, 2]);
    close(hidden[0], -0.9950547536867305);
    close(hidden[1], 0.9051482536448664);
    close(out[0], 2 * -0.9950547536867305 - 0.9051482536448664 + 0.5);
    const relu = layerValues(tiny("relu"), [1, 2]);
    assert.deepStrictEqual(relu, [[1, 2], [0, 1.5], [-1]]);
    const sigmoid = layerValues(tiny("sigmoid"), [1, 2]);
    close(sigmoid[1][0], 0.04742587317756678);
    close(sigmoid[1][1], 0.8175744761936437);
  });

  it("ends in what forward gives, for Dummy on a few views", () => {
    [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }].forEach((moved) => {
      const input = encode(view(moved));
      const all = layerValues(dummyBrain, input);
      assert.strictEqual(all.length, dummyBrain.sizes.length);
      assert.deepStrictEqual(all[all.length - 1], forward(dummyBrain, input));
    });
  });
});

describe("labels", () => {
  it("names each of the encoder's inputs, differently, and the three outputs", () => {
    assert.strictEqual(INPUT_LABELS.length, ENCODER_SIZE);
    assert.strictEqual(new Set(INPUT_LABELS).size, ENCODER_SIZE);
    assert.deepStrictEqual([...OUTPUT_LABELS], ["left", "straight", "right"]);
  });
});

describe("brain validation", () => {
  const valid = () => flatBrain([ENCODER_SIZE, 4, 3], [0, 0, 0]);
  const reports = (brain: unknown, pattern: RegExp) => {
    const problems = brainProblems(brain);
    assert.ok(problems.some((p) => pattern.test(p)), `${JSON.stringify(problems)} doesn't mention ${pattern}`);
  };

  it("finds nothing wrong with a valid brain", () => {
    assert.deepStrictEqual(brainProblems(valid()), []);
    assert.deepStrictEqual(brainProblems(JSON.parse(JSON.stringify(valid()))), []);
  });

  it("doesn't count a different rules version against it", () => {
    assert.deepStrictEqual(brainProblems({ ...valid(), rulesVersion: RULES_VERSION + 1 }), []);
  });

  it("reports anything that isn't an object", () => {
    reports(null, /object/);
    reports([1, 2], /object/);
  });

  it("reports the wrong format or format version", () => {
    reports({ ...valid(), format: "something-else" }, /format/);
    reports({ ...valid(), formatVersion: BRAIN_FORMAT_VERSION + 1 }, /format version/);
  });

  it("reports an unknown encoder version", () => {
    reports({ ...valid(), encoderVersion: 99 }, /encoder version/);
  });

  it("reports each missing field", () => {
    (["format", "formatVersion", "encoderVersion", "rulesVersion", "sizes", "activation", "layers"] as const).forEach((field) => {
      const brain: Partial<Brain> = valid();
      delete brain[field];
      reports(brain, new RegExp(field));
    });
  });

  it("reports an unknown activation", () => {
    reports({ ...valid(), activation: "softplus" }, /activation/);
  });

  it("reports a weight or bias shape that doesn't match the sizes", () => {
    const shortRow = valid();
    shortRow.layers[0].weights[2].pop();
    reports(shortRow, /layer 0.*weights/);
    const extraRow = valid();
    extraRow.layers[1].weights.push([0, 0, 0, 0]);
    reports(extraRow, /layer 1.*weights/);
    const biases = valid();
    biases.layers[1].biases.push(0);
    reports(biases, /layer 1.*biases/);
    const layers = valid();
    layers.layers.pop();
    reports(layers, /layers/);
  });

  it("reports the wrong input size", () => {
    reports(flatBrain([ENCODER_SIZE + 1, 4, 3], [0, 0, 0]), /input/);
  });

  it("reports the wrong output size", () => {
    reports(flatBrain([ENCODER_SIZE, 4, 2], [0, 0]), /output/);
  });

  it("reports a non-finite weight or bias", () => {
    [NaN, Infinity, -Infinity].forEach((bad) => {
      const weight = valid();
      weight.layers[0].weights[1][7] = bad;
      reports(weight, /finite/);
      const bias = valid();
      bias.layers[1].biases[2] = bad;
      reports(bias, /finite/);
    });
    const text = valid() as any;
    text.layers[0].weights[0][0] = "1";
    reports(text, /finite/);
  });
});

describe("brain decider", () => {
  // Each heading, and which way is left, straight and right of it.
  const headings = [
    { moved: { x: 1, y: 0 }, turns: ["u", "r", "d"] },
    { moved: { x: -1, y: 0 }, turns: ["d", "l", "u"] },
    { moved: { x: 0, y: -1 }, turns: ["l", "u", "r"] },
    { moved: { x: 0, y: 1 }, turns: ["r", "d", "l"] },
    // It hasn't moved yet, so straight is right, as the encoder has it.
    { moved: { x: 0, y: 0 }, turns: ["u", "r", "d"] }
  ];
  const decide = (outputs: number[], moved: { x: number; y: number }) =>
    brainDecider(flatBrain([ENCODER_SIZE, 3], outputs))(view(moved));

  it("turns whichever of left, straight and right wins into a direction, for every heading", () => {
    headings.forEach(({ moved, turns }) => {
      assert.strictEqual(decide([1, 0, 0], moved), turns[0]);
      assert.strictEqual(decide([0, 1, 0], moved), turns[1]);
      assert.strictEqual(decide([0, 0, 1], moved), turns[2]);
    });
  });

  it("gives a tie to straight, then left", () => {
    headings.forEach(({ moved, turns }) => {
      assert.strictEqual(decide([1, 1, 1], moved), turns[1]);
      assert.strictEqual(decide([1, 1, 0], moved), turns[1]);
      assert.strictEqual(decide([0, 1, 1], moved), turns[1]);
      assert.strictEqual(decide([1, 0, 1], moved), turns[0]);
    });
  });

  it("reads the view through the brain's encoder", () => {
    // One weight, on "blocked 1 step straight ahead", pushing straight down.
    const brain = flatBrain([ENCODER_SIZE, 3], [0, 0.5, 0]);
    brain.layers[0].weights[1][3] = -1;
    const blocked = view({ x: 1, y: 0 });
    blocked.self.body = [{ x: 6, y: 5 }];
    assert.strictEqual(brainDecider(brain)(view({ x: 1, y: 0 })), "r");
    assert.strictEqual(brainDecider(brain)(blocked), "u");
  });
});
