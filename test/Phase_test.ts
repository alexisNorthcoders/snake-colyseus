import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, waitForState } from "./helpers";

describe("room phase", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  async function twoPlayerRoom(options: object = {}) {
    const room: any = await colyseus.createRoom<GameState>("snake", options);
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    return { room, state: room.state as GameState, c1 };
  }

  it("starts in the lobby and is synced to clients", async () => {
    const { c1 } = await twoPlayerRoom();
    await waitForState(c1, () => c1.state.phase === "lobby", "lobby phase");

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await waitForState(c1, () => c1.state.phase === "playing", "playing phase");
  });

  it("ignores invalid transitions", async () => {
    const { room, state } = await twoPlayerRoom();

    assert.strictEqual(room.transition("ended"), false);
    assert.strictEqual(state.phase, "lobby");
    assert.strictEqual(room.transition("playing"), false);
    assert.strictEqual(room.transition("countdown"), true);
    assert.strictEqual(room.transition("playing"), true);
    assert.strictEqual(room.transition("lobby"), false);
    assert.strictEqual(state.phase, "playing");
  });

  it("ends terminally: a finished round never returns to the lobby", async () => {
    const { room, state } = await twoPlayerRoom();
    room.state.phase = "playing";
    room.endRound({ reason: "last-standing" });
    assert.strictEqual(state.phase, "ended");
    assert.strictEqual(room.transition("lobby"), false);
    assert.strictEqual(room.transition("playing"), false);
  });

  it("ignores startGame after the round ended", async () => {
    const { room, c1, state } = await twoPlayerRoom();
    room.state.phase = "playing";
    room.endRound({ reason: "last-standing" });

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(state.phase, "ended");
  });

  it("locks when the round starts, so matchmaking picks another room", async () => {
    const { room, c1 } = await twoPlayerRoom();
    const before = await colyseus.sdk.joinOrCreate("snake", joinOptions("x", "#0000ff"));
    assert.strictEqual(before.roomId, room.roomId);

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(room.locked, true);

    const during = await colyseus.sdk.joinOrCreate("snake", joinOptions("y", "#ffff00"));
    assert.notStrictEqual(during.roomId, room.roomId);

    room.endRound({ reason: "last-standing" });
    assert.strictEqual(room.locked, true, "the room unlocked after the round ended");
    const after = await colyseus.sdk.joinOrCreate("snake", joinOptions("z", "#00ffff"));
    assert.notStrictEqual(after.roomId, room.roomId);
  });

  it("ignores newPlayer once the round has started", async () => {
    const { room, c1, state } = await twoPlayerRoom();
    room.state.phase = "playing";
    c1.send(SnakeRoom.messageTypes.NEW_PLAYER, { player: joinOptions("n", "#123456") });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(state.players.length, 2);
  });

  it("disposes the room once the last player leaves", async () => {
    const { room, c1 } = await twoPlayerRoom();
    const c2 = room.clients.find((c: any) => c.sessionId !== c1.sessionId);
    const disposed = new Promise<void>((resolve) => (room.onDispose = () => resolve()));

    await c1.leave();
    c2.leave();
    await Promise.race([
      disposed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("room never disposed")), 2000))
    ]);
  });
});
