import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { gameConfig } from "../src/gameConfig";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

describe("start countdown", () => {
  let colyseus: ColyseusTestServer;
  const saved = { ...gameConfig };

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    gameConfig.countdownSeconds = 3;
    gameConfig.countdownTickMs = 100;
    await colyseus.cleanup();
  });
  afterEach(() => Object.assign(gameConfig, saved));

  async function started() {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    const c2 = await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    return { room, state: room.state as GameState, c1, c2 };
  }

  it("enters the countdown, locking the room and assigning spawns at once", async () => {
    const { room, state } = await started();
    assert.strictEqual(state.phase, "countdown");
    assert.strictEqual(state.countdown, 3);
    assert.strictEqual(room.locked, true);
    assert.notDeepStrictEqual(
      [state.players[0].snake.x, state.players[0].snake.y],
      [state.players[1].snake.x, state.players[1].snake.y]
    );
  });

  it("counts 3, 2, 1, 0 and then plays", async () => {
    const { state } = await started();
    const seen = [state.countdown];
    while (state.phase === "countdown") {
      await wait(10);
      if (seen[seen.length - 1] !== state.countdown) seen.push(state.countdown);
    }
    assert.deepStrictEqual(seen, [3, 2, 1, 0]);
    assert.strictEqual(state.phase, "playing");
    assert.strictEqual(state.aliveCount, 2);
  });

  it("ignores a duplicate startGame during the countdown", async () => {
    const { room, state, c1 } = await started();
    await wait(150);
    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(state.countdown, 2);
  });

  it("does not move snakes during the countdown", async () => {
    const { state } = await started();
    const { x } = state.players[0].snake;
    await wait(150);
    assert.strictEqual(state.phase, "countdown");
    assert.strictEqual(state.players[0].snake.x, x);
  });

  it("uses a direction set during the countdown for the first move", async () => {
    const { state, c1 } = await started();
    c1.send(SnakeRoom.messageTypes.MOVE, { key: "u" });
    while (state.phase === "countdown") await wait(10);
    const snake = state.players[0].snake;
    const { x, y } = snake;
    await wait(1000 / gameConfig.fps + 50);
    assert.strictEqual(snake.x, x);
    assert.notStrictEqual(snake.y, y);
  });

  it("still refuses a reversal during the countdown", async () => {
    const { state, c1 } = await started();
    c1.send(SnakeRoom.messageTypes.MOVE, { key: "l" });
    await wait(50);
    assert.strictEqual(state.players[0].snake.direction.x, 1);
  });

  it("refuses name and colour updates", async () => {
    const { state, c1 } = await started();
    c1.send(SnakeRoom.messageTypes.UPDATE_PLAYER, { name: "zed", colours: { head: "#123456" } });
    await wait(50);
    assert.strictEqual(state.players[0].colours.head, "#ff0000");
    assert.strictEqual(state.players[0].name, "a");
  });

  it("removes a leaver and carries on counting", async () => {
    const { state, c2 } = await started();
    await c2.leave();
    assert.strictEqual(state.players.length, 1);
    while (state.phase === "countdown") await wait(10);
    assert.strictEqual(state.phase, "playing");
    assert.strictEqual(state.aliveCount, 1);
  });
});
