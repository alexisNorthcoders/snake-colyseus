import assert from "assert";

import {
  Cell,
  GameMode,
  GameShape,
  PlayerShape,
  beginPlay,
  mulberry32,
  newPlainCell,
  setTail,
  tick
} from "../src/engine";

type PlainPlayer = PlayerShape<Cell>;
type PlainGame = GameShape<Cell> & { players: PlainPlayer[] };

const right = { x: 1, y: 0 };
const left = { x: -1, y: 0 };
const down = { x: 0, y: 1 };

/** A live snake at `head` heading `direction`, `size` long, with `score` points. */
const plainPlayer = (id: string, head: Cell, direction: Cell, { score = 0, size = 1 } = {}): PlainPlayer => {
  const snake = {
    ...head,
    direction: { ...direction },
    movedDirection: { ...direction },
    tail: [] as Cell[],
    tailCursor: 0,
    size,
    score,
    hunger: 0,
    isDead: false
  };
  setTail(snake, [], newPlainCell);
  return { id, snake };
};

/** A game of `players` in `mode` that has just begun play with `tickLimit`. Its one pellet is out of everyone's way. */
const begun = (mode: GameMode | undefined, tickLimit: number, players: PlainPlayer[]): PlainGame => {
  const game: PlainGame = {
    players,
    foodCoordinates: [{ x: 19, y: 0, index: 0, type: "redApple" }],
    aliveCount: 0,
    ...(mode && { mode })
  };
  beginPlay(game, tickLimit);
  return game;
};

const run = (game: PlainGame) => tick(game, mulberry32(1), newPlainCell);

/** Two snakes far apart heading down, who won't meet in a short round. */
const apart = (a = {}, b = {}) => [
  plainPlayer("a", { x: 2, y: 2 }, down, a),
  plainPlayer("b", { x: 12, y: 2 }, down, b)
];

describe("timed round", () => {
  it("ends on exactly its tick limit and not before, counting the ticks left down", () => {
    const game = begun("timed", 3, apart());
    assert.strictEqual(game.ticksLeft, 3);

    assert.strictEqual(run(game).roundOver, false);
    assert.strictEqual(game.ticksLeft, 2);
    assert.strictEqual(run(game).roundOver, false);
    assert.strictEqual(game.ticksLeft, 1);
    assert.deepStrictEqual(run(game), { events: [], roundOver: true, reason: "time-up" });
    assert.strictEqual(game.ticksLeft, 0);
  });

  it("is timed when the game has no mode", () => {
    const game = begun(undefined, 1, apart());
    assert.strictEqual(run(game).roundOver, true);
  });

  it("ends early with the one snake left alive as the winner", () => {
    const game = begun("timed", 100, [
      plainPlayer("a", { x: 4, y: 5 }, right),
      plainPlayer("b", { x: 6, y: 5 }, left),
      plainPlayer("c", { x: 10, y: 10 }, down)
    ]);
    game.players[0].snake.score = 50;

    assert.deepStrictEqual(run(game), {
      events: [
        { kind: "died", player: "a", cause: "head-on", by: "b" },
        { kind: "died", player: "b", cause: "head-on", by: "a" }
      ],
      roundOver: true,
      reason: "last-standing",
      winnerId: "c"
    });
    assert.strictEqual(game.ticksLeft, 99);
  });

  it("gives the win on time to the highest-scoring live snake, even when a dead snake scored more", () => {
    const players = [
      ...apart({ score: 10 }, { score: 30 }),
      plainPlayer("dead", { x: 2, y: 12 }, down, { score: 500 })
    ];
    const game = begun("timed", 1, players);
    players[2].snake.isDead = true;
    game.aliveCount = 2;

    assert.deepStrictEqual(run(game), { events: [], roundOver: true, reason: "time-up", winnerId: "b" });
  });

  it("breaks a score tie on time in favour of the longer snake", () => {
    const game = begun("timed", 1, apart({ score: 20, size: 3 }, { score: 20, size: 2 }));
    assert.deepStrictEqual(run(game), { events: [], roundOver: true, reason: "time-up", winnerId: "a" });
  });

  it("calls a tie on score and length a draw, with no winner", () => {
    const game = begun("timed", 1, apart({ score: 20, size: 2 }, { score: 20, size: 2 }));
    const report = run(game);
    assert.strictEqual(report.roundOver, true);
    assert.ok(!("winnerId" in report), `winnerId named: ${JSON.stringify(report)}`);
  });

  it("has no winner when every snake is dead", () => {
    const game = begun("timed", 100, [
      plainPlayer("a", { x: 4, y: 5 }, right, { score: 40 }),
      plainPlayer("b", { x: 6, y: 5 }, left)
    ]);
    const report = run(game);
    assert.strictEqual(report.roundOver, true);
    assert.ok(!("winnerId" in report), `winnerId named: ${JSON.stringify(report)}`);
  });
});

describe("endless round", () => {
  it("has no tick limit", () => {
    const game = begun("endless", 1, apart());
    assert.strictEqual(game.ticksLeft, undefined);

    for (let t = 0; t < 10; t++) assert.strictEqual(run(game).roundOver, false);
  });
});
