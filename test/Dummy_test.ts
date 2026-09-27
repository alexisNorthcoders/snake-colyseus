import assert from "assert";

import {
  Cell,
  FoodPlacement,
  GameShape,
  PlayerShape,
  RULES_VERSION,
  beginPlay,
  dealRound,
  layFood,
  mulberry32,
  newPlainCell,
  tick,
  turn
} from "../src/engine";
import { BotView, Decider, Snapshots, brainDecider, brainProblems, dummyBrain, rookie, viewFor } from "../src/bots";

const view = (overrides: Partial<BotView["self"]> = {}, rest: Partial<BotView> = {}): BotView => ({
  grid: { width: 20, height: 20 },
  mode: "timed",
  ticksLeft: 100,
  tickLimit: 100,
  self: { head: { x: 5, y: 5 }, body: [], movedDirection: { x: 1, y: 0 }, score: 0, hunger: 0, ...overrides },
  others: [],
  food: [],
  ...rest
});

const pellet = (x: number, y: number) => ({ x, y, type: "apple", score: 10 });

describe("Dummy, the hand-made brain", () => {
  const dummy = brainDecider(dummyBrain);

  it("is a valid brain, made under the engine's rules", () => {
    assert.deepStrictEqual(brainProblems(dummyBrain), []);
    assert.strictEqual(dummyBrain.rulesVersion, RULES_VERSION);
  });

  it("goes straight with nothing in its way and nothing to eat", () => {
    assert.strictEqual(dummy(view()), "r");
    assert.strictEqual(dummy(view({ movedDirection: { x: 0, y: 1 } })), "d");
  });

  it("turns away from a body straight ahead, towards the free side", () => {
    // Heading right: left is up, right is down.
    assert.notStrictEqual(dummy(view({ body: [{ x: 6, y: 5 }] })), "r");
    assert.strictEqual(dummy(view({ body: [{ x: 6, y: 5 }, { x: 5, y: 4 }] })), "d");
    assert.strictEqual(dummy(view({ body: [{ x: 6, y: 5 }, { x: 5, y: 6 }] })), "u");
    // An enemy's body counts too.
    assert.strictEqual(
      dummy(view({}, { others: [{ head: { x: 9, y: 9 }, body: [{ x: 6, y: 5 }, { x: 5, y: 6 }], isDead: false }] })),
      "u"
    );
  });

  it("turns away from a body even with a pellet beyond it", () => {
    assert.notStrictEqual(dummy(view({ body: [{ x: 6, y: 5 }] }, { food: [pellet(8, 5)] })), "r");
  });

  it("heads towards a pellet", () => {
    assert.strictEqual(dummy(view({}, { food: [pellet(9, 5)] })), "r");
    assert.strictEqual(dummy(view({}, { food: [pellet(5, 2)] })), "u");
    assert.strictEqual(dummy(view({}, { food: [pellet(5, 9)] })), "d");
    // Behind it: it turns round.
    assert.notStrictEqual(dummy(view({}, { food: [pellet(2, 5)] })), "r");
  });

  it("keeps straight towards a pellet ahead and off to one side, turning once it's level", () => {
    assert.strictEqual(dummy(view({}, { food: [pellet(9, 7)] })), "r");
    assert.strictEqual(dummy(view({ head: { x: 9, y: 5 } }, { food: [pellet(9, 7)] })), "d");
  });

  it("is deterministic", () => {
    const v = view({ body: [{ x: 4, y: 5 }] }, { food: [pellet(12, 1), pellet(3, 14)] });
    const first = dummy(v);
    for (let i = 0; i < 10; i++) assert.strictEqual(dummy(v), first);
  });
});

describe("Dummy against the rookie, headless", () => {
  type PlainGame = GameShape<Cell> & { players: PlayerShape<Cell>[]; foodCoordinates: FoodPlacement[] };

  const newSnake = () => ({
    x: 0, y: 0,
    direction: { x: 0, y: 0 },
    movedDirection: { x: 0, y: 0 },
    tail: [] as Cell[],
    tailCursor: 0,
    size: 0,
    score: 0,
    hunger: 0,
    isDead: true
  });

  /** Plays one round from `seed` between the deciders, engine and bots only, until it ends. */
  const playRound = (seed: number, mode: GameShape<Cell>["mode"], deciders: Record<string, Decider>) => {
    const rng = mulberry32(seed);
    const game: PlainGame = {
      players: Object.keys(deciders).map((id) => ({ id, snake: newSnake() })),
      foodCoordinates: [],
      aliveCount: 0,
      mode
    };
    const snapshots = new Snapshots(2);
    layFood(game, rng, (placement) => ({ ...placement }));
    dealRound(game, 0, newPlainCell);
    beginPlay(game, 300);

    let ate = 0;
    for (let t = 0; t < 20000; t++) {
      snapshots.record(game);
      game.players.forEach((player) => {
        if (!player.snake.isDead) turn(player.snake, deciders[player.id](viewFor(game, player, snapshots)));
      });
      const report = tick(game, rng, newPlainCell);
      ate += report.events.filter((e) => e.kind === "ate" && e.player === "dummy").length;
      if (report.roundOver) return { ...report, ticks: t + 1, ate };
    }
    throw new Error("the round never ended");
  };

  it("plays a timed round to the end", () => {
    const result = playRound(7, "timed", { dummy: brainDecider(dummyBrain), rookie });
    assert.ok(result.roundOver);
    assert.ok(result.reason === "time-up" || result.reason === "last-standing");
    assert.ok(result.ticks <= 300);
  });

  it("plays an endless round to the end, eating along the way", () => {
    const result = playRound(7, "endless", { dummy: brainDecider(dummyBrain), rookie });
    assert.strictEqual(result.reason, "last-standing");
    assert.ok(result.ate > 0, "Dummy never ate");
  });
});
