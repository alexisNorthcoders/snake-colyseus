import assert from "assert";

import { cellKey } from "../src/gameConfig";
import { generateFoodCoordinates, pickFreeCell, randomFoodType } from "../src/engine/food";
import { mulberry32, Rng } from "../src/engine/rng";

describe("mulberry32", () => {
  it("draws the same sequence from the same seed, in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);

    for (let i = 0; i < 1000; i++) {
      const value = a();
      assert.strictEqual(value, b());
      assert.ok(value >= 0 && value < 1, `drew ${value}`);
    }
  });

  it("draws a different sequence from a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);

    const draws = (rng: Rng) => Array.from({ length: 10 }, rng);
    assert.notDeepStrictEqual(draws(a), draws(b));
  });
});

describe("seeded food", () => {
  it("lays out identical food from the same seed", () => {
    assert.deepStrictEqual(
      generateFoodCoordinates(mulberry32(1234)),
      generateFoodCoordinates(mulberry32(1234))
    );
  });

  it("lays out different food from different seeds", () => {
    assert.notDeepStrictEqual(
      generateFoodCoordinates(mulberry32(1234)),
      generateFoodCoordinates(mulberry32(5678))
    );
  });

  it("respawns onto the same cell and fruit from the same seed and board", () => {
    // A board with its top half taken, so both probing and the crowded-board
    // fallback are in play across seeds.
    const isOccupied = (x: number, y: number) => y < 10 || cellKey(x, y) === "3,12";

    const respawn = (seed: number) => {
      const rng = mulberry32(seed);
      const cell = pickFreeCell(isOccupied, rng);
      return { ...cell, type: randomFoodType(rng) };
    };

    for (let seed = 0; seed < 50; seed++) {
      const first = respawn(seed);
      assert.ok(!isOccupied(first.x, first.y), `seed ${seed} landed on a taken cell`);
      for (let again = 0; again < 5; again++) {
        assert.deepStrictEqual(respawn(seed), first);
      }
    }
  });
});
