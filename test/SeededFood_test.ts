import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { joinOptions } from "./helpers";

import { Rng, cellKey, mulberry32 } from "../src/engine";
import { generateFoodCoordinates, pickFreeCell, randomFoodType } from "../src/engine/food";

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

describe("room seed", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  const createRoom = async (seed?: unknown) => {
    const client = await colyseus.sdk.create("snake", { ...(seed === undefined ? {} : { seed }), ...joinOptions("a", "#ff0000") });
    const state = colyseus.getRoomById(client.roomId).state as any;
    const food = state.foodCoordinates.map((f: any) => ({ x: f.x, y: f.y, index: f.index, type: f.type }));
    return { seed: state.seed, food };
  };

  it("keeps the seed it was created with and replays the same food from it", async () => {
    const first = await createRoom();
    assert.ok(Number.isInteger(first.seed) && first.seed >= 0 && first.seed < 2 ** 32, `seed ${first.seed}`);

    const replay = await createRoom(first.seed);
    assert.strictEqual(replay.seed, first.seed);
    assert.deepStrictEqual(replay.food, first.food);
  });

  it("ignores an invalid seed", async () => {
    for (const bad of ["1", -1, 1.5, 2 ** 32, NaN, null]) {
      const { seed } = await createRoom(bad);
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32, `seed ${seed} from ${bad}`);
    }
  });
});
