import assert from "assert";

import {
  Cell,
  Direction,
  GameShape,
  PlayerShape,
  TickReport,
  foodScore,
  mulberry32,
  newPlainCell,
  setTail,
  tailCells,
  tick,
  turn
} from "../src/engine";
import { gameConfig } from "../src/gameConfig";

type PlainPlayer = PlayerShape<Cell>;
type PlainGame = GameShape<Cell> & { players: PlainPlayer[] };

/** A live, schema-free snake at `head` heading `direction`, with `tail` given newest first. */
const plainPlayer = (id: string, head: Cell, direction: Cell, tail: Cell[] = []): PlainPlayer => {
  const snake = {
    ...head,
    direction: { ...direction },
    movedDirection: { ...direction },
    tail: [] as Cell[],
    tailCursor: 0,
    size: tail.length + 1,
    score: 0,
    isDead: false
  };
  setTail(snake, tail, newPlainCell);
  return { id, snake };
};

/** A plain game with every snake alive and, unless given, one pellet far from the action. */
const plainGame = (players: PlainPlayer[], food = [{ x: 19, y: 19, index: 0, type: "redApple" }]): PlainGame => ({
  players,
  foodCoordinates: food,
  aliveCount: players.length
});

const run = (game: PlainGame) => tick(game, mulberry32(1), newPlainCell);

/** Who died in a tick's report, next to whether the round is over. */
const diedIn = (report: TickReport) => ({
  died: report.events.flatMap((event) => (event.kind === "died" ? [event.player] : [])),
  roundOver: report.roundOver
});

const right = { x: 1, y: 0 };
const left = { x: -1, y: 0 };
const down = { x: 0, y: 1 };
const up = { x: 0, y: -1 };

describe("engine tick", () => {
  it("moves every live snake and wraps round the board's edge", () => {
    const edge = gameConfig.scaleFactor - 1;
    const game = plainGame([
      plainPlayer("a", { x: edge, y: 3 }, right, [{ x: edge - 1, y: 3 }]),
      plainPlayer("b", { x: 5, y: 5 }, down)
    ]);

    const report = run(game);

    const [a, b] = game.players.map((p) => p.snake);
    assert.deepStrictEqual({ x: a.x, y: a.y }, { x: 0, y: 3 });
    assert.deepStrictEqual(tailCells(a), [{ x: edge, y: 3 }]);
    assert.deepStrictEqual(a.movedDirection, right);
    assert.deepStrictEqual({ x: b.x, y: b.y }, { x: 5, y: 6 });
    assert.deepStrictEqual(report, { events: [], roundOver: false });
  });

  it("kills both snakes in a head-on collision", () => {
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [
      { kind: "died", player: "a", cause: "head-on", by: "b" },
      { kind: "died", player: "b", cause: "head-on", by: "a" }
    ]);
    assert.ok(game.players.every((p) => p.snake.isDead));
  });

  it("kills both snakes when their heads swap cells", () => {
    const game = plainGame([
      plainPlayer("a", { x: 5, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [
      { kind: "died", player: "a", cause: "head-on", by: "b" },
      { kind: "died", player: "b", cause: "head-on", by: "a" }
    ]);
  });

  it("kills a snake that runs into a body", () => {
    // b's body lies across a's path and, after b moves, still covers (5, 5).
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 3 }, down, [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [{ kind: "died", player: "a", cause: "body", by: "b" }]);
    assert.strictEqual(game.players[1].snake.isDead, false);
  });

  it("lets a snake pass through a dead body", () => {
    const corpse = plainPlayer("dead", { x: 5, y: 3 }, down, [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]);
    corpse.snake.isDead = true;
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      corpse,
      plainPlayer("b", { x: 10, y: 10 }, down)
    ]);
    game.aliveCount = 2;

    const report = run(game);

    assert.deepStrictEqual(report, { events: [], roundOver: false });
    assert.deepStrictEqual({ x: game.players[0].snake.x, y: game.players[0].snake.y }, { x: 5, y: 5 });
    assert.deepStrictEqual({ x: corpse.snake.x, y: corpse.snake.y }, { x: 5, y: 3 }, "a dead snake moved");
  });

  it("lets a surviving snake eat, respawning the pellet in place", () => {
    const pellet = { x: 5, y: 5, index: 0, type: "cherry" };
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 10, y: 10 }, down)
    ], [pellet]);

    run(game);

    const a = game.players[0].snake;
    assert.strictEqual(a.score, foodScore.cherry);
    assert.strictEqual(a.size, 2);
    assert.deepStrictEqual(tailCells(a), [{ x: 5, y: 5 }], "a tailless snake grows on its head");
    assert.strictEqual(game.foodCoordinates[0], pellet, "the pellet was replaced, not moved");
    assert.notDeepStrictEqual({ x: pellet.x, y: pellet.y }, { x: 5, y: 5 });
  });

  it("doesn't let a snake that dies this tick eat", () => {
    const pellet = { x: 5, y: 5, index: 0, type: "cherry" };
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ], [pellet]);

    run(game);

    assert.ok(game.players.slice(0, 2).every((p) => p.snake.score === 0 && p.snake.size === 1));
    assert.deepStrictEqual({ x: pellet.x, y: pellet.y }, { x: 5, y: 5 }, "the pellet moved");
  });

  it("says the round is over once at most one snake is left alive", () => {
    const threeWay = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);
    assert.deepStrictEqual(diedIn(run(threeWay)), { died: ["a", "b"], roundOver: true });
    assert.strictEqual(threeWay.aliveCount, 1);

    const everyone = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);
    assert.deepStrictEqual(diedIn(run(everyone)), { died: ["a", "b"], roundOver: true });
    assert.strictEqual(everyone.aliveCount, 0);

    const fourWay = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down),
      plainPlayer("d", { x: 15, y: 15 }, down)
    ]);
    assert.deepStrictEqual(diedIn(run(fourWay)), { died: ["a", "b"], roundOver: false });
    assert.strictEqual(fourWay.aliveCount, 2);
  });
});

