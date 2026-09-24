import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { rulesConfig } from "../src/engine";
import { Food, GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, waitForState } from "./helpers";

describe("endless room", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /**
   * A two-player endless round that has begun, with the simulation stopped
   * so the test ticks it by hand. The snakes spawn on one row heading the same
   * way, so neither crashes, and there's no food unless a test lays some.
   */
  async function begun() {
    const room: any = await colyseus.createRoom<GameState>("snake", { mode: "endless" });
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    room.setSimulationInterval(null);
    const state = room.state as GameState;
    const gameOver = new Promise<any>((resolve) => c1.onMessage(SnakeRoom.messageTypes.GAME_OVER, resolve));

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(state.phase, "playing");
    state.foodCoordinates.clear();

    /** Ticks the room and waits for the client to see the result. */
    const step = async () => {
      room.update();
      room.broadcastPatch();
      const hunger = state.players.map((p) => p.snake.hunger);
      await waitForState(c1, () => (c1.state as any).players.every((p: any, i: number) => p.snake.hunger === hunger[i]),
        `hunger ${hunger}`);
    };
    const seen = (i: number) => (c1.state as any).players[i].snake.hunger;
    return { room, state, c1, gameOver, step, seen };
  }

  it("syncs each snake's hunger, and the ticks before the drain starts", async () => {
    const { room, state, c1, step, seen } = await begun();
    await waitForState(c1, () => (c1.state as any).hungerTicks === rulesConfig.hungerTicks, "hungerTicks");
    state.players.forEach((p) => (p.snake.score = 1000));

    for (let t = 1; t <= 3; t++) {
      await step();
      assert.deepStrictEqual([seen(0), seen(1)], [t, t]);
    }

    // A pellet right in front of the first snake: it eats, the other doesn't.
    const [a] = state.players;
    const food = new Food();
    food.x = a.snake.x + a.snake.direction.x;
    food.y = a.snake.y + a.snake.direction.y;
    state.foodCoordinates.push(food);
    await step();
    assert.deepStrictEqual([seen(0), seen(1)], [0, 4]);
    assert.strictEqual(room.state.phase, "playing");
  });

  it("plays until a snake starves, and the rankings say so", async () => {
    const { state, gameOver, step } = await begun();
    const [starving, survivor] = state.players;
    survivor.snake.score = 1000;

    let ticks = 0;
    while (state.phase === "playing") {
      await step();
      ticks++;
    }

    // A snake on 0 starves on the first drain.
    assert.strictEqual(ticks, rulesConfig.hungerTicks);
    assert.ok(starving.snake.isDead);
    assert.ok(!survivor.snake.isDead);
    const message = await gameOver;
    assert.strictEqual(message.winnerId, survivor.id);
    assert.deepStrictEqual(message.rankings.find((r: any) => r.id === starving.id), {
      id: starving.id,
      name: starving.name,
      score: -rulesConfig.starveDrain,
      cause: "starved"
    });
  });
});
