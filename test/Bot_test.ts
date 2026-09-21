import assert from "assert";

import { BotView, decide, rookieBotProfile } from "../src/bot";

const view = (over: Partial<BotView> = {}): BotView => ({
  grid: { width: 20, height: 20 },
  self: { head: { x: 5, y: 5 }, body: [], movedDirection: { x: 1, y: 0 } },
  others: [],
  food: [],
  ...over
});

describe("bot policy", () => {
  it("goes straight when the next cell is free", () => {
    assert.strictEqual(decide(view(), rookieBotProfile), "r");
  });

  it("wraps round the board edge when checking the next cell", () => {
    const v = view({
      self: { head: { x: 19, y: 5 }, body: [], movedDirection: { x: 1, y: 0 } },
      others: [{ head: { x: 10, y: 10 }, body: [{ x: 0, y: 5 }], isDead: false }]
    });
    assert.notStrictEqual(decide(v, rookieBotProfile), "r");
  });

  it("turns, never reversing, when its own body is ahead", () => {
    const v = view({
      self: { head: { x: 5, y: 5 }, body: [{ x: 6, y: 5 }, { x: 5, y: 6 }], movedDirection: { x: 1, y: 0 } }
    });
    assert.strictEqual(decide(v, rookieBotProfile), "u");
  });

  it("passes through a dead snake", () => {
    const v = view({ others: [{ head: { x: 6, y: 5 }, body: [], isDead: true }] });
    assert.strictEqual(decide(v, rookieBotProfile), "r");
  });

  it("keeps straight when every turn is fatal", () => {
    const v = view({
      self: { head: { x: 5, y: 5 }, body: [{ x: 6, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 6 }], movedDirection: { x: 1, y: 0 } }
    });
    assert.strictEqual(decide(v, rookieBotProfile), "r");
  });

  describe("rookie hunting", () => {
    const food = (x: number, y: number, score = 10) => ({ x, y, type: "redApple", score });

    it("steps toward the best score-per-distance pellet", () => {
      // 10 at distance 2 (5/step) loses to 50 at distance 4 (12.5/step), which is above.
      const v = view({ food: [food(7, 5, 10), food(5, 1, 50)] });
      assert.strictEqual(decide(v, rookieBotProfile), "u");
    });

    it("ignores pellets beyond its vision radius", () => {
      const v = view({ food: [food(5, 14, 50)] });
      assert.strictEqual(decide(v, rookieBotProfile), "r");
      assert.strictEqual(decide(v, { ...rookieBotProfile, visionRadius: 10 }), "d");
    });

    it("paths across the wrap edge when that is shorter", () => {
      const v = view({
        self: { head: { x: 1, y: 5 }, body: [], movedDirection: { x: 0, y: 1 } },
        food: [food(18, 5)]
      });
      assert.strictEqual(decide(v, rookieBotProfile), "l");
    });

    it("never steps onto a live body, even toward a pellet", () => {
      const v = view({
        food: [food(8, 5)],
        others: [{ head: { x: 6, y: 9 }, body: [{ x: 6, y: 5 }], isDead: false }]
      });
      assert.notStrictEqual(decide(v, rookieBotProfile), "r");
    });

    it("never steps next to a live enemy head", () => {
      // Pellet ahead, but the enemy head at (7,5) makes (6,5) a head-on risk.
      const v = view({
        food: [food(6, 5, 50)],
        others: [{ head: { x: 7, y: 5 }, body: [], isDead: false }]
      });
      assert.notStrictEqual(decide(v, rookieBotProfile), "r");
    });

    it("goes straight when nothing is in view", () => {
      assert.strictEqual(decide(view(), rookieBotProfile), "r");
    });

    it("picks the roomier safe turn when blocked ahead", () => {
      // Up is next to a wall of body, down is open.
      const v = view({
        self: { head: { x: 5, y: 5 }, body: [{ x: 4, y: 5 }], movedDirection: { x: 1, y: 0 } },
        others: [{
          head: { x: 15, y: 15 },
          body: [{ x: 6, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 3 }, { x: 6, y: 4 }],
          isDead: false
        }]
      });
      assert.strictEqual(decide(v, rookieBotProfile), "d");
    });

    it("walks into a C-shaped dead end for a pellet", () => {
      const wall = [{ x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 5 }, { x: 8, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 6 }];
      const v = view({
        self: { head: { x: 5, y: 5 }, body: [{ x: 4, y: 5 }, ...wall], movedDirection: { x: 1, y: 0 } },
        food: [food(7, 5, 50)]
      });
      assert.strictEqual(decide(v, rookieBotProfile), "r");
    });

    it("is deterministic for a given view", () => {
      const v = view({ food: [food(7, 7), food(3, 3), food(5, 9)] });
      const first = decide(v, rookieBotProfile);
      for (let i = 0; i < 20; i++) assert.strictEqual(decide(v, rookieBotProfile), first);
    });
  });
});
