import assert from "assert";
import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

import * as engine from "../src/engine";
import {
  Cell,
  Direction,
  FoodPlacement,
  GameShape,
  PlayerShape,
  beginPlay,
  dealRound,
  layFood,
  mulberry32,
  newPlainCell,
  tailCells,
  tick,
  turn
} from "../src/engine";
import { specifiers } from "./helpers";

const root = join(__dirname, "..");
const engineDir = join(root, "src/engine");

/** Whether `spec`, imported by the file at `from`, names a file inside the engine rather than the engine itself. */
const reachesIntoEngine = (from: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  const target = relative(engineDir, resolve(dirname(from), spec));
  return target !== "" && target !== "index" && !target.startsWith("..");
};

/**
 * The app's own source outside the engine: the engine's consumers. Tests
 * aren't consumers: a unit test of a private helper imports its file direct.
 */
const consumers = ["src", "loadtest"]
  .flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) => join(root, dir, file))
  )
  .filter((file) => file.endsWith(".ts") && relative(engineDir, file).startsWith(".."));

describe("engine entry point", () => {
  it("is the only way into the engine from outside it", () => {
    assert.ok(consumers.some((file) => file.endsWith("SnakeRoom.ts")), "the scan missed the room");
    consumers.forEach((file) => {
      specifiers(readFileSync(file, "utf8")).forEach((spec) =>
        assert.ok(!reachesIntoEngine(file, spec), `${relative(root, file)} imports "${spec}"`)
      );
    });
  });

  it("tells the entry point from a file inside the engine", () => {
    const room = join(root, "src/rooms/SnakeRoom.ts");
    assert.ok(!reachesIntoEngine(room, "../engine"));
    assert.ok(!reachesIntoEngine(room, "../engine/index"));
    assert.ok(reachesIntoEngine(room, "../engine/tick"));
    assert.ok(!reachesIntoEngine(room, "../gameConfig"));
    assert.ok(!reachesIntoEngine(room, "colyseus"));
  });

  it("keeps the engine's private helpers private", () => {
    ["spawnCells", "pickFreeCell", "randomFoodType", "generateFoodCoordinates", "isRoundOver"].forEach((name) =>
      assert.ok(!(name in engine), `${name} is exported`)
    );
  });
});

describe("headless round through the entry point", () => {
  type PlainGame = GameShape<Cell> & { players: PlayerShape<Cell>[]; foodCoordinates: FoodPlacement[] };

  // Three snakes; missing ticks mean nobody presses anything. The board wraps,
  // so without turns they would never meet: these send them into each other.
  const script: Partial<Record<string, Direction>>[] = [
    { a: "d", b: "u", c: "u" },
    {},
    { a: "r", b: "l" }
  ];

  const newSnake = () => ({
    x: 0, y: 0,
    direction: { x: 0, y: 0 },
    movedDirection: { x: 0, y: 0 },
    tail: [] as Cell[],
    tailCursor: 0,
    size: 0,
    score: 0,
    isDead: true
  });

  /** Plays one whole round from `seed`, returning the game after every tick and every report. */
  const playRound = (seed: number) => {
    const rng = mulberry32(seed);
    const game: PlainGame = {
      players: ["a", "b", "c"].map((id) => ({ id, snake: newSnake() })),
      foodCoordinates: [],
      aliveCount: 0
    };

    layFood(game, rng, (placement) => ({ ...placement }));
    dealRound(game, 0, newPlainCell);
    beginPlay(game);

    const states: { game: PlainGame; bodies: Cell[][]; report: engine.TickReport }[] = [];
    for (let t = 0; t < 500; t++) {
      game.players.forEach(({ id, snake }) => {
        const key = script[t]?.[id];
        if (key && !snake.isDead) turn(snake, key);
      });

      const report = tick(game, rng, newPlainCell);
      states.push({
        game: structuredClone(game),
        bodies: game.players.map(({ snake }) => tailCells(snake)),
        report
      });

      if (report.roundOver) return states;
    }
    throw new Error("the scripted round never ended");
  };

  it("plays a whole seeded round on plain objects until it is over", () => {
    const states = playRound(11);
    const last = states[states.length - 1];

    assert.ok(last.report.roundOver);
    assert.ok(last.game.aliveCount <= 1);
    assert.ok(states.some(({ report }) => report.events.some((e) => e.kind === "died")));
  });

  it("gives the same result from the same seed and the same turns", () => {
    assert.deepStrictEqual(playRound(11), playRound(11));
  });
});
