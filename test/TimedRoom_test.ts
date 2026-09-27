import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { gameConfig } from "../src/gameConfig";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, waitForState } from "./helpers";

describe("timed room", () => {
  let colyseus: ColyseusTestServer;
  const saved = { ...gameConfig };

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    // Half a second at 8 ticks a second: a 4-tick round.
    gameConfig.roundSeconds = 0.5;
    await colyseus.cleanup();
  });
  afterEach(() => Object.assign(gameConfig, saved));

  /**
   * Plays a two-player timed round from Start to game over by hand, a tick at
   * a time. The snakes spawn on one row heading the same way, so neither
   * dies, and there's no food, so they end on the given scores. Returns the
   * ticks left the client saw after each tick, the game-over message and the
   * players' ids.
   */
  async function playOut(scores: [number, number]) {
    const room: any = await colyseus.createRoom<GameState>("snake", { speed: 8 });
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    room.setSimulationInterval(null);
    const state = room.state as GameState;
    const gameOver = new Promise<any>((resolve) => c1.onMessage(SnakeRoom.messageTypes.GAME_OVER, resolve));

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(state.phase, "playing");

    state.foodCoordinates.clear();
    state.players.forEach((p, i) => (p.snake.score = scores[i]));
    room.broadcastPatch();
    await waitForState(c1, () => (c1.state as any).ticksLeft === 4, "the round's 4 ticks");

    const seen: number[] = [];
    while (state.phase === "playing") {
      room.update();
      room.broadcastPatch();
      const left = state.ticksLeft;
      await waitForState(c1, () => (c1.state as any).ticksLeft === left, `${left} ticks left`);
      seen.push(left);
    }

    assert.ok(state.players.every((p) => !p.snake.isDead), "the round ended on a death, not on time");
    return { seen, gameOver: await gameOver, ids: state.players.map((p) => p.id) };
  }

  it("counts the ticks left down in the synced state and names the top scorer the winner on time", async () => {
    const { seen, gameOver, ids } = await playOut([10, 30]);

    assert.deepStrictEqual(seen, [3, 2, 1, 0]);
    assert.strictEqual(gameOver.winnerId, ids[1]);
    assert.deepStrictEqual(gameOver.rankings.map((r: any) => [r.id, r.score]), [[ids[1], 30], [ids[0], 10]]);
  });

  it("calls a tie on score and length a draw, leaving the winner out", async () => {
    const { gameOver } = await playOut([20, 20]);

    assert.ok(!("winnerId" in gameOver), `winnerId sent: ${JSON.stringify(gameOver)}`);
    assert.strictEqual(gameOver.rankings.length, 2);
  });

  it("ends early on a death with the survivor as the winner, however much the dead snake scored", async () => {
    gameConfig.roundSeconds = 180;
    const room: any = await colyseus.createRoom<GameState>("snake", { speed: 8 });
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    room.setSimulationInterval(null);
    const state = room.state as GameState;
    const gameOver = new Promise<any>((resolve) => c1.onMessage(SnakeRoom.messageTypes.GAME_OVER, resolve));

    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);

    // The top scorer runs into the other snake's body on the next tick.
    const [doomed, survivor] = state.players;
    const place = (s: typeof doomed.snake, x: number, y: number, tail: { x: number; y: number }[] = []) => {
      s.x = x; s.y = y; s.direction.x = 1; s.direction.y = 0;
      s.movedDirection = { x: 1, y: 0 };
      s.setTail(tail);
    };
    place(doomed.snake, 5, 5);
    place(survivor.snake, 20, 20, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    doomed.snake.score = 500;
    room.update();

    assert.strictEqual(state.phase, "ended");
    assert.ok(state.ticksLeft > 0, "the round ran out of time instead");
    const message = await gameOver;
    assert.strictEqual(message.winnerId, survivor.id);
    assert.strictEqual(message.rankings[0].id, doomed.id);
  });

  it("starts the clock at the round's seconds at the room's speed", async () => {
    gameConfig.roundSeconds = 180;
    const room: any = await colyseus.createRoom<GameState>("snake", { speed: 10 });
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    room.setSimulationInterval(null);
    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);

    assert.strictEqual((room.state as GameState).ticksLeft, 1800);
    assert.strictEqual((room.state as GameState).tickLimit, 1800);
  });
});
