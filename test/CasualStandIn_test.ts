import assert from "assert";
import http from "http";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("casual Stand-in", () => {
  let colyseus: ColyseusTestServer;
  let fake: http.Server;
  let received: any[];
  const saved = { API_URL: process.env.API_URL, BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET };

  before(async () => {
    colyseus = await boot(appConfig);
    fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        received.push({ url: req.url, ...JSON.parse(raw) });
        res.writeHead(200).end();
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
    process.env.API_URL = `http://localhost:${(fake.address() as any).port}`;
    process.env.BOT_RESULTS_SECRET = "s3cret";
  });

  async function start(humans: number, options: object = {}) {
    const room: any = await colyseus.createRoom<GameState>("snake", options);
    const clients = [];
    for (let i = 0; i < humans; i++) clients.push(await colyseus.connectTo(room, joinOptions(`p${i}`, "#ff0000")));
    clients[0].send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    return room;
  }

  for (const mode of ["timed", "endless"]) {
    it(`seats the rookie for a lone player in ${mode}, locked`, async () => {
      const room = await start(1, { mode });
      const bots = room.state.players.filter((p: any) => p.isBot);
      assert.strictEqual(bots.length, 1);
      assert.strictEqual(room.botSeats.get(bots[0].id).botId, "rookie");
      assert.strictEqual(room.state.players.length, 2);
      assert.strictEqual(room.state.aliveCount, 2);
      assert.strictEqual(room.locked, true);
    });
  }

  it("seats no bot for two players", async () => {
    const room = await start(2);
    assert.strictEqual(room.state.players.filter((p: any) => p.isBot).length, 0);
    assert.strictEqual(room.botSeats.size, 0);
  });

  it("leaves a vs-bot room with its one chosen bot", async () => {
    const human = await colyseus.sdk.create("snake", { vsBot: true, ...joinOptions("me", "#ff0000") });
    const room: any = colyseus.getRoomById(human.roomId);
    human.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    assert.strictEqual(room.state.players.length, 2);
    assert.strictEqual(room.botSeats.size, 1);
  });

  it("reports the round to /bot-results", async () => {
    const room = await start(1);
    await until(() => room.state.phase === "playing");
    room.endRound({ reason: "time-up" });
    await until(() => received.length === 1);
    assert.strictEqual(received[0].url, "/bot-results");
    assert.strictEqual(received[0].botId, "rookie");
  });
});
