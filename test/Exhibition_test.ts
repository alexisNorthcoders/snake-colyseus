import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { directionMap } from "../src/engine";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

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

  it("asks each seat's own thinker every tick", async () => {
    const spectator = await colyseus.sdk.create("exhibition", { botA: "dummy", botB: "dummy" });
    const room: any = colyseus.getRoomById(spectator.roomId);
    room.setSimulationInterval(null);
    const asked: string[] = [];
    for (const [id, seat] of room.botSeats) {
      const thinker = seat.thinker;
      seat.thinker = (view: any) => (asked.push(id), thinker(view));
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

  describe("joining by id", () => {
    it("lets a second client joinById mid-round and receive the state", async () => {
      const { room, state } = await exhibition({ botA: "dummy", botB: "dummy" });
      room.setSimulationInterval(null);
      await until(() => state.phase === "playing");
      const second = await colyseus.sdk.joinById(room.roomId);
      await until(() => second.state?.players?.length === 2);
      assert.strictEqual(second.state.phase, "playing");
      assert.strictEqual(state.players.length, 2);
    });

    it("is never found by join or joinOrCreate", async () => {
      const { room } = await exhibition({});
      const other = await colyseus.sdk.joinOrCreate("snake", joinOptions("x", "#0000ff"));
      assert.notStrictEqual(other.roomId, room.roomId);
      await assert.rejects(colyseus.sdk.join("exhibition", {}));
    });

    it("keeps the round running when a Spectator leaves, and disposes after the last", async () => {
      const { room, state, spectator } = await exhibition({ botA: "dummy", botB: "dummy" });
      room.setSimulationInterval(null);
      const second = await colyseus.sdk.joinById(room.roomId);
      await until(() => state.phase === "playing");
      await second.leave();
      await wait(50);
      assert.strictEqual(state.phase, "playing");
      assert.strictEqual(state.players.length, 2);
      let disposed = false;
      room.onDispose = ((orig: () => void) => () => { disposed = true; return orig?.call(room); })(room.onDispose);
      await spectator.leave();
      await until(() => disposed);
    });

    it("refuses the 17th client", async () => {
      const { room } = await exhibition({});
      for (let i = 0; i < 15; i++) await colyseus.sdk.joinById(room.roomId);
      assert.strictEqual(room.clients.length, 16);
      await assert.rejects(colyseus.sdk.joinById(room.roomId));
    });
  });

  describe("bot thoughts", () => {
    /** An exhibition whose Spectator collects Thoughts; `manual` drives the ticks by hand, else the room runs its own clock. */
    async function thinking(options: object, manual = true) {
      const made = await exhibition({ botThoughts: true, ...options });
      if (manual) made.room.setSimulationInterval(null);
      const thoughts: any[] = [];
      made.spectator.onMessage(SnakeRoom.messageTypes.BOT_THOUGHT, (m) => thoughts.push(m));
      const tick = async () => {
        made.room.update();
        made.room.broadcastPatch();
        await wait(40);
      };
      return { ...made, thoughts, tick };
    }

    it("sends each live seat a Thought per playing tick, and none before play", async () => {
      const { state, thoughts, tick } = await thinking({ botA: "dummy", botB: "munch-max" });
      await wait(40);
      assert.strictEqual(thoughts.length, 0, "a Thought before play");
      await until(() => state.phase === "playing");
      assert.strictEqual(thoughts.length, 0, "a Thought in the countdown");
      for (let i = 1; i <= 3; i++) {
        await tick();
        assert.strictEqual(thoughts.length, 2 * i);
      }
      const ids = state.players.map((p) => p.id).sort();
      assert.deepStrictEqual([...new Set(thoughts.map((t) => t.playerId))].sort(), ids);
      assert.ok(thoughts.every((t) => Object.keys(directionMap).includes(t.chose)));
    });

    it("sends none after gameOver", async () => {
      const { state, thoughts, gameOvers } = await thinking({ botA: "dummy", botB: "dummy", mode: "timed", speed: 20, seed: 7 }, false);
      await until(() => state.phase === "ended");
      assert.strictEqual(gameOvers.length, 1);
      const count = thoughts.length;
      await wait(100);
      assert.strictEqual(thoughts.length, count, "a Thought after gameOver");
    });

    it("gives each seat its own playerId in a mirror match", async () => {
      const { state, thoughts, tick } = await thinking({ botA: "munch-max", botB: "munch-max" });
      await until(() => state.phase === "playing");
      await tick();
      const seen = new Set(thoughts.map((t) => t.playerId));
      assert.strictEqual(seen.size, 2);
      assert.deepStrictEqual([...seen].sort(), state.players.map((p) => p.id).sort());
    });

    it("gives a brain seat confidence, and the rookie seat none", async () => {
      const { state, thoughts, tick } = await thinking({ botA: "dummy" });
      await until(() => state.phase === "playing");
      await tick();
      const brain = state.players.find((p) => p.name !== "Rookie")!;
      const rookie = state.players.find((p) => p.name === "Rookie")!;
      const byId = (id: string) => thoughts.find((t) => t.playerId === id);
      assert.ok(byId(brain.id)!.confidence);
      assert.ok(["left", "straight", "right"].every((k) => typeof byId(brain.id).confidence[k] === "number"));
      assert.ok(!("confidence" in byId(rookie.id)!));
    });

    it("sends a mid-round joinById Spectator Thoughts from the next tick", async () => {
      const { room, state, tick } = await thinking({ botA: "dummy", botB: "munch-max" });
      await until(() => state.phase === "playing");
      await tick();
      const late = await colyseus.sdk.joinById(room.roomId);
      const got: any[] = [];
      late.onMessage(SnakeRoom.messageTypes.BOT_THOUGHT, (m) => got.push(m));
      await tick();
      assert.strictEqual(got.length, 2);
    });

    it("sends none without the option, or with anything but true", async () => {
      for (const extra of [{}, { botThoughts: false }, { botThoughts: "true" }, { botThoughts: 1 }]) {
        const { state, thoughts, tick } = await thinking({ botA: "dummy", botB: "dummy", botThoughts: undefined, ...extra });
        await until(() => state.phase === "playing");
        await tick();
        await tick();
        assert.strictEqual(thoughts.length, 0, JSON.stringify(extra));
      }
    });

    it("reports nothing to go-server while sending Thoughts", async () => {
      const original = globalThis.fetch;
      const fetched: unknown[] = [];
      globalThis.fetch = ((...args: unknown[]) => (fetched.push(args), Promise.reject(new Error("no network")))) as any;
      try {
        const { state, thoughts, gameOvers } = await thinking({ botA: "dummy", botB: "dummy", mode: "timed", speed: 20, seed: 3 }, false);
        await until(() => state.phase === "ended");
        assert.ok(thoughts.length > 0 && gameOvers.length === 1);
        await wait(50);
        assert.deepStrictEqual(fetched, []);
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
