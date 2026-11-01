import assert from "assert";
import http from "http";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { gameConfig } from "../src/gameConfig";
import { roster } from "../src/bots";
import { directionMap } from "../src/engine";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 300 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

/** Walls a snake in on every side but behind, so it dies on its next tick whatever it chooses. */
const boxIn = (p: any) => {
  const { x, y } = p.snake;
  const m = p.snake.movedDirection;
  const cells = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !(dx === -m.x && dy === -m.y) && !(m.x === 0 && m.y === 0 && dx === -1));
  p.snake.setTail(cells.map(([dx, dy]) => ({ x: x + dx, y: y + dy })));
};

const trap = (p: any) => p.snake.setTail([{ x: p.snake.x + 1, y: p.snake.y }, { x: p.snake.x + 1, y: p.snake.y + 1 }, { x: p.snake.x, y: p.snake.y + 1 }]);

describe("bot thoughts", () => {
  let colyseus: ColyseusTestServer;
  let fake: http.Server;
  let botReports: any[];
  const savedEnv = { API_URL: process.env.API_URL, BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET };
  const saved = { ...gameConfig };

  before(async () => {
    colyseus = await boot(appConfig);
    fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url === "/bot-results") botReports.push(JSON.parse(raw));
        if (req.url === "/verify-token") return res.writeHead(200).end(JSON.stringify({ kind: "account", userId: "u1" }));
        if (req.url?.startsWith("/rating?")) return res.writeHead(200).end(JSON.stringify({ userId: "u1", rating: 1500, rd: 200, rankedMatches: 9, provisional: false }));
        res.writeHead(200).end("{}");
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, resolve));
  });
  after(async () => {
    await colyseus.shutdown();
    fake.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(async () => {
    await colyseus.cleanup();
    botReports = [];
    process.env.API_URL = `http://localhost:${(fake.address() as any).port}`;
    process.env.BOT_RESULTS_SECRET = "s3cret";
  });
  afterEach(() => Object.assign(gameConfig, saved));

  /** A vs-bot room whose ticks the test drives by hand; `events` is what the client saw, in order. */
  async function vsBotRoom(extra: object = {}) {
    const human = await colyseus.sdk.create("snake", { vsBot: true, ...extra, ...joinOptions("me", "#ff0000") });
    const room: any = colyseus.getRoomById(human.roomId);
    room.setSimulationInterval(null);
    const events: { type: string; message?: any }[] = [];
    human.onMessage(SnakeRoom.messageTypes.BOT_THOUGHT, (message) => events.push({ type: "thought", message }));
    human.onMessage(SnakeRoom.messageTypes.GAME_OVER, () => events.push({ type: "gameOver" }));
    human.onStateChange(() => events.push({ type: "patch" }));
    const state = room.state as GameState;
    const bot = () => state.players.find((p) => p.isBot)!;
    const me = () => state.players.find((p) => !p.isBot)!;
    const start = async () => {
      human.send(SnakeRoom.messageTypes.START_GAME);
      await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
      await until(() => state.phase === "playing");
    };
    /** One tick the way the interval runs it, then lets the client catch up. */
    const tick = async () => {
      room.update();
      room.broadcastPatch();
      await wait(40);
    };
    const thoughts = () => events.filter((e) => e.type === "thought").map((e) => e.message);
    return { room, state, human, events, bot, me, start, tick, thoughts };
  }

  it("sends one Thought per playing tick, before that tick's patch, with a brain's confidence", async () => {
    const { state, events, bot, me, start, tick, thoughts } = await vsBotRoom({ botId: "dummy", botThoughts: true });
    await wait(40);
    assert.strictEqual(thoughts().length, 0, "a Thought in the lobby");
    await start();
    assert.strictEqual(thoughts().length, 0, "a Thought in the countdown");
    bot().snake.x = 2; bot().snake.y = 2;
    me().snake.x = 2; me().snake.y = 15;
    events.length = 0;

    for (let i = 1; i <= 3; i++) {
      const before = events.length;
      await tick();
      assert.strictEqual(thoughts().length, i);
      const thisTick = events.slice(before).map((e) => e.type);
      assert.strictEqual(thisTick[0], "thought", "the Thought wasn't first on the socket");
      assert.ok(thisTick.includes("patch"), "no patch for the tick");
      assert.strictEqual(thisTick.indexOf("thought"), thisTick.lastIndexOf("thought"), "more than one Thought in a tick");
    }
    const [thought] = thoughts();
    assert.strictEqual(thought.playerId, bot().id);
    assert.ok(Object.keys(directionMap).includes(thought.chose));
    const { x, y } = thoughts()[2] && bot().snake.movedDirection;
    assert.deepStrictEqual({ x, y }, directionMap[thoughts()[2].chose as keyof typeof directionMap], "chose isn't the way the bot went");
    assert.ok(thoughts().every((t) => ["left", "straight", "right"].every((k) => typeof t.confidence[k] === "number")));
    assert.strictEqual(state.phase, "playing");
  });

  it("sends a bot's death tick Thought, and the last one before gameOver, then none", async () => {
    const { state, events, bot, me, start, tick, thoughts } = await vsBotRoom({ botId: "rookie", botThoughts: true });
    await start();
    await wait(80);
    events.length = 0;
    trap(me());
    await tick();
    assert.strictEqual(state.phase, "ended");
    const order = events.map((e) => e.type);
    assert.deepStrictEqual(order.slice(0, 3), ["thought", "gameOver", "patch"], "the tick's events weren't Thought, gameOver, patch");
    assert.strictEqual(order.filter((t) => t === "thought").length, 1);
    const count = thoughts().length;
    await tick();
    await tick();
    assert.strictEqual(thoughts().length, count, "a Thought after gameOver");
    assert.ok(bot());
  });

  it("sends none once the bot is dead", async () => {
    const { state, bot, me, start, tick, thoughts } = await vsBotRoom({ botId: "rookie", botThoughts: true });
    await start();
    boxIn(bot());
    await tick();
    assert.strictEqual(thoughts().length, 1, "the death tick still thinks");
    assert.ok(bot().snake.isDead);
    if (state.phase === "playing") {
      await tick();
      await tick();
      assert.strictEqual(thoughts().length, 1);
    }
    assert.ok(me());
  });

  it("leaves confidence out for the rookie", async () => {
    const { start, tick, thoughts, bot } = await vsBotRoom({ botId: "rookie", botThoughts: true });
    await start();
    await tick();
    const [thought] = thoughts();
    assert.strictEqual(thought.playerId, bot().id);
    assert.ok(Object.keys(directionMap).includes(thought.chose));
    assert.ok(!("confidence" in thought));
  });

  it("sends none without the option, or with anything but true", async () => {
    for (const extra of [{}, { botThoughts: false }, { botThoughts: "true" }, { botThoughts: 1 }]) {
      const { start, tick, thoughts } = await vsBotRoom({ botId: "dummy", ...extra });
      await start();
      await tick();
      await tick();
      assert.strictEqual(thoughts().length, 0, JSON.stringify(extra));
    }
  });

  it("sends none in a snake room with no bot, and doesn't change matchmaking", async () => {
    const a = await colyseus.sdk.joinOrCreate("snake", { botThoughts: true, ...joinOptions("a", "#ff0000") });
    const got: any[] = [];
    a.onMessage(SnakeRoom.messageTypes.BOT_THOUGHT, (m) => got.push(m));
    const room: any = colyseus.getRoomById(a.roomId);
    room.setSimulationInterval(null);
    const b = await colyseus.sdk.joinOrCreate("snake", joinOptions("b", "#0000ff"));
    assert.strictEqual(b.roomId, a.roomId);
    a.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    await until(() => room.state.phase === "playing");
    room.update();
    room.update();
    await wait(40);
    assert.strictEqual(got.length, 0);
  });

  it("sends none from a ranked room with a Stand-in, whatever the creator passed", async () => {
    gameConfig.standInWaitMs = 50;
    gameConfig.countdownTickMs = 20;
    const client = await colyseus.sdk.joinOrCreate("ranked", { token: "t", botThoughts: true, vsBot: true, ...joinOptions("me", "#ff0000") });
    const got: any[] = [];
    client.onMessage(SnakeRoom.messageTypes.BOT_THOUGHT, (m) => got.push(m));
    const room: any = colyseus.getRoomById(client.roomId);
    await until(() => room.state.phase === "playing");
    await wait(5 * (1000 / gameConfig.fps));
    assert.ok(room.state.players.some((p: any) => p.isBot));
    assert.strictEqual(got.length, 0);
    assert.strictEqual(room.sendsBotThoughts, false);
  });

  it("doesn't change how the bot plays or what is reported", async () => {
    const play = async (botThoughts: boolean) => {
      botReports = [];
      const { room, state, bot, me, start, tick } = await vsBotRoom({ botId: "dummy", seed: 7, botReactionTicks: 1, botThoughts });
      await start();
      const moves: string[] = [];
      for (let i = 0; i < 12 && state.phase === "playing"; i++) {
        await tick();
        moves.push(`${bot().snake.x},${bot().snake.y}`);
      }
      if (state.phase === "playing") {
        trap(me());
        await tick();
      }
      const mine = () => botReports.filter((r) => r.resultId.startsWith(`${room.roomId}:`));
      await until(() => mine().length === 1);
      const { resultId, ...report } = mine()[0];
      return { moves, report };
    };
    const off = await play(false);
    const on = await play(true);
    assert.deepStrictEqual(on, off);
  });

  it("is a known roster bot", () => assert.ok(roster.some((e) => e.id === "dummy")));
});