describe("engine tick events", () => {
  it("reports running into your own tail as self, with no by", () => {
    // Heading up into its own body, which curls round from (5, 4) to (5, 6).
    const game = plainGame([
      plainPlayer("a", { x: 5, y: 5 }, up, [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }]),
      plainPlayer("b", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [{ kind: "died", player: "a", cause: "self" }]);
    assert.ok(!("by" in report.events[0]), "a self death named someone");
  });

  it("never names a dead body as by", () => {
    // a passes through the corpse and runs into b's body on the same cell.
    const corpse = plainPlayer("dead", { x: 5, y: 3 }, down, [{ x: 5, y: 4 }, { x: 5, y: 5 }]);
    corpse.snake.isDead = true;
    const game = plainGame([
      corpse,
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 7, y: 5 }, down, [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 6 }]),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);
    game.aliveCount = 3;

    const report = run(game);

    assert.deepStrictEqual(report.events, [{ kind: "died", player: "a", cause: "body", by: "b" }]);
  });

  it("names the first other snake in player order when three heads share a cell", () => {
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 5, y: 4 }, down),
      plainPlayer("d", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [
      { kind: "died", player: "a", cause: "head-on", by: "b" },
      { kind: "died", player: "b", cause: "head-on", by: "a" },
      { kind: "died", player: "c", cause: "head-on", by: "a" }
    ]);
  });

  it("calls a head that lands on another head and a body head-on", () => {
    // a and b meet on (5, 5), which c's body also covers; c comes first in
    // player order, so a body death would have named it.
    const game = plainGame([
      plainPlayer("c", { x: 6, y: 3 }, right, [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]),
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("d", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [
      { kind: "died", player: "a", cause: "head-on", by: "b" },
      { kind: "died", player: "b", cause: "head-on", by: "a" }
    ]);
  });

  it("calls a swap head-on even when a body covers the cell too", () => {
    // a and b swap cells, and b's tail follows it onto (6, 5), where a lands.
    const game = plainGame([
      plainPlayer("a", { x: 5, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left, [{ x: 7, y: 5 }]),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.events, [
      { kind: "died", player: "a", cause: "head-on", by: "b" },
      { kind: "died", player: "b", cause: "head-on", by: "a" }
    ]);
  });

  it("reports each pellet eaten, as it was before it respawned, adding up to the score", () => {
    const pellets = [
      { x: 5, y: 5, index: 0, type: "cherry" },
      { x: 6, y: 5, index: 1, type: "redApple" },
      { x: 10, y: 13, index: 2, type: "banana" }
    ];
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 10, y: 10 }, down)
    ], pellets);
    const rng = mulberry32(3);

    const events = [0, 1, 2].flatMap(() => tick(game, rng, newPlainCell).events);

    assert.deepStrictEqual(events, [
      { kind: "ate", player: "a", food: { type: "cherry", x: 5, y: 5 }, score: foodScore.cherry },
      { kind: "ate", player: "a", food: { type: "redApple", x: 6, y: 5 }, score: foodScore.redApple },
      { kind: "ate", player: "b", food: { type: "banana", x: 10, y: 13 }, score: foodScore.banana }
    ]);
    game.players.forEach(({ id, snake }) => {
      const gained = events.reduce((sum, e) => (e.kind === "ate" && e.player === id ? sum + e.score : sum), 0);
      assert.strictEqual(gained, snake.score, `${id}'s ate events don't add up to its score`);
    });
  });

  it("reports no ate event for a snake that dies on a pellet", () => {
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ], [{ x: 5, y: 5, index: 0, type: "cherry" }]);

    const report = run(game);

    assert.ok(report.events.every((event) => event.kind === "died"), "a dying snake ate");
  });
});

describe("engine turn", () => {
  const turned = (moved: Cell, key: Direction) => {
    const snake = { direction: { ...moved }, movedDirection: { ...moved } };
    turn(snake, key);
    return snake.direction;
  };

  it("points the snake the new way", () => {
    assert.deepStrictEqual(turned(right, "d"), down);
    assert.deepStrictEqual(turned(right, "u"), { x: 0, y: -1 });
  });

  it("ignores a reversal into the snake's own body", () => {
    assert.deepStrictEqual(turned(right, "l"), right);
    assert.deepStrictEqual(turned(down, "u"), down);
  });

  it("checks against the way the snake last moved, not the last key", () => {
    // Two keys inside one tick: right then up then left must not add up to a reversal.
    const snake = { direction: { ...right }, movedDirection: { ...right } };
    turn(snake, "u");
    turn(snake, "l");
    assert.deepStrictEqual(snake.direction, { x: 0, y: -1 });
  });

  it("changes the direction in place rather than replacing it", () => {
    const snake = { direction: { ...right }, movedDirection: { ...right } };
    const direction = snake.direction;
    turn(snake, "d");
    assert.strictEqual(snake.direction, direction);
  });
});
