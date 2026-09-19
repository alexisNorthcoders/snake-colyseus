import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState, Snake, tailCells } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { Cell, gameConfig } from "../src/gameConfig";
import { joinOptions, waitForState } from "./helpers";

const SIZE = gameConfig.scaleFactor;
const BOTTOM_ROW = SIZE - 1;

/**
 * The tail as a plain newest-first list, advanced the way the old shift did
 * it: a deliberately naive model of what the ring must look like from outside.
 */
class ReferenceSnake {
  tail: Cell[] = [];

  move(vacated: Cell) {
    if (this.tail.length === 0) return;
    this.tail.pop();
    this.tail.unshift(vacated);
  }

  grow() {
    this.tail.push({ ...this.tail[this.tail.length - 1] });
  }
}

function place(snake: Snake, head: [number, number], direction: [number, number], tail: Cell[]) {
  [snake.x, snake.y] = head;
  [snake.direction.x, snake.direction.y] = direction;
  snake.setTail(tail);
}

describe("tail ring", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A started round of `players` snakes with the simulation loop stopped. */
  async function frozenRoom(players = 2) {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const clients = [];
    for (let i = 0; i < players; i++) {
      clients.push(await colyseus.connectTo(room, joinOptions(`p${i}`, "#ff0000")));
    }
    clients[0].send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    room.setSimulationInterval(null);

    // Pellets parked along the bottom row, off every snake's path.
    const state: GameState = room.state;
    state.foodCoordinates.forEach((food, i) => {
      food.x = i;
      food.y = BOTTOM_ROW;
    });

    return { room, clients, state };
  }

  /** A straight body trailing left from (x, y), newest segment first. */
  const bodyBehind = (x: number, y: number, length: number): Cell[] =>
    Array.from({ length }, (_, i) => ({ x: (x - 1 - i + SIZE) % SIZE, y }));

  /**
   * Bytes one tick of movement adds to the patch for a snake with a tail of
   * `length`, heading right along row 5.
   */
  async function patchBytes(length: number) {
    const { room, state } = await frozenRoom();
    const [snake, other] = state.players.map((player) => player.snake);
    place(other, [0, 18], [0, 0], []);

    // Only the body's size matters here, not its shape: it fills rows 7
    // onwards, clear of the head's row and of the other snake.
    const body = Array.from({ length }, (_, i) => ({ x: i % SIZE, y: 7 + Math.floor(i / SIZE) }));
    place(snake, [10, 5], [1, 0], body);

    const encoder = room._serializer.encoder;
    encoder.encode();
    encoder.discardChanges();

    room.update();

    assert.ok(!snake.isDead, "the measured snake ran into something");
    const bytes = encoder.encode().length;
    encoder.discardChanges();
    return bytes;
  }

  it("ships a patch that does not grow with tail length", async () => {
    const short = await patchBytes(2);
    const long = await patchBytes(200);

    assert.ok(
      long <= short + 4,
      `one tick cost ${short} bytes at 2 segments but ${long} at 200`
    );
  });

  it("reads back the same cells in the same order as a shifted tail", async () => {
    const { room, state } = await frozenRoom(1);
    const snake = state.players[0].snake;
    const reference = new ReferenceSnake();

    place(snake, [10, 2], [1, 0], bodyBehind(10, 2, 3));
    reference.tail = bodyBehind(10, 2, 3);

    // Pellets dropped on the path every few ticks make the snake grow at
    // every cursor position, including 0, the end and the ones in between.
    const eatOn = new Set([1, 2, 5, 9, 10, 14, 17, 18, 19, 25]);

    for (let t = 0; t < 30; t++) {
      const vacated = { x: snake.x, y: snake.y };
      const next = { x: (snake.x + 1) % SIZE, y: snake.y };
      if (eatOn.has(t)) {
        state.foodCoordinates[0].x = next.x;
        state.foodCoordinates[0].y = next.y;
      }

      room.update();

      reference.move(vacated);
      if (eatOn.has(t)) reference.grow();

      assert.ok(!snake.isDead, `the snake died on tick ${t}`);
      assert.deepStrictEqual(tailCells(snake), reference.tail, `tail diverged on tick ${t}`);
    }
  });

  it("grows by one segment at the end of the tail on eating", async () => {
    const { room, state } = await frozenRoom(1);
    const snake = state.players[0].snake;
    place(snake, [10, 2], [1, 0], bodyBehind(10, 2, 3));

    room.update();
    room.update();
    state.foodCoordinates[0].x = 13;
    state.foodCoordinates[0].y = 2;
    room.update();

    assert.deepStrictEqual(tailCells(snake), [
      { x: 12, y: 2 },
      { x: 11, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 2 }
    ]);
  });

  it("starts a fresh round with an empty tail", async () => {
    const { room, clients, state } = await frozenRoom(2);
    const snake = state.players[0].snake;
    place(snake, [10, 2], [1, 0], bodyBehind(10, 2, 4));
    room.update();

    state.phase = "lobby";
    clients[0].send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);

    assert.deepStrictEqual(tailCells(snake), []);
    assert.strictEqual(snake.tailCursor, 0);
  });

  it("lets a client joining mid-round read tails from the full snapshot", async () => {
    const { room, state } = await frozenRoom(1);
    const snake = state.players[0].snake;
    place(snake, [10, 2], [1, 0], bodyBehind(10, 2, 5));

    // Leave the cursor part-way round the ring.
    room.update();
    room.update();
    assert.notStrictEqual(snake.tailCursor, 0, "the cursor never left slot 0");

    const late = await colyseus.connectTo(room, joinOptions("late", "#00ff00"));
    await waitForState(late, () => late.state.players.length === 2, "the running round");

    // Decoded into the client's own reflected classes, not the server's Snake.
    assert.deepStrictEqual(tailCells(late.state.players[0].snake), tailCells(snake));
  });
});
