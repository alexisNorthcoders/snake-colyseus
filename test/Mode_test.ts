import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, waitForState } from "./helpers";

describe("room mode", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  const modeOptions = (mode?: unknown) => (mode === undefined ? {} : { mode });

  const create = async (mode?: unknown, extra: object = {}) => {
    const client = await colyseus.sdk.create("snake", { ...modeOptions(mode), ...extra, ...joinOptions("a", "#ff0000") });
    return { client, room: colyseus.getRoomById(client.roomId) as SnakeRoom, state: colyseus.getRoomById(client.roomId).state as GameState };
  };

  const joinOrCreate = (mode: unknown, name: string) =>
    colyseus.sdk.joinOrCreate("snake", { ...modeOptions(mode), ...joinOptions(name, "#00ff00") });

  it("is timed when created without a mode", async () => {
    const { state } = await create();
    assert.strictEqual(state.mode, "timed");
  });

  it("is timed when created with an invalid mode", async () => {
    for (const bad of ["banana", "", 1, null, true, { mode: "endless" }, "Endless"]) {
      const { state } = await create(bad);
      assert.strictEqual(state.mode, "timed", `mode ${JSON.stringify(bad)}`);
    }
  });

  it("stays endless for the whole round and syncs its mode", async () => {
    const { client, room, state } = await create("endless");
    assert.strictEqual(state.mode, "endless");
    await waitForState(client, () => (client.state as any).mode === "endless", "the mode");

    room.setSimulationInterval(null);
    client.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(state.phase, "playing");
    room.update();
    assert.strictEqual(state.mode, "endless");
  });

  it("never joins a timed or modeless player into an endless room", async () => {
    const endless = await joinOrCreate("endless", "e");
    for (const mode of ["timed", undefined, "banana"]) {
      const other = await joinOrCreate(mode, `p-${mode}`);
      assert.notStrictEqual(other.roomId, endless.roomId, `mode ${mode}`);
    }
  });

  it("never joins an endless player into a timed or modeless room", async () => {
    const timed = await joinOrCreate("timed", "t");
    const modeless = await joinOrCreate(undefined, "m");
    // A room created without a mode is a timed room, and matches like one.
    assert.strictEqual(modeless.roomId, timed.roomId);
    const endless = await joinOrCreate("endless", "e");
    assert.notStrictEqual(endless.roomId, timed.roomId);
  });

  it("matches a modeless join to a timed room, and the other way round", async () => {
    const modeless = await joinOrCreate(undefined, "m");
    const timed = await joinOrCreate("timed", "t");
    const another = await joinOrCreate(undefined, "n");
    assert.strictEqual(timed.roomId, modeless.roomId);
    assert.strictEqual(another.roomId, modeless.roomId);
  });

  it("matches endless joins to each other", async () => {
    const a = await joinOrCreate("endless", "a");
    const b = await joinOrCreate("endless", "b");
    assert.strictEqual(a.roomId, b.roomId);
  });

  it("creates a vs-bot room in either mode", async () => {
    for (const mode of ["timed", "endless"]) {
      const { room, state } = await create(mode, { vsBot: true });
      assert.strictEqual(state.mode, mode);
      assert.strictEqual(room.locked, true);
      assert.strictEqual(state.players.filter((p) => p.isBot).length, 1);
    }
    const { state } = await create(undefined, { vsBot: true });
    assert.strictEqual(state.mode, "timed");
  });
});
