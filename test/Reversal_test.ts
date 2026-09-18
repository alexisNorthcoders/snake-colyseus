import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { Coordinates, GameState, Snake } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { gameConfig } from "../src/gameConfig";
import { joinOptions } from "./helpers";

const BOTTOM_ROW = gameConfig.scaleFactor - 1;

describe("reverse turns", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  function place(
    snake: Snake,
    head: [number, number],
    direction: [number, number],
    tail: Array<[number, number]>
  ) {
    [snake.x, snake.y] = head;
    [snake.direction.x, snake.direction.y] = direction;
    snake.tail.splice(0, snake.tail.length);
    tail.forEach(([x, y]) => snake.tail.push(new Coordinates(x, y)));
  }

  /**
   * A started two-player round with the simulation loop stopped. The first
   * player's snake has a two-segment body along row 10 and has already been
   * simulated one tick heading right, so it sits at (10,10) with its body on
   * (9,10) and (8,10). The other snake and the pellets are out of the way.
   */
  async function rightwardSnake() {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const client = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("p2", "#00ff00"));
    client.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    room.setSimulationInterval(null);

    const state: GameState = room.state;
    const [snake, other] = state.players.map((player) => player.snake);
    place(snake, [9, 10], [1, 0], [[8, 10], [7, 10]]);
    place(other, [2, 2], [0, 1], []);
    state.foodCoordinates.forEach((food, i) => {
      food.x = i;
      food.y = BOTTOM_ROW;
    });

    room.update();

    const move = async (key: string) => {
      client.send(SnakeRoom.messageTypes.MOVE, { key });
      await room.waitForMessage(SnakeRoom.messageTypes.MOVE);
    };

    return { room, snake, move };
  }

  it("ignores a reversal and keeps the snake alive", async () => {
    const { room, snake, move } = await rightwardSnake();

    await move("l");

    assert.deepStrictEqual(
      [snake.direction.x, snake.direction.y],
      [1, 0],
      "the reversal changed the snake's direction"
    );

    room.update();

    assert.ok(!snake.isDead, "the snake died reversing into its own body");
    assert.deepStrictEqual([snake.x, snake.y], [11, 10]);
  });

  it("still takes perpendicular turns", async () => {
    const { room, snake, move } = await rightwardSnake();

    await move("u");

    assert.deepStrictEqual([snake.direction.x, snake.direction.y], [0, -1]);

    room.update();

    assert.ok(!snake.isDead);
    assert.deepStrictEqual([snake.x, snake.y], [10, 9]);
  });

  it("ignores a key that is not a direction", async () => {
    const { snake, move } = await rightwardSnake();

    await move("toString");

    assert.deepStrictEqual([snake.direction.x, snake.direction.y], [1, 0]);
  });

  it("does not let two turns inside one tick add up to a reversal", async () => {
    const { room, snake, move } = await rightwardSnake();

    await move("u");
    await move("l");

    assert.deepStrictEqual(
      [snake.direction.x, snake.direction.y],
      [0, -1],
      "the second turn was checked against the first key, not the simulated direction"
    );

    room.update();

    assert.ok(!snake.isDead, "the snake died from a reversal split across one tick");
    assert.deepStrictEqual([snake.x, snake.y], [10, 9]);
  });
});
