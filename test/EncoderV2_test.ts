import assert from "assert";

import { Cell, FoodPlacement, GameShape, PlayerShape, beginPlay, dealRound, newPlainCell } from "../src/engine";
import { BotView, ENCODER_SIZE, ENCODER_V2_SIZE, ENCODER_V2_VERSION, Snapshots, encodeV2, viewFor } from "../src/bots";

type Heading = { x: number; y: number };

const SELF = 0;
const ENEMIES = 81;
const FOOD = 162;
const HEADS = 243;
const MODE = 324;

const headings: Record<string, Heading> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 }
};

const HEAD = { x: 10, y: 10 };

/** The cell `forward` cells ahead of `head` and `side` to its right, facing `heading`, wrapped. */
const rel = (heading: Heading, forward: number, side: number, head: Cell = HEAD): Cell => ({
  x: (head.x + forward * heading.x - side * heading.y + 20) % 20,
  y: (head.y + forward * heading.y + side * heading.x + 20) % 20
});

/** Where the cell `up` ahead and `across` to the right is, in a channel of the output. */
const at = (channel: number, up: number, across: number) => channel + (4 - up) * 9 + (across + 4);

/** Every place in `out` that isn't 0, as index → value. */
const lit = (out: number[]) => Object.fromEntries(out.slice(0, MODE).flatMap((v, i) => (v === 0 ? [] : [[i, v]])));

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

const enemy = (cells: Cell[], isDead = false) => ({ head: cells[0], body: cells.slice(1), isDead });

