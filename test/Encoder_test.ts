import assert from "assert";

import { Cell, FoodPlacement, GameShape, PlayerShape, beginPlay, dealRound, mulberry32, newPlainCell, tick, turn } from "../src/engine";
import { BotView, ENCODER_SIZE, ENCODER_VERSION, Snapshots, encode, viewFor } from "../src/bots";

type PlainGame = GameShape<Cell> & { players: PlayerShape<Cell>[]; foodCoordinates: FoodPlacement[] };
type Heading = { x: number; y: number };
type Turn = "left" | "straight" | "right";

// Where each group of features starts in the output.
const BLOCKED = 0;
const RISK = 9;
const PELLET = 12;
const ENEMY = 15;
const LENGTH = 18;
const MODE = 19;
const TIME = 20;
const HUNGER = 21;
const DRAINS = 22;

const headings: Record<string, Heading> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 }
};
const turns: Turn[] = ["left", "straight", "right"];

const HEAD = { x: 5, y: 5 };

/** The cell `forward` cells ahead of `head` and `side` to its right (negative: to its left), facing `heading`, wrapped. */
const rel = (heading: Heading, forward: number, side: number, head: Cell = HEAD): Cell => ({
  x: (head.x + forward * heading.x - side * heading.y + 20) % 20,
  y: (head.y + forward * heading.y + side * heading.x + 20) % 20
});

/** The cell `steps` away from `HEAD` on `turn`, facing `heading`. */
const along = (heading: Heading, turn: Turn, steps: number): Cell =>
  turn === "straight" ? rel(heading, steps, 0) : rel(heading, 0, turn === "left" ? -steps : steps);

const view = (over: Partial<BotView> = {}, self: Partial<BotView["self"]> = {}): BotView => ({
  grid: { width: 20, height: 20 },
  mode: "timed",
  ticksLeft: 100,
  tickLimit: 100,
  others: [],
  food: [],
  ...over,
  self: { head: HEAD, body: [], movedDirection: headings.right, score: 0, hunger: 0, ...self }
});

const close = (actual: number, expected: number, what = "") =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} isn't ${expected}`);

const slice = (out: number[], from: number, length: number) => out.slice(from, from + length);

/** A dealt game with no food, `ids` alive and heading right. */
const newGame = (ids: string[], mode?: "endless"): PlainGame => {
  const game: PlainGame = {
    players: ids.map((id) => ({
      id,
      snake: { x: 0, y: 0, direction: { x: 0, y: 0 }, movedDirection: { x: 0, y: 0 }, tail: [] as Cell[], tailCursor: 0, size: 0, score: 0, hunger: 0, isDead: true }
    })),
    foodCoordinates: [],
    aliveCount: 0,
    ...(mode && { mode })
  };
  dealRound(game, 0, newPlainCell);
  return game;
};

