import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { cellKey } from "../src/gameConfig";
import { joinOptions, wait, waitForState } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("four-player rounds", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A room with four players in the lobby and the simulation loop stopped. */
  async function fullRoom() {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const clients = [];
    for (let i = 0; i < 4; i++) {
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
    return { room, state: room.state as GameState, clients, gameOvers, start };
  }

  it("accepts four players", async () => {
    const { state } = await fullRoom();
    assert.strictEqual(state.players.length, 4);
  });

  it("routes a fifth player to a new room", async () => {
    const { room } = await fullRoom();
    const fifth = await colyseus.sdk.joinOrCreate("snake", joinOptions("p4", "#0000ff"));
    assert.notStrictEqual(fifth.roomId, room.roomId);
  });

  it("shows all four players and their scores to a client", async () => {
    const { room, state, clients, start } = await fullRoom();
    await start();
    state.players[3].snake.score = 30;
    room.broadcastPatch(); // the loop that normally flushes is stopped

    await waitForState(
      clients[0],
      () => clients[0].state.players.length === 4 && clients[0].state.players[3].snake.score === 30,
      "all four players and their scores"
    );
  });

  it("names the last snake winner, ranking all four players", async () => {
    const { room, state, gameOvers, start } = await fullRoom();
    await start();
    state.players.forEach((p, i) => (p.snake.score = i * 10));

    const [a, b, c, d] = state.players.map((p) => p.snake);
    const place = (s: any, x: number, y: number, dx: number, tail: any[] = []) => {
      s.x = x; s.y = y; s.direction.x = dx; s.direction.y = 0;
      s.movedDirection = { x: dx, y: 0 };
      s.setTail(tail);
    };
    place(a, 5, 5, 1);
    place(b, 7, 5, -1);
    place(c, 10, 10, 1);
    place(d, 20, 20, 1, [{ x: 11, y: 10 }, { x: 12, y: 10 }]);
    room.update();

    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].winnerId, state.players[3].id);
    assert.deepStrictEqual(
      gameOvers[0].rankings.map((r: any) => r.score),
      [30, 20, 10, 0]
    );
  });

  it("spawns four distinct snakes every round, including after someone leaves", async () => {
    const { state, clients, start } = await fullRoom();

    for (let round = 0; round < 6; round++) {
      await start();
      const cells = new Set(state.players.map((p) => cellKey(p.snake.x, p.snake.y)));
      assert.strictEqual(cells.size, state.players.length, `round ${round + 1} shared a cell`);
      state.hasGameStarted = false;
    }

    await start();
    await clients[3].leave();
    await until(() => state.players.length === 3);
    assert.strictEqual(state.aliveCount, 3);
  });

  it("ends the round when a leaver leaves one snake standing, then plays again", async () => {
    const { room, state, clients, gameOvers, start } = await fullRoom();
    await start();
    state.players[1].snake.isDead = true;
    state.players[2].snake.isDead = true;
    state.aliveCount = 2;

    await clients[3].leave();
    await until(() => state.players.length === 3);

    assert.strictEqual(gameOvers.length, 1, "leaving did not end the round");
    assert.strictEqual(gameOvers[0].winnerId, state.players[0].id);
    assert.strictEqual(gameOvers[0].rankings.length, 3);
    assert.strictEqual(state.hasGameStarted, false);

    await start();
    assert.strictEqual(state.hasGameStarted, true);
    assert.strictEqual(state.aliveCount, 3);
    assert.strictEqual(new Set(state.players.map((p) => cellKey(p.snake.x, p.snake.y))).size, 3);
  });

  it("sits a mid-round joiner out, then plays them next round", async () => {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const first = await colyseus.connectTo(room, joinOptions("p0", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("p1", "#00ff00"));
    room.setSimulationInterval(null);
    const state: GameState = room.state;

    first.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(state.aliveCount, 2);

    await colyseus.connectTo(room, joinOptions("late", "#0000ff"));
    const late = state.players[2].snake;
    assert.ok(late.isDead, "the late joiner entered the round alive");
    assert.strictEqual(state.aliveCount, 2);

    state.hasGameStarted = false;
    first.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.ok(!late.isDead);
    assert.strictEqual(state.aliveCount, 3);
  });
});
