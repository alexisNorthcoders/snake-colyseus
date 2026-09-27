import assert from "assert";

import { Cell, FoodPlacement, GameShape, PlayerShape, beginPlay, dealRound, layFood, mulberry32, newPlainCell, tick, turn } from "../src/engine";
import { BotView, Decider, Snapshots, rookie, viewFor } from "../src/bots";

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

/** A dealt game with no food in the way, and `ids` alive and heading right. */
const newGame = (ids: string[]): PlainGame => {
  const game: PlainGame = { players: ids.map((id) => ({ id, snake: newSnake() })), foodCoordinates: [], aliveCount: 0 };
  dealRound(game, 0, newPlainCell);
  beginPlay(game);
  return game;
};

describe("bot view", () => {
  it("shows other snakes exactly `delay` ticks old, the oldest known early on, and itself and the food current", () => {
    const game = newGame(["me", "them"]);
    game.foodCoordinates.push({ x: 14, y: 0, type: "redApple", index: 0 });
    const snapshots = new Snapshots(2);
    const [me, them] = game.players;
    const startX = them.snake.x;
    for (let ticks = 1; ticks <= 5; ticks++) {
      snapshots.record(game);
      const view = viewFor(game, me, snapshots);
      assert.strictEqual(view.others[0].head.x, (startX + Math.max(0, ticks - 3)) % 20);
      assert.deepStrictEqual(view.self.head, { x: me.snake.x, y: me.snake.y });
      assert.deepStrictEqual(view.food, [{ x: 14, y: 0, type: "redApple", score: 10 }]);
      tick(game, mulberry32(1), newPlainCell);
    }
  });

  it("shows other snakes as they are now with no delay", () => {
    const game = newGame(["me", "them"]);
    const snapshots = new Snapshots(0);
    const [me, them] = game.players;
    tick(game, mulberry32(1), newPlainCell);
    snapshots.record(game);
    assert.deepStrictEqual(viewFor(game, me, snapshots).others, [{ head: { x: them.snake.x, y: them.snake.y }, body: [], isDead: false }]);
  });

  it("shows a snake as it is now until it has been recorded, and forgets everything when cleared", () => {
    const game = newGame(["me", "them"]);
    const snapshots = new Snapshots(2);
    const [me, them] = game.players;
    snapshots.record(game);
    const recordedX = them.snake.x;
    tick(game, mulberry32(1), newPlainCell);
    assert.strictEqual(viewFor(game, me, snapshots).others[0].head.x, recordedX);
    snapshots.clear();
    assert.strictEqual(viewFor(game, me, snapshots).others[0].head.x, them.snake.x);
  });

  it("describes the grid and its own heading", () => {
    const game = newGame(["me"]);
    turn(game.players[0].snake, "u");
    tick(game, mulberry32(1), newPlainCell);
    const view: BotView = viewFor(game, game.players[0], new Snapshots(2));
    assert.deepStrictEqual(view.grid, { width: 20, height: 20 });
    assert.deepStrictEqual(view.self.movedDirection, { x: 0, y: -1 });
    assert.deepStrictEqual(view.others, []);
  });
});

describe("bot view of the mode", () => {
  it("shows a timed round's mode, ticks left and total ticks, and its own score and hunger", () => {
    const game = newGame(["me", "them"]);
    beginPlay(game, 50);
    const [me] = game.players;
    me.snake.score = 30;
    tick(game, mulberry32(1), newPlainCell);
    const view = viewFor(game, me, new Snapshots(0));
    assert.strictEqual(view.mode, "timed");
    assert.strictEqual(view.ticksLeft, 49);
    assert.strictEqual(view.tickLimit, 50);
    assert.strictEqual(view.self.score, 30);
    assert.strictEqual(view.self.hunger, 0);
  });

  it("shows an endless round with no clock, and its hunger rising", () => {
    const game: PlainGame = { ...newGame(["me", "them"]), mode: "endless" };
    const [me] = game.players;
    tick(game, mulberry32(1), newPlainCell);
    tick(game, mulberry32(1), newPlainCell);
    const view = viewFor(game, me, new Snapshots(0));
    assert.strictEqual(view.mode, "endless");
    assert.strictEqual(view.ticksLeft, 0);
    assert.strictEqual(view.tickLimit, 0);
    assert.strictEqual(view.self.hunger, 2);
  });
});

describe("headless rookie against rookie", () => {
  /** Plays rookie against rookie from `seed`, each seeing the other `delay` ticks late, until the round is over. */
  const playRound = (seed: number, delay: number) => {
    const rng = mulberry32(seed);
    const game: PlainGame = {
      players: ["a", "b"].map((id) => ({ id, snake: newSnake() })),
      foodCoordinates: [],
      aliveCount: 0
    };
    const deciders: Record<string, Decider> = { a: rookie, b: rookie };
    const snapshots = new Snapshots(delay);

    layFood(game, rng, (placement) => ({ ...placement }));
    dealRound(game, 0, newPlainCell);
    snapshots.clear();
    beginPlay(game, 400);

    const reports = [];
    for (let t = 0; t < 1000; t++) {
      snapshots.record(game);
      game.players.forEach((player) => {
        if (!player.snake.isDead) turn(player.snake, deciders[player.id](viewFor(game, player, snapshots)));
      });
      const report = tick(game, rng, newPlainCell);
      reports.push({ report, game: structuredClone(game) });
      if (report.roundOver) return reports;
    }
    throw new Error("the round never ended");
  };

  it("plays a whole round to its end", () => {
    const reports = playRound(7, 2);
    const last = reports[reports.length - 1];
    assert.ok(last.report.roundOver);
    assert.ok(reports.some(({ report }) => report.events.some((e) => e.kind === "ate")), "nobody ate");
  });

  it("gives the same game from the same seed", () => {
    assert.deepStrictEqual(playRound(7, 2), playRound(7, 2));
    assert.notDeepStrictEqual(playRound(7, 2), playRound(8, 2));
  });
});
