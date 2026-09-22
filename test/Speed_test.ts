import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { joinOptions, wait } from "./helpers";

describe("room speed", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  const tickMs = async (speed?: unknown) => {
    const client = await colyseus.sdk.create("snake", { ...(speed === undefined ? {} : { speed }), ...joinOptions("a", "#ff0000") });
    return (colyseus.getRoomById(client.roomId).state as any).tickMs;
  };

  it("syncs the tick length for the room's speed", async () => {
    assert.strictEqual(await tickMs(10), 100);
    assert.strictEqual(await tickMs(4), 250);
  });

  it("clamps to 4-15", async () => {
    assert.strictEqual(await tickMs(1), 250);
    assert.strictEqual(await tickMs(100), 1000 / 15);
  });

  it("rounds to an integer and falls back to 8 when invalid", async () => {
    assert.strictEqual(await tickMs(9.6), 100);
    for (const bad of [undefined, "fast", NaN, null, Infinity]) assert.strictEqual(await tickMs(bad), 125);
  });

  it("runs the simulation at the room's speed", async () => {
    const client = await colyseus.sdk.create("snake", { speed: 15, ...joinOptions("a", "#ff0000") });
    const room: any = colyseus.getRoomById(client.roomId);
    let updates = 0;
    const update = room.update.bind(room);
    room.update = () => { updates++; return update(); };
    await wait(1000);
    assert.ok(updates >= 12 && updates <= 17, `expected ~15 ticks, got ${updates}`);
  });

  it("matches joinOrCreate by speed", async () => {
    const a = await colyseus.sdk.joinOrCreate("snake", { speed: 10, ...joinOptions("a", "#ff0000") });
    const b = await colyseus.sdk.joinOrCreate("snake", { speed: 10, ...joinOptions("b", "#00ff00") });
    const c = await colyseus.sdk.joinOrCreate("snake", { speed: 12, ...joinOptions("c", "#0000ff") });
    assert.strictEqual(a.roomId, b.roomId);
    assert.notStrictEqual(a.roomId, c.roomId);
  });
});
