import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState, Snake } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

const place = (s: Snake, x: number, y: number, dx: number, tail: { x: number; y: number }[] = []) => {
  s.x = x; s.y = y; s.direction.x = dx; s.direction.y = 0;
  s.movedDirection = { x: dx, y: 0 };
  s.setTail(tail);
};

describe("why the round ended, in game over", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A timed round with `n` players, started, with no food and the simulation loop stopped. */
  async function playing(n: number) {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const clients = [];
    for (let i = 0; i < n; i++) {
      clients.push(await colyseus.connectTo(room, joinOptions(`p${i}`, "#ff0000")));
    }
    room.setSimulationInterval(null);

    const gameOvers: any[] = [];
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (type: string, message: any, options?: any) => {
      if (type === SnakeRoom.messageTypes.GAME_OVER) gameOvers.push(message);
      return broadcast(type, message, options);
    };

    clients[0].send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    const state = room.state as GameState;
    state.foodCoordinates.clear();
    return { room, state, clients, gameOvers };
  }

  it("is last-standing, with the survivor as winner, when one snake is left", async () => {
    const { room, state, gameOvers } = await playing(2);
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 20, 20, 1, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].reason, "last-standing");
    assert.strictEqual(gameOvers[0].winnerId, b.id);
  });

  it("is last-standing, with no winner, when every snake dies on the same tick", async () => {
    const { room, state, gameOvers } = await playing(2);
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 7, 5, -1);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].reason, "last-standing");
    assert.ok(!("winnerId" in gameOvers[0]), `winnerId sent: ${JSON.stringify(gameOvers[0])}`);
  });

  it("is last-standing when a leaver leaves one snake alive", async () => {
    const { state, clients, gameOvers } = await playing(2);
    const [a] = state.players;

    await clients[1].leave();
    await until(() => gameOvers.length === 1);

    assert.strictEqual(gameOvers[0].reason, "last-standing");
    assert.strictEqual(gameOvers[0].winnerId, a.id);
  });

  it("is time-up, with the winner, when a timed round runs out", async () => {
    const { room, state, gameOvers } = await playing(2);
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 5, 10, 1);
    a.snake.score = 10;
    b.snake.score = 30;
    state.ticksLeft = 1;
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].reason, "time-up");
    assert.strictEqual(gameOvers[0].winnerId, b.id);
  });

  it("is time-up, with no winner, for a draw on time", async () => {
    const { room, state, gameOvers } = await playing(2);
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 5, 10, 1);
    a.snake.score = 20;
    b.snake.score = 20;
    state.ticksLeft = 1;
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].reason, "time-up");
    assert.ok(!("winnerId" in gameOvers[0]), `winnerId sent: ${JSON.stringify(gameOvers[0])}`);
  });

  it("is last-standing when the final tick both runs out the time and leaves one snake alive", async () => {
    const { room, state, gameOvers } = await playing(2);
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 20, 20, 1, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    state.ticksLeft = 1;
    room.update();

    assert.strictEqual(state.ticksLeft, 0, "the tick didn't run out the time");
    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].reason, "last-standing");
    assert.strictEqual(gameOvers[0].winnerId, b.id);
  });
});
