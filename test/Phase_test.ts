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
    assert.strictEqual(room.transition("playing"), true);
    assert.strictEqual(room.transition("lobby"), false);
    assert.strictEqual(state.phase, "playing");
  });

  it("returns to the lobby after a round when reusable (the default)", async () => {
    const { room, state } = await twoPlayerRoom();
    room.transition("playing");
    room.endRound();
    assert.strictEqual(state.phase, "lobby");
  });

  it("stays ended after a round when not reusable", async () => {
    const { room, c1, state } = await twoPlayerRoom({ reusable: false });
    room.transition("playing");
    room.endRound();
    assert.strictEqual(state.phase, "ended");

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(state.phase, "ended");
  });
});
