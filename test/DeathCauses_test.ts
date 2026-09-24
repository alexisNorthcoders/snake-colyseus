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

describe("death causes in the rankings", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A room with `n` players in the lobby and the simulation loop stopped. */
  async function roomWith(n: number) {
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

    const start = async () => {
      clients[0].send(SnakeRoom.messageTypes.START_GAME);
      await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    };
    const entry = (round: number, id: string) => gameOvers[round].rankings.find((r: any) => r.id === id);
    return { room, state: room.state as GameState, clients, gameOvers, start, entry };
  }

  it("names the body a loser ran into, and gives the winner no cause", async () => {
    const { room, state, gameOvers, start, entry } = await roomWith(2);
    await start();
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 20, 20, 1, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.deepStrictEqual(entry(0, a.id), { id: a.id, name: a.name, score: 0, cause: "body", by: b.id });
    assert.deepStrictEqual(entry(0, b.id), { id: b.id, name: b.name, score: 0 });
  });

  it("marks both snakes in a head-on, each by the other", async () => {
    const { room, state, gameOvers, start, entry } = await roomWith(2);
    await start();
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 7, 5, -1);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].winnerId, undefined);
    assert.strictEqual(entry(0, a.id).cause, "head-on");
    assert.strictEqual(entry(0, a.id).by, b.id);
    assert.strictEqual(entry(0, b.id).cause, "head-on");
    assert.strictEqual(entry(0, b.id).by, a.id);
  });

  it("gives a mid-round leaver no cause", async () => {
    const { room, state, clients, gameOvers, start, entry } = await roomWith(3);
    await start();
    const [a, b, c] = state.players;

    await clients[2].leave();
    await until(() => state.players.length === 2);

    place(a.snake, 5, 5, 1);
    place(b.snake, 20, 20, 1, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].rankings.length, 3);
    assert.strictEqual(entry(0, c.id).cause, undefined);
    assert.strictEqual(entry(0, c.id).by, undefined);
    assert.strictEqual(entry(0, a.id).cause, "body");
  });

  it("forgets the last round's causes when the next round starts", async () => {
    const { room, state, gameOvers, start, entry } = await roomWith(2);
    await start();
    const [a, b] = state.players;
    place(a.snake, 5, 5, 1);
    place(b.snake, 20, 20, 1, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    room.update();
    assert.strictEqual(entry(0, a.id).cause, "body");

    state.phase = "lobby";
    await start();
    // This time b runs into itself, and a wins.
    place(a.snake, 20, 20, 1);
    place(b.snake, 5, 5, 1, [{ x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }]);
    room.update();

    assert.strictEqual(gameOvers.length, 2);
    assert.strictEqual(gameOvers[1].winnerId, a.id);
    assert.deepStrictEqual(entry(1, a.id), { id: a.id, name: a.name, score: 0 });
    assert.deepStrictEqual(entry(1, b.id), { id: b.id, name: b.name, score: 0, cause: "self" });
  });
});