describe("encoder v2", () => {
  it("is version 2, of 328 values, and v1 is untouched", () => {
    assert.strictEqual(ENCODER_V2_VERSION, 2);
    assert.strictEqual(ENCODER_V2_SIZE, 328);
    assert.strictEqual(ENCODER_SIZE, 23);
  });

  it("always gives exactly 328 finite values", () => {
    const views = [
      view(),
      view({ mode: "endless", ticksLeft: 0, tickLimit: 0 }, { score: 10_000, hunger: 10_000, movedDirection: { x: 0, y: 0 } }),
      view({ ticksLeft: 0, tickLimit: 0 }),
      view(
        {
          others: [enemy([{ x: 15, y: 15 }, { x: 14, y: 15 }])],
          food: [{ x: 10, y: 10, type: "chili", score: 50 }, { x: 15, y: 5, type: "chili", score: 50 }]
        },
        { body: Array.from({ length: 300 }, (_, i) => ({ x: i % 20, y: 6 + Math.floor(i / 20) })) }
      ),
      view({ grid: { width: 5, height: 6 } }, { head: { x: 1, y: 1 } })
    ];
    views.forEach((v) => {
      const out = encodeV2(v);
      assert.strictEqual(out.length, 328);
      out.forEach((value, i) => assert.ok(Number.isFinite(value), `value ${i} is ${value}`));
    });
  });

  it("writes into the array it's given, and gives the same numbers for the same view", () => {
    const v = view({ food: [{ x: 12, y: 9, type: "banana", score: 25 }] }, { body: [{ x: 9, y: 10 }] });
    const out = new Array<number>(328).fill(9);
    assert.strictEqual(encodeV2(v, out), out);
    assert.deepStrictEqual(out, encodeV2(v));
  });

  it("is empty for a lone snake with no body or food", () => {
    assert.deepStrictEqual(lit(encodeV2(view())), {});
  });

  describe("channels", () => {
    it("self: its own body, head excluded", () => {
      const out = encodeV2(view({}, { body: [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 11 }] }));
      assert.deepStrictEqual(lit(out), { [at(SELF, -1, 0)]: 1, [at(SELF, -2, 0)]: 1, [at(SELF, -2, 1)]: 1 });
      assert.strictEqual(out[at(SELF, 0, 0)], 0);
    });

    it("enemies: live enemies' heads and bodies", () => {
      const out = encodeV2(view({ others: [enemy([{ x: 12, y: 8 }, { x: 13, y: 8 }])] }));
      assert.deepStrictEqual(lit(out), { [at(ENEMIES, 2, -2)]: 1, [at(ENEMIES, 3, -2)]: 1, [at(HEADS, 2, -2)]: 1 });
    });

    it("enemy heads: the heads of live enemies only, not the bodies", () => {
      const out = encodeV2(view({ others: [enemy([{ x: 12, y: 12 }, { x: 11, y: 12 }]), enemy([{ x: 8, y: 9 }])] }));
      const heads = Object.keys(lit(out)).map(Number).filter((i) => i >= HEADS);
      assert.deepStrictEqual(heads, [at(HEADS, -2, -1), at(HEADS, 2, 2)].sort((a, b) => a - b));
    });

    it("food: each pellet's score over the largest, whatever the type", () => {
      const out = encodeV2(view({
        food: [
          { x: 11, y: 10, type: "chili", score: 50 },
          { x: 10, y: 12, type: "redApple", score: 10 },
          { x: 7, y: 10, type: "banana", score: 25 }
        ]
      }));
      assert.deepStrictEqual(lit(out), { [at(FOOD, 1, 0)]: 1, [at(FOOD, 0, 2)]: 0.2, [at(FOOD, -3, 0)]: 0.5 });
    });

    it("has its cells in order, channel by channel and row by row from the window's front-left", () => {
      const corner = (x: number, y: number) => encodeV2(view({ food: [{ x, y, type: "chili", score: 50 }] }));
      // Heading right: front is +x and right is +y.
      assert.strictEqual(corner(14, 6)[FOOD], 1);
      assert.strictEqual(corner(14, 14)[FOOD + 8], 1);
      assert.strictEqual(corner(6, 6)[FOOD + 72], 1);
      assert.strictEqual(corner(6, 14)[FOOD + 80], 1);
      assert.strictEqual(corner(10, 10)[FOOD + 40], 1);
    });

    it("sees nothing beyond the window", () => {
      const out = encodeV2(view({ food: [{ x: 15, y: 10, type: "chili", score: 50 }, { x: 10, y: 5, type: "chili", score: 50 }] }));
      assert.deepStrictEqual(lit(out), {});
    });

    it("counts a dead snake as free: it's on no channel", () => {
      const out = encodeV2(view({ others: [enemy([{ x: 12, y: 10 }, { x: 13, y: 10 }], true)] }));
      assert.deepStrictEqual(lit(out), {});
    });
  });

  describe("the window turned", () => {
    Object.entries(headings).forEach(([name, heading]) => {
      it(`is in the snake's own frame, heading ${name}`, () => {
        const out = encodeV2(view(
          {
            others: [enemy([rel(heading, 3, -2), rel(heading, 3, -3)])],
            food: [{ ...rel(heading, 1, 4), type: "chili", score: 50 }]
          },
          { movedDirection: heading, body: [rel(heading, -1, 0), rel(heading, -2, 1)] }
        ));
        assert.deepStrictEqual(lit(out), {
          [at(SELF, -1, 0)]: 1,
          [at(SELF, -2, 1)]: 1,
          [at(ENEMIES, 3, -2)]: 1,
          [at(ENEMIES, 3, -3)]: 1,
          [at(FOOD, 1, 4)]: 1,
          [at(HEADS, 3, -2)]: 1
        });
      });
    });

    it("heads right when it hasn't moved", () => {
      const still = encodeV2(view({ food: [{ x: 12, y: 10, type: "chili", score: 50 }] }, { movedDirection: { x: 0, y: 0 } }));
      assert.deepStrictEqual(still, encodeV2(view({ food: [{ x: 12, y: 10, type: "chili", score: 50 }] })));
      assert.strictEqual(still[at(FOOD, 2, 0)], 1);
    });
  });

  describe("wrapping", () => {
    it("wraps the window round every edge of the board", () => {
      Object.values(headings).forEach((heading) => {
        [{ x: 0, y: 0 }, { x: 19, y: 19 }, { x: 0, y: 19 }, { x: 19, y: 0 }].forEach((head) => {
          const out = encodeV2(view(
            { others: [enemy([rel(heading, 4, 4, head)])], food: [{ ...rel(heading, -4, -4, head), type: "chili", score: 50 }] },
            { head, movedDirection: heading, body: [rel(heading, -1, 0, head)] }
          ));
          assert.deepStrictEqual(lit(out), {
            [at(SELF, -1, 0)]: 1,
            [at(ENEMIES, 4, 4)]: 1,
            [at(HEADS, 4, 4)]: 1,
            [at(FOOD, -4, -4)]: 1
          });
        });
      });
    });
  });

  describe("the mode inputs", () => {
    it("in a timed round: 0, the time left, 0, 1", () => {
      assert.deepStrictEqual(encodeV2(view({ ticksLeft: 25 }, { hunger: 500, score: 100 })).slice(MODE), [0, 0.25, 0, 1]);
      assert.deepStrictEqual(encodeV2(view({ ticksLeft: 0, tickLimit: 0 })).slice(MODE), [0, 1, 0, 1]);
    });

    it("in an endless round: 1, no time, the hunger, and the drains left", () => {
      const endless = (self: Partial<BotView["self"]>) => encodeV2(view({ mode: "endless", ticksLeft: 0, tickLimit: 0 }, self)).slice(MODE);
      const [mode, time, hunger, drains] = endless({ hunger: 0, score: 0 });
      assert.deepStrictEqual([mode, time, hunger, drains], [1, 1, 0, 0]);
      const [, , fed, plenty] = endless({ hunger: 1e9, score: 1e9 });
      assert.deepStrictEqual([fed, plenty], [1, 1]);
      const [, , half, some] = endless({ hunger: 1, score: 1 });
      assert.ok(half > 0 && half < 1 && some >= 0 && some < 1);
    });
  });

  describe("the reaction delay", () => {
    it("encodes where the enemy was, when the view is out of date", () => {
      type PlainGame = GameShape<Cell> & { players: PlayerShape<Cell>[]; foodCoordinates: FoodPlacement[] };
      const game: PlainGame = {
        players: ["me", "them"].map((id) => ({
          id,
          snake: { x: 0, y: 0, direction: { x: 0, y: 0 }, movedDirection: { x: 0, y: 0 }, tail: [] as Cell[], tailCursor: 0, size: 0, score: 0, hunger: 0, isDead: true }
        })),
        foodCoordinates: [],
        aliveCount: 0
      };
      dealRound(game, 0, newPlainCell);
      beginPlay(game);
      const [me, them] = game.players;
      me.snake.x = 10; me.snake.y = 10;
      me.snake.movedDirection = { x: 1, y: 0 };
      const snapshots = new Snapshots(1);
      // The enemy is 3 ahead, then moves 1 to the right of that.
      [{ x: 13, y: 10 }, { x: 13, y: 11 }].forEach((cell) => {
        them.snake.x = cell.x; them.snake.y = cell.y;
        snapshots.record(game);
      });

      const out = encodeV2(viewFor(game, me, snapshots));
      assert.strictEqual(out[at(HEADS, 3, 0)], 1, "not where it was a tick ago");
      assert.strictEqual(out[at(HEADS, 3, 1)], 0, "where it is now");
    });
  });
});