describe("encoder v1", () => {
  it("is version 1, of 23 values", () => {
    assert.strictEqual(ENCODER_VERSION, 1);
    assert.strictEqual(ENCODER_SIZE, 23);
  });

  it("always gives exactly 23 finite values, roughly in -1 to 1", () => {
    const views = [
      view(),
      view({ mode: "endless", ticksLeft: 0, tickLimit: 0 }, { score: 10_000, hunger: 10_000, movedDirection: { x: 0, y: 0 } }),
      view({ ticksLeft: 0, tickLimit: 0 }),
      view(
        {
          others: [{ head: { x: 15, y: 15 }, body: [{ x: 14, y: 15 }], isDead: false }],
          food: [{ x: 5, y: 5, type: "chili", score: 50 }, { x: 15, y: 5, type: "chili", score: 50 }]
        },
        { body: Array.from({ length: 300 }, (_, i) => ({ x: i % 20, y: 6 + Math.floor(i / 20) })) }
      )
    ];
    views.forEach((v) => {
      const out = encode(v);
      assert.strictEqual(out.length, 23);
      out.forEach((value, i) => {
        assert.ok(Number.isFinite(value), `feature ${i} is ${value}`);
        assert.ok(value >= -1 && value <= 1, `feature ${i} is ${value}`);
      });
    });
  });

  it("writes into the array it's given, and gives the same numbers for the same view", () => {
    const v = view({ food: [{ x: 7, y: 2, type: "banana", score: 25 }] }, { body: [{ x: 4, y: 5 }] });
    const out = new Array<number>(23).fill(9);
    assert.strictEqual(encode(v, out), out);
    assert.deepStrictEqual(out, encode(v));
  });

  describe("blocked", () => {
    Object.entries(headings).forEach(([name, heading]) => {
      turns.forEach((turn, t) => {
        [1, 2, 3].forEach((steps) => {
          const index = BLOCKED + t * 3 + steps - 1;
          const expected = Array.from({ length: 9 }, (_, i) => (i === index ? 1 : 0));

          it(`heading ${name}, sees ${steps} ${steps === 1 ? "step" : "steps"} ${turn} blocked by its own body, a live head or a live body`, () => {
            const cell = along(heading, turn, steps);
            const own = view({}, { movedDirection: heading, body: [cell] });
            const enemyHead = view({ others: [{ head: cell, body: [], isDead: false }] }, { movedDirection: heading });
            const enemyBody = view({ others: [{ head: { x: 15, y: 15 }, body: [cell], isDead: false }] }, { movedDirection: heading });
            assert.deepStrictEqual(slice(encode(own), BLOCKED, 9), expected);
            assert.deepStrictEqual(slice(encode(enemyHead), BLOCKED, 9), expected);
            assert.deepStrictEqual(slice(encode(enemyBody), BLOCKED, 9), expected);
          });
        });
      });
    });

    it("sees a body just across the board's edge as blocked", () => {
      const v = view({}, { head: { x: 19, y: 0 }, body: [{ x: 0, y: 0 }, { x: 19, y: 19 }] });
      const out = encode(v);
      assert.strictEqual(out[BLOCKED + 3], 1, "straight, across the right edge");
      assert.strictEqual(out[BLOCKED + 0], 1, "left, across the top edge");
    });

    it("doesn't see a dead snake as blocked", () => {
      const v = view({ others: [{ head: rel(headings.right, 1, 0), body: [rel(headings.right, 2, 0), rel(headings.right, 0, 1)], isDead: true }] });
      assert.deepStrictEqual(slice(encode(v), BLOCKED, 9), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe("head-on risk", () => {
    Object.entries(headings).forEach(([name, heading]) => {
      it(`heading ${name}, flags each next cell that's beside a live enemy head, and only that one`, () => {
        // Two cells out on each turn is beside that turn's next cell and no other's.
        turns.forEach((turn, t) => {
          const v = view({ others: [{ head: along(heading, turn, 2), body: [], isDead: false }] }, { movedDirection: heading });
          assert.deepStrictEqual(slice(encode(v), RISK, 3), [0, 1, 2].map((i) => (i === t ? 1 : 0)), turn);
        });
      });
    });

    it("flags nothing for a dead enemy's head", () => {
      const v = view({ others: [{ head: rel(headings.right, 2, 0), body: [], isDead: true }] });
      assert.deepStrictEqual(slice(encode(v), RISK, 3), [0, 0, 0]);
    });

    it("sees an enemy head across the board's edge", () => {
      const v = view({ others: [{ head: { x: 1, y: 5 }, body: [], isDead: false }] }, { head: { x: 19, y: 5 } });
      assert.deepStrictEqual(slice(encode(v), RISK, 3), [0, 1, 0]);
    });
  });

  describe("best pellet", () => {
    Object.entries(headings).forEach(([name, heading]) => {
      it(`heading ${name}, gives its forward and sideways offsets, left and right, over half the board, and its value over the best food's`, () => {
        const ahead = view({ food: [{ ...rel(heading, 2, -3), type: "banana", score: 25 }] }, { movedDirection: heading });
        const behind = view({ food: [{ ...rel(heading, -4, 1), type: "chili", score: 50 }] }, { movedDirection: heading });
        const [f1, s1, v1] = slice(encode(ahead), PELLET, 3);
        const [f2, s2, v2] = slice(encode(behind), PELLET, 3);
        close(f1, 0.2, "forward");
        close(s1, -0.3, "to the left");
        close(v1, 0.5, "value");
        close(f2, -0.4, "behind");
        close(s2, 0.1, "to the right");
        close(v2, 1, "value");
      });
    });

    it("picks the highest score for its distance, not the nearest", () => {
      const v = view({
        food: [
          { ...rel(headings.right, 1, 0), type: "redApple", score: 10 },
          { ...rel(headings.right, 0, 3), type: "chili", score: 50 },
          { ...rel(headings.right, 0, -2), type: "redApple", score: 10 }
        ]
      });
      const [forward, side, value] = slice(encode(v), PELLET, 3);
      close(forward, 0);
      close(side, 0.3);
      close(value, 1);
    });

    it("sees a pellet across the board's edge as near, with no vision limit", () => {
      const near = view({ food: [{ x: 0, y: 5, type: "redApple", score: 10 }] }, { head: { x: 19, y: 5 } });
      assert.deepStrictEqual(slice(encode(near), PELLET, 2), [0.1, 0]);
      const far = view({ food: [{ x: 5, y: 15, type: "redApple", score: 10 }] });
      assert.deepStrictEqual(slice(encode(far), PELLET, 2), [0, 1]);
    });

    it("gives zeros when there's no pellet", () => {
      assert.deepStrictEqual(slice(encode(view()), PELLET, 3), [0, 0, 0]);
    });
  });

  describe("nearest live enemy head", () => {
    Object.entries(headings).forEach(([name, heading]) => {
      it(`heading ${name}, gives its forward and sideways offsets, left and right, and that it exists`, () => {
        const v = view(
          {
            others: [
              { head: rel(heading, 1, -1), body: [], isDead: true },
              { head: rel(heading, 6, 6), body: [], isDead: false },
              { head: rel(heading, 3, -2), body: [], isDead: false }
            ]
          },
          { movedDirection: heading }
        );
        const [forward, side, exists] = slice(encode(v), ENEMY, 3);
        close(forward, 0.3);
        close(side, -0.2);
        assert.strictEqual(exists, 1);
        const behindRight = view({ others: [{ head: rel(heading, -2, 5), body: [], isDead: false }] }, { movedDirection: heading });
        assert.deepStrictEqual(slice(encode(behindRight), ENEMY, 3), [-0.2, 0.5, 1]);
      });
    });

    it("sees an enemy across the board's edge as near", () => {
      const v = view({ others: [{ head: { x: 5, y: 18 }, body: [], isDead: false }] }, { head: { x: 5, y: 1 }, movedDirection: headings.up });
      assert.deepStrictEqual(slice(encode(v), ENEMY, 3), [0.3, 0, 1]);
    });

    it("gives zeros when there's no live enemy", () => {
      assert.deepStrictEqual(slice(encode(view()), ENEMY, 3), [0, 0, 0]);
      const dead = view({ others: [{ head: { x: 7, y: 5 }, body: [], isDead: true }] });
      assert.deepStrictEqual(slice(encode(dead), ENEMY, 3), [0, 0, 0]);
    });

    it("encodes where the enemy was, when the view is out of date by the reaction delay", () => {
      const game = newGame(["me", "them"]);
      beginPlay(game);
      const [me, them] = game.players;
      turn(them.snake, "d");
      const snapshots = new Snapshots(2);
      const heads: Cell[] = [];
      for (let t = 0; t < 4; t++) {
        heads.push({ x: them.snake.x, y: them.snake.y });
        snapshots.record(game);
        tick(game, mulberry32(1), newPlainCell);
      }
      snapshots.record(game);

      // I head right, so an offset is just where the enemy is less where I am, the shortest way round.
      const offset = (from: number, to: number) => {
        const d = (((to - from) % 20) + 20) % 20;
        return (d > 10 ? d - 20 : d) / 10;
      };
      const seenAt = (head: Cell) => [offset(me.snake.x, head.x), offset(me.snake.y, head.y), 1];
      const seen = slice(encode(viewFor(game, me, snapshots)), ENEMY, 3);
      assert.deepStrictEqual(seen, seenAt(heads[2]), "not where it was 2 ticks ago");
      assert.notDeepStrictEqual(seen, seenAt({ x: them.snake.x, y: them.snake.y }), "where it is now");
    });
  });

  it("gives its length, head included, over twice the board's side", () => {
    close(encode(view({}, { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }] }))[LENGTH], 0.1);
    close(encode(view())[LENGTH], 1 / 40);
  });

  describe("mode inputs", () => {
    it("in a timed round: mode 0, the fraction of time left falling, no hunger, and a neutral score", () => {
      const game = newGame(["me", "them"]);
      beginPlay(game, 200);
      const [me] = game.players;
      me.snake.score = 5;
      const at = () => slice(encode(viewFor(game, me, new Snapshots(0))), MODE, 4);
      assert.deepStrictEqual(at(), [0, 1, 0, 1]);
      tick(game, mulberry32(1), newPlainCell);
      assert.deepStrictEqual(at(), [0, 199 / 200, 0, 1]);
      for (let t = 0; t < 99; t++) tick(game, mulberry32(1), newPlainCell);
      assert.deepStrictEqual(at(), [0, 0.5, 0, 1]);
    });

    it("in a timed round with no limit, a full clock", () => {
      assert.strictEqual(encode(view({ ticksLeft: 0, tickLimit: 0 }))[TIME], 1);
    });

    it("in an endless round: mode 1, a full clock, and the hunger clock rising over the ticks to hunger", () => {
      const game = newGame(["me", "them"], "endless");
      beginPlay(game);
      const [me] = game.players;
      const at = () => slice(encode(viewFor(game, me, new Snapshots(0))), MODE, 3);
      assert.deepStrictEqual(at(), [1, 1, 0]);
      for (let t = 0; t < 8; t++) tick(game, mulberry32(1), newPlainCell);
      assert.deepStrictEqual(at(), [1, 1, 0.1]);
      for (let t = 0; t < 32; t++) tick(game, mulberry32(1), newPlainCell);
      assert.deepStrictEqual(at(), [1, 1, 0.5]);
      assert.strictEqual(encode(view({ mode: "endless" }, { hunger: 200 }))[HUNGER], 1, "hunger past the drain stays at 1");
    });

    it("in an endless round, the drains its score can take before it starves, over 10", () => {
      const drains = (score: number) => encode(view({ mode: "endless", ticksLeft: 0, tickLimit: 0 }, { score }))[DRAINS];
      close(drains(0), 0);
      close(drains(4), 0);
      close(drains(5), 0.1);
      close(drains(12), 0.2);
      close(drains(50), 1);
      close(drains(500), 1);
    });
  });
});
