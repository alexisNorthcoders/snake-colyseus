import assert from "assert";

import { Cell, foodScore, gameConfig } from "../src/gameConfig";
import { Direction } from "../src/contants";
import { mulberry32 } from "../src/engine/rng";
import { newPlainCell, setTail, tailCells } from "../src/engine/tail";
import { GameShape, PlayerShape, tick, turn } from "../src/engine/tick";

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

const right = { x: 1, y: 0 };
const left = { x: -1, y: 0 };
const down = { x: 0, y: 1 };

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
    assert.deepStrictEqual(report, { died: [], roundOver: false });
  });

  it("kills both snakes in a head-on collision", () => {
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.died, ["a", "b"]);
    assert.ok(game.players.every((p) => p.snake.isDead));
  });

  it("kills both snakes when their heads swap cells", () => {
    const game = plainGame([
      plainPlayer("a", { x: 5, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.died, ["a", "b"]);
  });

  it("kills a snake that runs into a body", () => {
    // b's body lies across a's path and, after b moves, still covers (5, 5).
    const game = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 3 }, down, [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);

    const report = run(game);

    assert.deepStrictEqual(report.died, ["a"]);
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

    assert.deepStrictEqual(report, { died: [], roundOver: false });
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
    assert.deepStrictEqual(run(threeWay), { died: ["a", "b"], roundOver: true });
    assert.strictEqual(threeWay.aliveCount, 1);

    const everyone = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);
    assert.deepStrictEqual(run(everyone), { died: ["a", "b"], roundOver: true });
    assert.strictEqual(everyone.aliveCount, 0);

    const fourWay = plainGame([
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down),
      plainPlayer("d", { x: 15, y: 15 }, down)
    ]);
    assert.deepStrictEqual(run(fourWay), { died: ["a", "b"], roundOver: false });
    assert.strictEqual(fourWay.aliveCount, 2);
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
