import assert from "assert";

import {
  Cell,
  Direction,
  FoodPlacement,
  GameShape,
  PlayerShape,
  RULES_VERSION,
  beginPlay,
  dealRound,
  layFood,
  mulberry32,
  newPlainCell,
  removeFromPlay,
  setTail,
  startingPositions,
  tailCells,
  tick,
  turn
} from "../src/engine";
import { spawnCells } from "../src/engine/config";

type PlainPlayer = PlayerShape<Cell>;
type PlainGame = GameShape<Cell> & { players: PlainPlayer[]; foodCoordinates: FoodPlacement[] };

/** A snake left over from some earlier round, so round start has something to reset. */
const staleSnake = () => {
  const snake = {
    x: 3, y: 7,
    direction: { x: 0, y: -1 },
    movedDirection: { x: 0, y: -1 },
    tail: [] as Cell[],
    tailCursor: 0,
    size: 3,
    score: 90,
    isDead: true
  };
  setTail(snake, [{ x: 3, y: 8 }, { x: 3, y: 9 }], newPlainCell);
  return snake;
};

const plainGame = (ids: string[]): PlainGame => ({
  players: ids.map((id) => ({ id, snake: staleSnake() })),
  foodCoordinates: [],
  aliveCount: 0
});

const copyPlacement = (placement: FoodPlacement) => ({ ...placement });

describe("engine round start", () => {
  it("deals each snake its spawn cell, heading right, alive, with no tail or score", () => {
    const game = plainGame(["a", "b", "c"]);

    dealRound(game, 1, newPlainCell);

    const spawns = spawnCells(3, 1);
    game.players.forEach(({ snake }, i) => {
      assert.deepStrictEqual({ x: snake.x, y: snake.y }, spawns[i]);
      assert.deepStrictEqual({ ...snake.direction }, { x: 1, y: 0 });
      assert.deepStrictEqual(snake.movedDirection, { x: 1, y: 0 });
      assert.strictEqual(snake.isDead, false);
      assert.strictEqual(snake.size, 1);
      assert.strictEqual(snake.score, 0);
      assert.deepStrictEqual(tailCells(snake), []);
    });
  });

  it("rolls the spawn offset on so the same seat doesn't start in the same corner", () => {
    const game = plainGame(["a", "b", "c"]);

    const next = dealRound(game, 0, newPlainCell);
    const firstSeat = { x: game.players[0].snake.x, y: game.players[0].snake.y };

    assert.strictEqual(next, 3 % startingPositions.length);
    dealRound(game, next, newPlainCell);
    assert.deepStrictEqual(
      game.players.map(({ snake }) => ({ x: snake.x, y: snake.y })),
      spawnCells(3, next)
    );
    assert.notDeepStrictEqual({ x: game.players[0].snake.x, y: game.players[0].snake.y }, firstSeat);
  });

  it("counts every snake in when play begins", () => {
    const game = plainGame(["a", "b", "c"]);
    dealRound(game, 0, newPlainCell);

    beginPlay(game);

    assert.strictEqual(game.aliveCount, 3);
  });
});

describe("engine initial food", () => {
  it("lays out the board's opening food from the seed", () => {
    const lay = (seed: number) => {
      const game = plainGame([]);
      layFood(game, mulberry32(seed), copyPlacement);
      return game.foodCoordinates;
    };

    assert.ok(lay(1).length > 0);
    assert.deepStrictEqual(lay(1), lay(1));
    assert.notDeepStrictEqual(lay(1), lay(2));
  });
});

describe("engine leaver", () => {
  it("takes a leaver's snake out of play without ending a round others are still in", () => {
    const game = plainGame(["a", "b", "c"]);
    dealRound(game, 0, newPlainCell);
    beginPlay(game);

    const report = removeFromPlay(game, game.players[0].snake);

    assert.strictEqual(game.players[0].snake.isDead, true);
    assert.strictEqual(game.aliveCount, 2);
    assert.strictEqual(report.roundOver, false);
  });

  it("ends the round when the leaver leaves a single snake standing", () => {
    const game = plainGame(["a", "b"]);
    dealRound(game, 0, newPlainCell);
    beginPlay(game);

    const report = removeFromPlay(game, game.players[0].snake);

    assert.deepStrictEqual(report, { roundOver: true, winnerId: "b" });
  });

  it("doesn't count a snake that was already dead twice", () => {
    const game = plainGame(["a", "b", "c"]);
    dealRound(game, 0, newPlainCell);
    beginPlay(game);
    removeFromPlay(game, game.players[0].snake);

    const report = removeFromPlay(game, game.players[0].snake);

    assert.strictEqual(game.aliveCount, 2);
    assert.strictEqual(report.roundOver, false);
  });
});

describe("headless round and replay", () => {
  // Both snakes step up a row and turn to face each other, meeting head-on
  // a few ticks later. Missing ticks mean nobody presses anything.
  const script: Partial<Record<string, Direction>>[] = [
    { a: "u", b: "u" },
    { a: "r", b: "l" }
  ];

  /** Plays one whole round from `seed`, returning a copy of the game after every tick. */
  const playRound = (seed: number) => {
    const rng = mulberry32(seed);
    const game = plainGame(["a", "b"]);

    layFood(game, rng, copyPlacement);
    dealRound(game, 0, newPlainCell);
    beginPlay(game);

    const states: PlainGame[] = [];
    for (let t = 0; t < 100; t++) {
      game.players.forEach(({ id, snake }) => {
        const key = script[t]?.[id];
        if (key && !snake.isDead) turn(snake, key);
      });

      const report = tick(game, rng, newPlainCell);
      states.push(structuredClone(game));

      if (report.roundOver) return states;
    }
    throw new Error("the scripted round never ended");
  };

  it("plays a whole seeded round on plain objects until it is over", () => {
    const states = playRound(7);
    const last = states[states.length - 1];

    assert.ok(last.aliveCount <= 1);
    assert.ok(last.players.every((p) => p.snake.isDead));
  });

  it("replays identically, tick for tick, from the same seed and turns", () => {
    assert.deepStrictEqual(playRound(7), playRound(7));
  });

  it("lays out different food from a different seed", () => {
    assert.notDeepStrictEqual(playRound(7)[0].foodCoordinates, playRound(8)[0].foodCoordinates);
  });
});

describe("RULES_VERSION", () => {
  it("is exported", () => {
    assert.strictEqual(RULES_VERSION, 1);
  });
});
