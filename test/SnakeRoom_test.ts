import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { TICK_MS, joinOptions, wait, waitForState } from "./helpers";

describe("SnakeRoom patch cadence", () => {
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A room with two players sitting in the lobby, no round started yet. */
  async function lobbyRoom() {
    const room = await colyseus.createRoom<GameState>("snake", {});
    const client1 = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));
    const client2 = await colyseus.connectTo(room, joinOptions("p2", "#00ff00"));
    return { room, client1, client2 };
  }

  /** The same, with a round running by the time it resolves. */
  async function startedRoom() {
    const ctx = await lobbyRoom();
    ctx.client1.send(SnakeRoom.messageTypes.START_GAME);
    await ctx.room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    return ctx;
  }

  /**
   * Records the order in which the room simulates and flushes state, so tests
   * can assert on the cadence itself rather than on wall-clock timings.
   *
   * This deliberately pierces the room's internals: it shadows `update` and
   * `broadcastPatch` on the instance, delegating to the originals (which for
   * `broadcastPatch` is @colyseus/testing's own prototype override, so the
   * server-side `room.waitForNextPatch()` keeps working).
   */
  function recordTickCadence(room: any): Array<"tick" | "patch"> {
    const events: Array<"tick" | "patch"> = [];

    const originalUpdate = room.update.bind(room);
    room.update = () => {
      events.push("tick");
      return originalUpdate();
    };

    const originalBroadcastPatch = room.broadcastPatch.bind(room);
    room.broadcastPatch = () => {
      events.push("patch");
      return originalBroadcastPatch();
    };

    return events;
  }

  it("emits exactly one patch per simulation tick while a round runs", async () => {
    const { room } = await startedRoom();

    const events = recordTickCadence(room);
    await wait(TICK_MS * 5);

    const ticks = events.filter((e) => e === "tick").length;
    const patches = events.filter((e) => e === "patch").length;

    assert.ok(ticks >= 3, `expected at least 3 simulation ticks, got ${ticks}`);
    assert.strictEqual(
      patches,
      ticks,
      `expected one patch per tick, got ${patches} patches for ${ticks} ticks`
    );
  });

  it("never flushes between ticks", async () => {
    const { room } = await startedRoom();

    const events = recordTickCadence(room);
    await wait(TICK_MS * 5);

    // Every patch must be immediately preceded by the tick that produced it.
    // An independent patch timer shows up here as two patches in a row, which
    // is what makes movement arrive 0-50ms late and jittery on the client.
    const trimmed = events.slice(events.indexOf("tick"));
    assert.ok(
      trimmed.length >= 6,
      `expected at least 3 tick/patch pairs, got ${trimmed.join(",") || "nothing"}`
    );
    trimmed.forEach((event, i) => {
      const expected = i % 2 === 0 ? "tick" : "patch";
      assert.strictEqual(
        event,
        expected,
        `expected strictly alternating tick/patch, got ${trimmed.join(",")}`
      );
    });
  });

  it("delivers each tick to the client promptly and with steady lag", async () => {
    const { room, client1 } = await startedRoom();

    // Pair each tick with the moment the client applied the resulting patch.
    // Under an independent patch clock this lag wanders across 0-50ms tick to
    // tick, which is the stutter players see; tied to the tick it is just the
    // (localhost) network hop, and steady.
    const tickedAt: number[] = [];
    const appliedAt: number[] = [];

    const originalUpdate = (room as any).update.bind(room);
    (room as any).update = () => {
      tickedAt.push(Date.now());
      return originalUpdate();
    };
    client1.onStateChange(() => appliedAt.push(Date.now()));

    await wait(TICK_MS * 8);

    const lags = appliedAt.map((t, i) => t - tickedAt[i]);
    assert.ok(lags.length >= 5, `expected at least 5 synced ticks, got ${lags.length}`);
    lags.forEach((lag) => {
      assert.ok(
        lag >= 0 && lag < TICK_MS / 4,
        `patch reached the client ${lag}ms after its tick; expected well under ${TICK_MS / 4}ms (all lags: ${lags.join(",")})`
      );
    });

    const jitter = Math.max(...lags) - Math.min(...lags);
    assert.ok(
      jitter < TICK_MS / 4,
      `delivery lag varied by ${jitter}ms tick to tick (all lags: ${lags.join(",")})`
    );
  });

  it("still syncs the lobby when no round is in progress", async () => {
    const room = await colyseus.createRoom<GameState>("snake", {});
    const client1 = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));

    // Armed before the join, so the patch carrying the new player cannot land
    // before we are listening for it.
    const synced = waitForState(
      client1,
      () => client1.state.players.length === 2,
      "the joining player"
    );
    await colyseus.connectTo(room, joinOptions("p2", "#00ff00"));
    await synced;

    const p2State = client1.state.players.find((p) => p.name === "p2");
    assert.strictEqual(p2State.colours.head, "#00ff00");
  });

  it("syncs mid-lobby colour changes to the other client", async () => {
    const { client1, client2 } = await lobbyRoom();

    const synced = waitForState(
      client1,
      () =>
        client1.state.players.find((p) => p.id === client2.sessionId)?.colours
          .head === "#0000ff",
      "the updated colours"
    );
    client2.send(SnakeRoom.messageTypes.UPDATE_PLAYER, {
      colours: { head: "#0000ff", body: "#0000ff", eyes: "#000000" }
    });
    await synced;

    const p2State = client1.state.players.find((p) => p.id === client2.sessionId);
    assert.strictEqual(p2State.colours.head, "#0000ff");
    assert.strictEqual(p2State.colours.body, "#0000ff");
    assert.strictEqual(p2State.colours.eyes, "#000000");
  });

  it("delivers the gameStarted broadcast only after the client has the patch", async () => {
    const { client1 } = await lobbyRoom();

    // The whole point of `afterNextPatch`: when the message lands, the client
    // must already hold the state the round starts from. Snapshot the client's
    // view at the instant of delivery rather than afterwards, or a later patch
    // would paper over a message that arrived too early.
    let stateOnDelivery: { hasGameStarted: boolean; directionX: number };
    const gameStarted = client1
      .waitForMessage(SnakeRoom.messageTypes.GAME_STARTED)
      .then(() => {
        const self = client1.state.players.find((p) => p.id === client1.sessionId);
        stateOnDelivery = {
          hasGameStarted: client1.state.hasGameStarted,
          directionX: self.snake.direction.x
        };
      });

    client1.send(SnakeRoom.messageTypes.START_GAME);
    await gameStarted;

    assert.strictEqual(
      stateOnDelivery.hasGameStarted,
      true,
      "client still saw hasGameStarted=false when gameStarted arrived"
    );
    assert.strictEqual(
      stateOnDelivery.directionX,
      1,
      "client had not received the round's starting snake direction yet"
    );
  });
});
