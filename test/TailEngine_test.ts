import assert from "assert";

import { Snake } from "../src/rooms/schema/SnakeState";
import { Cell } from "../src/gameConfig";
import { advanceTail, growTail, newPlainCell, setTail, tailCells } from "../src/engine/tail";

type Step = { advance: Cell } | "grow";

/** A plain, schema-free snake, the shape a headless game runs on. */
type PlainSnake = Cell & { tail: Cell[]; tailCursor: number };
const plainSnake = (x: number, y: number): PlainSnake => ({ x, y, tail: [], tailCursor: 0 });

/** Moves the head one cell right, advancing the tail behind it. */
const step = (x: number): Step => ({ advance: { x, y: 5 } });

/** Mixes advances and growths so the cursor sits mid-ring when growing. */
const SEQUENCE: Step[] = [
  "grow", step(4), step(5), "grow", step(6), "grow", "grow",
  step(7), step(8), step(9), "grow", step(10), step(11), "grow", step(12),
];

function runBoth(start: Cell[], sequence: Step[]) {
  const plain = plainSnake(3, 5);
  const schema = new Snake();
  schema.x = 3;
  schema.y = 5;

  setTail(plain, start, newPlainCell);
  schema.setTail(start);

  const check = (label: string) => {
    assert.deepStrictEqual(tailCells(plain), tailCells(schema), `tailCells diverged ${label}`);
    assert.strictEqual(plain.tailCursor, schema.tailCursor, `tailCursor diverged ${label}`);
  };
  check("after setTail");

  sequence.forEach((s, i) => {
    if (s === "grow") {
      growTail(plain, newPlainCell);
      schema.growTail();
    } else {
      advanceTail(plain, { x: plain.x, y: plain.y });
      [plain.x, plain.y] = [s.advance.x, s.advance.y];
      schema.advanceTail({ x: schema.x, y: schema.y });
      [schema.x, schema.y] = [s.advance.x, s.advance.y];
    }
    check(`after step ${i}`);
  });

  return { plain, schema };
}

describe("tail engine", () => {
  it("matches the schema snake step for step, starting with no tail", () => {
    const { plain } = runBoth([], SEQUENCE);
    assert.strictEqual(plain.tail.length, SEQUENCE.filter((s) => s === "grow").length);
  });

  it("matches the schema snake step for step, starting with a tail", () => {
    runBoth([{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 0, y: 5 }], SEQUENCE);
  });

  it("matches the schema snake when a tail is replaced mid-ring", () => {
    const { plain, schema } = runBoth([{ x: 2, y: 5 }, { x: 1, y: 5 }], [step(4), step(5)]);
    const cells = [{ x: 9, y: 9 }];

    setTail(plain, cells, newPlainCell);
    schema.setTail(cells);

    assert.deepStrictEqual(tailCells(plain), cells);
    assert.deepStrictEqual(tailCells(schema), cells);
    assert.strictEqual(plain.tailCursor, schema.tailCursor);
  });

  it("rewrites existing cells in place rather than replacing them", () => {
    const plain = plainSnake(3, 5);
    setTail(plain, [{ x: 2, y: 5 }, { x: 1, y: 5 }], newPlainCell);
    const [first, second] = plain.tail;

    advanceTail(plain, { x: 3, y: 5 });
    growTail(plain, newPlainCell);

    assert.strictEqual(plain.tail[0], first);
    assert.strictEqual(plain.tail[1], second);
  });
});
