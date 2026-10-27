import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 1000 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("exhibition room", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  async function exhibition(options: object = {}) {
    const spectator = await colyseus.sdk.create("exhibition", options);
    const room: any = colyseus.getRoomById(spectator.roomId);
    const gameOvers: any[] = [];
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (type: string, message: any, opts?: any) => {
      if (type === SnakeRoom.messageTypes.GAME_OVER) gameOvers.push(message);
      return broadcast(type, message, opts);
    };
    return { room, state: room.state as GameState, spectator, gameOvers };
  }

  it("seats two bots named after their roster entries, and no human", async () => {
    const { state } = await exhibition({ botA: "munch-max", botB: "gobble-goliath" });
    assert.deepStrictEqual(state.players.map((p) => p.name), ["Munch Max", "Gobble Goliath"]);
    assert.ok(state.players.every((p) => p.isBot));
    assert.notStrictEqual(state.players[0].id, state.players[1].id);
    assert.notStrictEqual(state.players[0].colours.head, state.players[1].colours.head);
  });

  it("falls back to the rookie for a missing or unknown id, and allows a mirror match", async () => {
    const a = await exhibition({ botB: "nobody-here" });
    assert.strictEqual(a.state.players.length, 2);
    assert.strictEqual(a.state.players[0].name, a.state.players[1].name);
    const b = await exhibition({ botA: "munch-max", botB: "munch-max" });
    assert.deepStrictEqual(b.state.players.map((p) => p.name), ["Munch Max", "Munch Max"]);
    assert.notStrictEqual(b.state.players[0].id, b.state.players[1].id);
  });

  it("starts the countdown when the creator joins, adding no player", async () => {
    const { state } = await exhibition({ botA: "dummy", botB: "rookie" });
    assert.notStrictEqual(state.phase, "lobby");
    assert.strictEqual(state.players.length, 2);
  });

  it("asks each seat's own decider every tick", async () => {
    const spectator = await colyseus.sdk.create("exhibition", { botA: "dummy", botB: "dummy" });
    const room: any = colyseus.getRoomById(spectator.roomId);
    room.setSimulationInterval(null);
    const asked: string[] = [];
    for (const [id, seat] of room.botSeats) {
      const decider = seat.decider;
      seat.decider = (view: any) => (asked.push(id), decider(view));
    }
    await until(() => room.state.phase === "playing");
    room.update();
    assert.deepStrictEqual(asked.sort(), [...room.botSeats.keys()].sort());
  });

  it("ignores Start, move, new-player and colour messages from a Spectator", async () => {
    const { room, state, spectator } = await exhibition({ botA: "dummy", botB: "dummy" });
    room.setSimulationInterval(null);
    await until(() => state.phase === "playing");
    const before = JSON.stringify(state.toJSON());
    spectator.send(SnakeRoom.messageTypes.START_GAME);
    spectator.send(SnakeRoom.messageTypes.MOVE, { key: "ArrowUp" });
    spectator.send(SnakeRoom.messageTypes.NEW_PLAYER, { player: { name: "x", colours: { head: "#000", body: "#000" } } });
    spectator.send(SnakeRoom.messageTypes.UPDATE_PLAYER, { colours: { head: "#123456" } });
    await wait(100);
    assert.strictEqual(JSON.stringify(state.toJSON()), before);
    assert.strictEqual(state.players.length, 2);
  });

  it("ignores Start in the lobby", async () => {
    const spectator = await colyseus.sdk.create("exhibition", {});
    const room: any = colyseus.getRoomById(spectator.roomId);
    assert.strictEqual(room.startsOnRequest, false);
  });

  async function played(options: object) {
    const { state, gameOvers } = await exhibition({ mode: "timed", speed: 20, ...options });
    await until(() => state.phase === "ended");
    return { gameOvers, state };
  }

  it("plays to a gameOver with a reason and rankings with death causes, reporting nothing", async () => {
    const original = globalThis.fetch;
    const fetched: unknown[] = [];
    globalThis.fetch = ((...args: unknown[]) => (fetched.push(args), Promise.reject(new Error("no network")))) as any;
    try {
      const { gameOvers } = await played({ botA: "dummy", botB: "rookie", seed: 99 });
      assert.strictEqual(gameOvers.length, 1);
      assert.ok(gameOvers[0].reason);
      assert.strictEqual(gameOvers[0].rankings.length, 2);
      assert.ok(gameOvers[0].rankings.some((r: any) => r.cause !== undefined) || gameOvers[0].reason === "timeUp");
      await wait(50);
      assert.deepStrictEqual(fetched, []);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("ends the same way for the same seed, pair, mode, speed and delay", async () => {
    const options = { botA: "dummy", botB: "rookie", seed: 99, botReactionTicks: 1 };
    const first = await played(options);
    const second = await played(options);
    // Ids carry the room's id, so compare what the round decided.
    const outcome = (over: any) => over.rankings.map(({ name, score, cause }: any) => ({ name, score, cause }));
    assert.deepStrictEqual(outcome(second.gameOvers[0]), outcome(first.gameOvers[0]));
  });
});
