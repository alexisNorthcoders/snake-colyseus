import assert from "assert";
import http from "http";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import { logBotResultsConfig } from "../src/botResults";
import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("vs-bot result reports", () => {
  let colyseus: ColyseusTestServer;
  let fake: http.Server;
  let received: { headers: http.IncomingHttpHeaders; body: any }[];
  let respond: (res: http.ServerResponse) => void;
  const saved = { API_URL: process.env.API_URL, BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET };

  before(async () => {
    colyseus = await boot(appConfig);
    fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body: { url: req.url, method: req.method, ...JSON.parse(raw) } });
        respond(res);
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, resolve));
  });
  after(async () => {
    await colyseus.shutdown();
    fake.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(async () => {
    await colyseus.cleanup();
    received = [];
    respond = (res) => res.writeHead(200).end();
    process.env.API_URL = `http://localhost:${(fake.address() as any).port}`;
    process.env.BOT_RESULTS_SECRET = "s3cret";
  });

  async function vsBotRoom(extra: object = {}) {
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
      await until(() => room.state.phase === "playing");
    };
    const state = room.state as GameState;
    const me = () => state.players.find((p) => !p.isBot)!;
    const bot = () => state.players.find((p) => p.isBot)!;
    /** Boxes a snake in so it dies on the next tick. */
    const trap = (p: any) => p.snake.setTail([{ x: p.snake.x + 1, y: p.snake.y }, { x: p.snake.x + 1, y: p.snake.y + 1 }, { x: p.snake.x, y: p.snake.y + 1 }]);
    return { room, state, human, gameOvers, start, me, bot, trap };
  }

  it("reports a round the bot wins, with the secret", async () => {
    const { room, human, gameOvers, start, me, trap } = await vsBotRoom({ botId: "rookie", botReactionTicks: 1 });
    await start();
    trap(me());
    await until(() => received.length === 1);
    assert.strictEqual(gameOvers.length, 1);
    const [{ headers, body }] = received;
    assert.strictEqual(body.method, "POST");
    assert.strictEqual(body.url, "/bot-results");
    assert.strictEqual(headers.authorization, "Bearer s3cret");
    assert.strictEqual(typeof body.resultId, "string");
    assert.strictEqual(body.botId, "rookie");
    assert.strictEqual(body.mode, room.state.mode);
    assert.strictEqual(body.delay, 1);
    assert.strictEqual(body.outcome, "win");
    assert.ok(human.sessionId);
  });

  it("reports the roster id that played, falling back to the rookie", async () => {
    const { start, me, trap } = await vsBotRoom({ botId: "no-such-snake" });
    await start();
    trap(me());
    await until(() => received.length === 1);
    assert.strictEqual(received[0].body.botId, "rookie");
  });

  it("reports a loss when the human wins", async () => {
    const { room, start, me } = await vsBotRoom();
    await start();
    room.endRound({ reason: "last-standing", winnerId: me().id });
    await until(() => received.length === 1);
    assert.strictEqual(received[0].body.outcome, "loss");
  });

  it("reports a draw when nobody wins", async () => {
    const { room, start } = await vsBotRoom();
    await start();
    room.endRound({ reason: "time-up" });
    await until(() => received.length === 1);
    assert.strictEqual(received[0].body.outcome, "draw");
  });

  it("reports a second round with a new resultId", async () => {
    const first = await vsBotRoom();
    await first.start();
    first.trap(first.me());
    await until(() => received.length === 1);
    const second = await vsBotRoom();
    await second.start();
    second.trap(second.me());
    await until(() => received.length === 2);
    assert.notStrictEqual(received[0].body.resultId, received[1].body.resultId);
  });

  it("counts a human leaving mid-round as a bot win", async () => {
    const { human, start, state } = await vsBotRoom();
    await start();
    await human.leave();
    await until(() => received.length === 1);
    assert.strictEqual(received[0].body.outcome, "win");
    assert.strictEqual(state.phase, "ended");
  });

  it("reports nothing when the human leaves before play", async () => {
    const { human, state } = await vsBotRoom();
    await human.leave();
    await wait(200);
    assert.strictEqual(state.phase, "lobby");
    assert.strictEqual(received.length, 0);
  });

  it("never reports from a public room", async () => {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const c1 = await colyseus.connectTo(room, joinOptions("a", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("b", "#00ff00"));
    c1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    await until(() => room.state.phase === "playing");
    room.endRound({ reason: "time-up" });
    await wait(200);
    assert.strictEqual(received.length, 0);
  });

  it("sends nothing without a secret", async () => {
    delete process.env.BOT_RESULTS_SECRET;
    const { start, me, trap, state } = await vsBotRoom();
    await start();
    trap(me());
    await until(() => state.phase === "ended");
    await wait(200);
    assert.strictEqual(received.length, 0);
  });

  const failures: [string, () => void, () => void][] = [
    ["is down", () => (process.env.API_URL = "http://localhost:1"), () => {}],
    ["times out", () => (respond = () => {}), () => {}],
    ["returns 500", () => (respond = (res) => res.writeHead(500).end()), () => {}]
  ];
  for (const [what, setUp] of failures) {
    it(`carries on when go-server ${what}`, async function () {
      this.timeout(10000);
      setUp();
      const { start, me, trap, state, gameOvers } = await vsBotRoom();
      await start();
      trap(me());
      await until(() => state.phase === "ended");
      assert.strictEqual(gameOvers.length, 1);
    });
  }

  describe("start-up log", () => {
    const logged = (secret: string | undefined) => {
      const before = process.env.BOT_RESULTS_SECRET;
      if (secret === undefined) delete process.env.BOT_RESULTS_SECRET;
      else process.env.BOT_RESULTS_SECRET = secret;
      const lines: unknown[][] = [];
      const log = console.log;
      console.log = (...args: unknown[]) => void lines.push(args);
      try {
        logBotResultsConfig();
      } finally {
        console.log = log;
        if (before === undefined) delete process.env.BOT_RESULTS_SECRET;
        else process.env.BOT_RESULTS_SECRET = before;
      }
      return lines;
    };

    it("logs once when the secret is missing", () => {
      const lines = logged(undefined);
      assert.strictEqual(lines.length, 1);
      assert.match(String(lines[0][0]), /BOT_RESULTS_SECRET/);
    });

    it("logs nothing when the secret is set", () => {
      assert.strictEqual(logged("s3cret").length, 0);
    });
  });
});
