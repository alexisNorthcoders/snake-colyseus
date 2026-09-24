import assert from "assert";

import {
  Cell,
  FoodShape,
  GameMode,
  GameShape,
  PlayerShape,
  beginPlay,
  foodScore,
  mulberry32,
  newPlainCell,
  rulesConfig,
  setTail,
  tick
} from "../src/engine";

type PlainPlayer = PlayerShape<Cell>;
type PlainGame = GameShape<Cell> & { players: PlainPlayer[]; foodCoordinates: FoodShape[] };

const { hungerTicks: H, starveDrain: D, starveDrainTicks: T } = rulesConfig;

const down = { x: 0, y: 1 };

/** A live one-cell snake at `head` heading down, with `score` points and an empty stomach clock. */
const plainPlayer = (id: string, head: Cell, score = 0): PlainPlayer => {
  const snake = {
    ...head,
    direction: { ...down },
    movedDirection: { ...down },
    tail: [] as Cell[],
    tailCursor: 0,
    size: 1,
    score,
    hunger: 0,
    isDead: false
  };
  setTail(snake, [], newPlainCell);
  return { id, snake };
};

/**
 * Two snakes far apart heading down columns 2 and 12, who never meet, in a
 * game of `mode` that has just begun play. Its one pellet sits in column 19,
 * out of everyone's way, unless a test moves it.
 */
const begun = (mode: GameMode, [a, b]: [number, number]): PlainGame => {
  const game: PlainGame = {
    players: [plainPlayer("a", { x: 2, y: 2 }, a), plainPlayer("b", { x: 12, y: 2 }, b)],
    foodCoordinates: [{ x: 19, y: 0, index: 0, type: "redApple" }],
    aliveCount: 0,
    mode
  };
  beginPlay(game, 10_000);
  return game;
};

const run = (game: PlainGame) => tick(game, mulberry32(1), newPlainCell);

/** Runs `n` ticks, returning the reports. */
const runFor = (game: PlainGame, n: number) => Array.from({ length: n }, () => run(game));

/** Puts the pellet where snake `player`, heading down, will be `ticks` ticks from now. */
const pelletAhead = (game: PlainGame, player: PlainPlayer, ticks: number) => {
  const { x, y } = player.snake;
  Object.assign(game.foodCoordinates[0], { x, y: (y + ticks) % rulesConfig.scaleFactor, type: "redApple" });
};

describe("starvation in an endless round", () => {
  it("counts the ticks since a snake last ate, from zero when play begins", () => {
    const game = begun("endless", [100, 100]);
    assert.deepStrictEqual(game.players.map((p) => p.snake.hunger), [0, 0]);

    runFor(game, 3);
    assert.deepStrictEqual(game.players.map((p) => p.snake.hunger), [3, 3]);
  });

  it("drains no score before H ticks without food", () => {
    const game = begun("endless", [100, 100]);

    runFor(game, H - 1);
    assert.deepStrictEqual(game.players.map((p) => p.snake.score), [100, 100]);
  });

  it("drains D on the H-th tick without food, then D every T ticks after", () => {
    const game = begun("endless", [100, 100]);
    const [a] = game.players;
    runFor(game, H - 1);

    const scores: number[] = [];
    for (let t = 0; t < 2 * T + 1; t++) {
      run(game);
      scores.push(a.snake.score);
    }

    const expected = Array.from({ length: 2 * T + 1 }, (_, t) => 100 - D * (Math.floor(t / T) + 1));
    assert.deepStrictEqual(scores, expected);
  });

  it("resets the clock when the snake eats, stopping the drain", () => {
    const game = begun("endless", [100, 100]);
    const [a] = game.players;
    runFor(game, H + T);
    assert.strictEqual(a.snake.score, 100 - 2 * D);

    pelletAhead(game, a, 1);
    run(game);
    const fed = 100 - 2 * D + foodScore.redApple;
    assert.strictEqual(a.snake.hunger, 0);
    assert.strictEqual(a.snake.score, fed);

    // The pellet may respawn in the way and be eaten again, but never drained.
    for (let t = 0; t < H - 1; t++) {
      run(game);
      assert.ok(a.snake.score >= fed, `drained ${t + 1} ticks after eating`);
    }
  });

  it("starves a snake that never eats on the tick the formula predicts, with no one to blame", () => {
    // Drained at H, H+T and H+2T: 12, 7, 2, then -3 is below zero.
    const score = 2 * D + 2;
    const diesAt = H + Math.floor(score / D) * T;
    const game = begun("endless", [score, 10_000]);
    const [a] = game.players;

    const reports = runFor(game, diesAt - 1);
    assert.ok(!a.snake.isDead, "starved early");
    assert.ok(reports.every((r) => r.events.length === 0), "something happened before the starving tick");
    const { size, tail } = a.snake;
    const body = tail.map(({ x, y }) => ({ x, y }));

    const report = run(game);
    assert.deepStrictEqual(report.events, [{ kind: "died", player: "a", cause: "starved" }]);
    assert.ok(a.snake.isDead);
    assert.strictEqual(a.snake.score, score - (Math.floor(score / D) + 1) * D);
    assert.strictEqual(a.snake.size, size, "starving shrank the snake");
    assert.deepStrictEqual(a.snake.tail.map(({ x, y }) => ({ x, y })), body, "starving took body segments");
  });

  it("saves a snake that eats on the tick it would have starved", () => {
    const game = begun("endless", [0, 10_000]);
    const [a] = game.players;
    runFor(game, H - 1);

    pelletAhead(game, a, 1);
    const report = run(game);
    assert.ok(!a.snake.isDead, "starved despite eating");
    assert.strictEqual(a.snake.score, foodScore.redApple);
    assert.deepStrictEqual(report.events.map((e) => e.kind), ["ate"]);
  });

  it("ends the round when starving leaves one snake alive, the survivor winning", () => {
    const game = begun("endless", [0, 10]);

    const reports = runFor(game, H);
    assert.ok(reports.slice(0, -1).every((r) => !r.roundOver));
    assert.deepStrictEqual(reports[H - 1], {
      events: [{ kind: "died", player: "a", cause: "starved" }],
      roundOver: true,
      winnerId: "b"
    });
    assert.strictEqual(game.aliveCount, 1);
  });

  it("has no winner when every snake starves on the same tick", () => {
    const game = begun("endless", [0, 0]);

    const report = runFor(game, H)[H - 1];
    assert.deepStrictEqual(report, {
      events: [
        { kind: "died", player: "a", cause: "starved" },
        { kind: "died", player: "b", cause: "starved" }
      ],
      roundOver: true
    });
  });

  it("never drains or starves anyone in a timed round", () => {
    const game = begun("timed", [0, 0]);

    const reports = runFor(game, H + 5 * T);
    assert.ok(reports.every((r) => r.events.length === 0 && !r.roundOver));
    assert.deepStrictEqual(game.players.map((p) => [p.snake.score, p.snake.hunger, p.snake.isDead]), [
      [0, 0, false],
      [0, 0, false]
    ]);
  });
});
