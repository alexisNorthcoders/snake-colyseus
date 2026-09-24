import assert from "assert";

import { cellKey, gameConfig } from "../src/gameConfig";
import { generateFoodCoordinates, pickFreeCell } from "../src/engine/food";

const SIZE = gameConfig.scaleFactor;

/** A `Math.random` stand-in that hands out `values` in order, then repeats. */
const scriptedRandom = (values: number[]) => {
  let next = 0;
  const random = () => {
    random.draws++;
    return values[next++ % values.length];
  };
  random.draws = 0;
  return random;
};

const allCells = () => {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) cells.push([x, y]);
  }
  return cells;
};

describe("pickFreeCell", () => {
  it("costs one pellet's worth of coordinates on an open board", () => {
    const random = scriptedRandom([0.5]);

    const cell = pickFreeCell(() => false, random);

    assert.deepStrictEqual(cell, { x: SIZE / 2, y: SIZE / 2 });
    assert.strictEqual(
      random.draws,
      2,
      `one pellet is one x and one y, got ${random.draws} draws`
    );
  });

  it("finds the last hole on a board that is otherwise full", () => {
    const hole = { x: 7, y: 13 };
    const isOccupied = (x: number, y: number) => !(x === hole.x && y === hole.y);

    // Random probing alone would keep missing a single free cell in 400, so
    // this is the case that has to fall back to looking at the board.
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.deepStrictEqual(pickFreeCell(isOccupied, Math.random), hole);
    }
  });

  it("reports that there is nowhere to put a pellet on a full board", () => {
    assert.strictEqual(pickFreeCell(() => true, Math.random), null);
  });

  it("never returns an occupied cell", () => {
    // Half the board taken, at random, a hundred times over.
    for (let attempt = 0; attempt < 100; attempt++) {
      const taken = new Set(
        allCells()
          .filter(() => Math.random() < 0.5)
          .map(([x, y]) => cellKey(x, y))
      );

      const cell = pickFreeCell((x, y) => taken.has(cellKey(x, y)), Math.random);

      assert.ok(cell, "board was half empty but no cell was found");
      assert.ok(
        !taken.has(cellKey(cell.x, cell.y)),
        `picked occupied cell ${cellKey(cell.x, cell.y)}`
      );
    }
  });
});

describe("generateFoodCoordinates", () => {
  it("stocks the board with the configured number of pellets, one per cell", () => {
    const placements = generateFoodCoordinates(Math.random);

    assert.strictEqual(placements.length, gameConfig.foodStorage);

    const cells = new Set(placements.map((p) => cellKey(p.x, p.y)));
    assert.strictEqual(cells.size, placements.length, "two pellets share a cell");

    assert.deepStrictEqual(
      placements.map((p) => p.index),
      placements.map((_, i) => i),
      "pellets are not indexed by their slot"
    );
    placements.forEach((p) => assert.ok(p.type, "pellet has no type"));
  });
});
