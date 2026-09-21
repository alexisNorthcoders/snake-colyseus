import assert from "assert";

import { BotView, decide, defaultBotProfile } from "../src/bot";

const view = (over: Partial<BotView> = {}): BotView => ({
  grid: { width: 20, height: 20 },
  self: { head: { x: 5, y: 5 }, body: [], movedDirection: { x: 1, y: 0 } },
  others: [],
  food: [],
  ...over
});

describe("bot policy", () => {
  it("goes straight when the next cell is free", () => {
    assert.strictEqual(decide(view(), defaultBotProfile), "r");
  });

  it("wraps round the board edge when checking the next cell", () => {
    const v = view({
      self: { head: { x: 19, y: 5 }, body: [], movedDirection: { x: 1, y: 0 } },
      others: [{ head: { x: 10, y: 10 }, body: [{ x: 0, y: 5 }], isDead: false }]
    });
    assert.notStrictEqual(decide(v, defaultBotProfile), "r");
  });

  it("turns, never reversing, when its own body is ahead", () => {
    const v = view({
      self: { head: { x: 5, y: 5 }, body: [{ x: 6, y: 5 }, { x: 5, y: 6 }], movedDirection: { x: 1, y: 0 } }
    });
    assert.strictEqual(decide(v, defaultBotProfile), "u");
  });

  it("passes through a dead snake", () => {
    const v = view({ others: [{ head: { x: 6, y: 5 }, body: [], isDead: true }] });
    assert.strictEqual(decide(v, defaultBotProfile), "r");
  });

  it("keeps straight when every turn is fatal", () => {
    const v = view({
      self: { head: { x: 5, y: 5 }, body: [{ x: 6, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 6 }], movedDirection: { x: 1, y: 0 } }
    });
    assert.strictEqual(decide(v, defaultBotProfile), "r");
  });
});
