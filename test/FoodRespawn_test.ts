import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { getStateCallbacks } from "colyseus.js";

import appConfig from "../src/app.config";
import { Food, GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { cellKey } from "../src/engine";
import { gameConfig } from "../src/gameConfig";
import { joinOptions, waitForState } from "./helpers";

const SIZE = gameConfig.scaleFactor;
const BOTTOM_ROW = SIZE - 1;

describe("food respawn", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /**
   * A started round with the room's simulation loop stopped, so a test can
   * arrange the board and then step it exactly one tick at a time. Flushing is
   * the test's job too — `patchRate` is off, so nothing syncs on its own.
   */
  async function frozenRoom() {
    const room = await colyseus.createRoom<GameState>("snake", {});
    const client = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));
    client.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    room.setSimulationInterval(null);
    return { room: room as any, client };
  }

  const tick = (room: any) => {
    room.update();
    room.broadcastPatch();
  };

  /**
   * Snake at the origin facing right with pellet 0 one step ahead, so the next
   * tick eats it. The other pellets are parked along the bottom row, out of the
   * way and on known cells.
   */
  function arrangeEat(state: GameState) {
    const snake = state.players[0].snake;
    snake.x = 0;
    snake.y = 0;
    snake.direction.x = 1;
    snake.direction.y = 0;
    snake.setTail([]);

    state.foodCoordinates.forEach((food, i) => {
      if (i === 0) {
        food.x = 1;
        food.y = 0;
      } else {
        food.x = i - 1;
        food.y = BOTTOM_ROW;
      }
    });

    return snake;
  }

  /**
   * Every cell a pellet must stay off, read back out of the live state. A
   * deliberate restatement of what the room does rather than a call into it:
   * an oracle that asked the room what "occupied" means could not catch the
   * room getting it wrong.
   */
  function occupiedCells(state: GameState, ignore?: Food) {
    const occupied = new Set<string>();

    state.players.forEach((player) => {
      const snake = player.snake;
      if (!snake) return;
      occupied.add(cellKey(snake.x, snake.y));
      snake.tail.forEach((segment) => occupied.add(cellKey(segment.x, segment.y)));
    });

    state.foodCoordinates.forEach((food) => {
      if (food !== ignore) occupied.add(cellKey(food.x, food.y));
    });

    return occupied;
  }

  it("spawns the replacement on a cell nothing else occupies", async () => {
    const { room } = await frozenRoom();
    const state: GameState = room.state;
    const snake = arrangeEat(state);

    // Leave the board with a single hole in it, everything else under the
    // snake's body or another pellet: a replacement picked without looking at
    // the board lands on something occupied 199 times out of 200.
    const hole = cellKey(SIZE - 1, BOTTOM_ROW);
    const taken = occupiedCells(state);
    const body = [];
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        const cell = cellKey(x, y);
        if (cell === hole || taken.has(cell)) continue;
        body.push({ x, y });
      }
    }
    snake.setTail(body);

    tick(room);

    const replaced = state.foodCoordinates[0];
    assert.strictEqual(
      state.foodCoordinates.length,
      gameConfig.foodStorage,
      "the board no longer holds the configured number of pellets"
    );
    assert.strictEqual(replaced.index, 0, "the replacement lost the eaten pellet's slot");
    assert.ok(
      !occupiedCells(state, replaced).has(cellKey(replaced.x, replaced.y)),
      `replacement landed on occupied cell ${cellKey(replaced.x, replaced.y)}`
    );
  });

  it("keeps the board stocked with pellets that can all be eaten", async () => {
    const { room } = await frozenRoom();
    const state: GameState = room.state;
    const snake = arrangeEat(state);

    for (let eaten = 0; eaten < 50; eaten++) {
      const pellet = state.foodCoordinates[eaten % gameConfig.foodStorage];

      // Park the head one cell behind a pellet so the next tick eats it, and
      // keep the tail out of it so the snake never runs into itself.
      snake.setTail([]);
      snake.x = (pellet.x - 1 + SIZE) % SIZE;
      snake.y = pellet.y;

      tick(room);

      assert.strictEqual(state.phase, "playing", `the round ended after ${eaten} pellets`);
      assert.strictEqual(
        state.foodCoordinates.length,
        gameConfig.foodStorage,
        `the board held ${state.foodCoordinates.length} pellets after ${eaten} eaten`
      );

      // Two pellets on one cell leave a ghost: collision lookup only ever
      // finds the first entry, so the one behind it can never be eaten.
      const cells = new Set(
        state.foodCoordinates.map((food) => cellKey(food.x, food.y))
      );
      assert.strictEqual(
        cells.size,
        gameConfig.foodStorage,
        `two pellets shared a cell after ${eaten} eaten`
      );

      const snakeCells = new Set([
        cellKey(snake.x, snake.y),
        ...snake.tail.map((segment) => cellKey(segment.x, segment.y))
      ]);
      state.foodCoordinates.forEach((food) =>
        assert.ok(
          !snakeCells.has(cellKey(food.x, food.y)),
          `pellet sat under the snake at ${cellKey(food.x, food.y)} after ${eaten} eaten`
        )
      );
    }
  });

  it("costs one pellet's worth of randomness to replace a pellet", async () => {
    const { room } = await frozenRoom();
    arrangeEat(room.state);

    // The rules draw from the room's own seeded generator, never Math.random.
    const seeded = room["rng"];
    let draws = 0;
    room["rng"] = () => {
      draws++;
      return seeded();
    };
    room.update();

    // One pellet is an x, a y and a type, plus the odd retry when a guess
    // lands on something. The batch this replaced drew twenty pellets' worth,
    // around sixty, and threw nineteen of them away.
    assert.ok(
      draws > 0 && draws < 12,
      `replacing one pellet took ${draws} random draws`
    );
  });

  it("patches the eaten pellet alone, not the whole food array", async () => {
    const { room, client } = await frozenRoom();
    const state: GameState = room.state;
    const snake = arrangeEat(state);

    const $ = getStateCallbacks(client as any);
    const changedSlots = new Set<number>();
    let added = 0;
    let removed = 0;

    $(client.state as any).foodCoordinates.onAdd((food: any, slot: number) => {
      added++;
      $(food).onChange(() => changedSlots.add(slot));
    });
    $(client.state as any).foodCoordinates.onRemove(() => removed++);

    // Sync the arrangement first, so only the eating shows up in the counts.
    room.broadcastPatch();
    await waitForState(
      client,
      () => client.state.foodCoordinates[0].x === 1 && client.state.players[0].snake.x === snake.x,
      "the arranged board"
    );
    added = 0;
    removed = 0;
    changedSlots.clear();

    tick(room);
    const replaced = state.foodCoordinates[0];
    await waitForState(
      client,
      () =>
        client.state.foodCoordinates[0].x === replaced.x &&
        client.state.foodCoordinates[0].y === replaced.y,
      "the replacement pellet"
    );

    assert.deepStrictEqual(
      [...changedSlots],
      [0],
      `expected only the eaten pellet to change, got slots ${[...changedSlots].join(",")}`
    );
    assert.strictEqual(added, 0, "the replacement was appended instead of reused");
    assert.strictEqual(removed, 0, "the eaten pellet was removed instead of replaced");
  });
});
