import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("vs-bot room", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  async function vsBotRoom(extra: object = {}) {
    // `create`, not createRoom + connectTo: the room is locked from creation,
    // so only its creator gets in (a joinById is refused).
    const human = await colyseus.sdk.create("snake", { vsBot: true, ...extra, ...joinOptions("me", "#ff0000") });
    const room: any = colyseus.getRoomById(human.roomId);
    const gameOvers: any[] = [];
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (type: string, message: any, options?: any) => {
      if (type === SnakeRoom.messageTypes.GAME_OVER) gameOvers.push(message);
      return broadcast(type, message, options);
    };
    const start = async () => {
      human.send(SnakeRoom.messageTypes.START_GAME);
      await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    };
    return { room, state: room.state as GameState, human, gameOvers, start };
  }

  it("locks at creation so matchmaking never lands in it", async () => {
    const { room } = await vsBotRoom();
    assert.strictEqual(room.locked, true);
    const other = await colyseus.sdk.joinOrCreate("snake", joinOptions("x", "#0000ff"));
    assert.notStrictEqual(other.roomId, room.roomId);
  });

  it("seats one bot in the lobby, next to the human", async () => {
    const { state, human } = await vsBotRoom();
    assert.strictEqual(state.phase, "lobby");
    assert.strictEqual(state.players.length, 2);
    const bots = state.players.filter((p) => p.isBot);
    assert.strictEqual(bots.length, 1);
    assert.ok(bots[0].name && bots[0].colours.head);
    assert.notStrictEqual(bots[0].id, human.sessionId);
    const humanPlayer = state.players.find((p) => p.id === human.sessionId)!;
    assert.strictEqual(humanPlayer.isBot, false);
  });

  it("plays a round to a sane end", async () => {
    const { state, human, gameOvers, start } = await vsBotRoom();
    await start();
    assert.strictEqual(state.aliveCount, 2);
    const bot = state.players.find((p) => p.isBot)!;
    const { x, y } = bot.snake;
    await until(() => bot.snake.x !== x || bot.snake.y !== y);
    // Nothing else ends the round: two snakes on a wrapping board can circle
    // for ever, so the human runs into itself.
    const me = state.players.find((p) => p.id === human.sessionId)!;
    me.snake.setTail([{ x: me.snake.x + 1, y: me.snake.y }, { x: me.snake.x + 1, y: me.snake.y + 1 }, { x: me.snake.x, y: me.snake.y + 1 }]);
    await until(() => state.phase === "ended");
    assert.strictEqual(gameOvers.length, 1);
    assert.strictEqual(gameOvers[0].rankings.length, 2);
    assert.strictEqual(state.aliveCount, 1);
    const winner = state.players.find((p) => !p.snake.isDead)!;
    assert.strictEqual(gameOvers[0].winnerId, winner.id);
  });

  it("crowns the bot when the human dies first", async () => {
    const { room, state, human, gameOvers, start } = await vsBotRoom();
    room.setSimulationInterval(null);
    await start();
    const me = state.players.find((p) => p.id === human.sessionId)!;
    const bot = state.players.find((p) => p.isBot)!;
    // Park the bot in open space heading away, and run the human into itself.
    bot.snake.x = 10; bot.snake.y = 10;
    me.snake.x = 3; me.snake.y = 3;
    me.snake.setTail([{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }]);
    room.update();
    assert.strictEqual(state.phase, "ended");
    assert.strictEqual(state.aliveCount, 1);
    assert.strictEqual(gameOvers[0].winnerId, bot.id);
  });

  it("crowns the human when the bot dies first", async () => {
    const { room, state, human, gameOvers, start } = await vsBotRoom();
    room.setSimulationInterval(null);
    await start();
    const me = state.players.find((p) => p.id === human.sessionId)!;
    const bot = state.players.find((p) => p.isBot)!;
    me.snake.x = 3; me.snake.y = 3;
    // Bot boxed in on all sides but wall-free: every turn is fatal too.
    bot.snake.x = 10; bot.snake.y = 10;
    me.snake.setTail([]);
    bot.snake.setTail([{ x: 11, y: 10 }, { x: 10, y: 9 }, { x: 10, y: 11 }, { x: 9, y: 10 }]);
    room.update();
    assert.strictEqual(state.phase, "ended");
    assert.strictEqual(gameOvers[0].winnerId, human.sessionId);
  });

  it("keeps its direction and the round going when decide() throws", async () => {
    const { room, state, start } = await vsBotRoom();
    room.setSimulationInterval(null);
    await start();
    const b = state.players.find((p) => p.isBot)!;
    const { x } = b.snake;
    const original = console.error;
    console.error = () => {};
    // Poison the view decide() is handed, so it throws.
    room.botView = () => { throw new Error("boom"); };
    try { room.update(); } finally { console.error = original; }
    assert.strictEqual(state.phase, "playing");
    assert.strictEqual(b.snake.x, (x + 1) % 20);
  });

  it("ends the round and disposes the room when the human leaves", async () => {
    const { room, state, human, gameOvers, start } = await vsBotRoom();
    await start();
    human.leave();
    await until(() => state.phase === "ended");
    assert.strictEqual(gameOvers[0].winnerId, state.players.find((p) => p.isBot)!.id);
    await until(() => room.disposed || colyseus.getRoomById(room.roomId) === undefined);
  });

  describe("reaction delay", () => {
    // The human crosses the bot's path at column 8 heading down; the bot heads
    // right along row 10. Only a bot that sees the human's tail there in time
    // turns away.
    async function crossing(extra: object) {
      const { room, state, human, start } = await vsBotRoom(extra);
      room.setSimulationInterval(null);
      await start();
      const me = state.players.find((p) => p.id === human.sessionId)!;
      const bot = state.players.find((p) => p.isBot)!;
      // Out of the bot's sight, so it isn't lured off its line.
      state.foodCoordinates.forEach((f) => { f.x = 14; f.y = 0; });
      me.snake.x = 8; me.snake.y = 7;
      me.snake.direction.x = 0; me.snake.direction.y = 1;
      me.snake.movedDirection = { x: 0, y: 1 };
      me.snake.setTail([{ x: 8, y: 6 }, { x: 8, y: 5 }, { x: 8, y: 4 }]);
      bot.snake.x = 4; bot.snake.y = 10;
      bot.snake.setTail([]);
      for (let i = 0; i < 4 && state.phase === "playing"; i++) room.update();
      return { state, bot, me, room };
    }

    it("cuts the bot off when it reacts late", async () => {
      const { state, bot } = await crossing({ botReactionTicks: 2 });
      assert.strictEqual(bot.snake.isDead, true);
      assert.strictEqual(state.phase, "ended");
    });

    it("lets the bot dodge with no delay", async () => {
      const { state, bot } = await crossing({ botReactionTicks: 0 });
      assert.strictEqual(bot.snake.isDead, false);
      assert.strictEqual(state.phase, "playing");
    });

    it("shows other snakes exactly n ticks old, and the bot's own body and food current", async () => {
      const { room, state, start } = await vsBotRoom({ botReactionTicks: 2 });
      room.setSimulationInterval(null);
      await start();
      const human = state.players.find((p) => !p.isBot)!;
      const bot = state.players.find((p) => p.isBot)!;
      state.foodCoordinates.forEach((f) => { f.x = 14; f.y = 0; });
      human.snake.x = 3; human.snake.y = 3;
      human.snake.direction.x = 0; human.snake.direction.y = 1;
      human.snake.movedDirection = { x: 0, y: 1 };
      bot.snake.x = 10; bot.snake.y = 15;
      for (let ticks = 1; ticks <= 5; ticks++) {
        room.update();
        // The view is built at the start of the last tick, so it shows the
        // human as it was after `ticks - 1 - 2` moves (the oldest known, early on).
        const view = room.botView(bot);
        assert.strictEqual(view.others[0].head.y, 3 + Math.max(0, ticks - 3));
        assert.deepStrictEqual(view.self.head, { x: bot.snake.x, y: bot.snake.y });
        assert.strictEqual(view.food[0].x, 14);
      }
    });

    it("clamps and defaults botReactionTicks", async () => {
      const ticks = async (v: unknown) => (await vsBotRoom({ botReactionTicks: v })).room.botReactionTicks;
      assert.strictEqual(await ticks(9), 4);
      assert.strictEqual(await ticks(-3), 0);
      assert.strictEqual(await ticks(3), 3);
      assert.strictEqual(await ticks("2"), 2);
      assert.strictEqual(await ticks(NaN), 2);
      assert.strictEqual((await vsBotRoom()).room.botReactionTicks, 2);
    });
  });
});
