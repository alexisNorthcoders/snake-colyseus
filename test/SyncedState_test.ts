import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { joinOptions, waitForState } from "./helpers";

describe("synced state", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** The state as a client decodes it, once its own player has arrived. */
  async function clientState() {
    const room = await colyseus.createRoom<GameState>("snake", {});
    const client = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));
    await waitForState(client, () => client.state.players.length === 1, "its own player");
    return client.state as any;
  }

  it("does not carry the server's spawn rotation", async () => {
    const state = await clientState();
    assert.strictEqual(state.nextPositionIndex, undefined);
  });

  it("does not carry an unused snake velocity", async () => {
    const state = await clientState();
    assert.strictEqual(state.players[0].snake.speed, undefined);
  });

  it("does not carry the leftover server-snake type on players or snakes", async () => {
    const state = await clientState();
    assert.strictEqual(state.players[0].type, undefined);
    assert.strictEqual(state.players[0].snake.type, undefined);
  });
});
