import assert from "assert";
import http from "http";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { gameConfig } from "../src/gameConfig";
import { rankedRetry } from "../src/rankedResults";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { ROOKIE_RATING } from "../src/rooms/RankedRoom";
import { joinOptions, wait } from "./helpers";

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 300 && !condition(); i++) await wait(10);
  assert.ok(condition(), "condition never held");
};

describe("ranked room", () => {
  let colyseus: ColyseusTestServer;
  let fake: http.Server;
  let reports: { headers: http.IncomingHttpHeaders; body: any }[];
  let respond: (res: http.ServerResponse, body: any) => void;
  const saved = { ...gameConfig };
  const savedRetry = { ...rankedRetry };
  const savedEnv = { API_URL: process.env.API_URL, BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET };

  // Tokens go-server knows: "account-token" is u1, "other-token" is u2, "guest-token" a Guest.
  const verdicts: Record<string, object> = {
    "account-token": { kind: "account", userId: "u1" },
    "other-token": { kind: "account", userId: "u2" },
    "guest-token": { kind: "guest", userId: "g1" }
  };
  const answer = (accountId: string) => ({
    resultId: "x",
    players: [{ accountId, ratingBefore: 1500, ratingAfter: 1516, rankedMatches: 1, provisional: true }]
  });

  before(async () => {
    colyseus = await boot(appConfig);
    fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url === "/verify-token") {
          const verdict = verdicts[String(req.headers.authorization).replace("Bearer ", "")];
          return verdict ? res.writeHead(200).end(JSON.stringify(verdict)) : res.writeHead(401).end();
        }
        if (req.url === "/ranked-results") {
          const body = JSON.parse(raw);
          reports.push({ headers: req.headers, body });
          return respond(res, body);
        }
        res.writeHead(200).end();
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
    reports = [];
    respond = (res, body) => res.writeHead(200).end(JSON.stringify(answer(body.a.accountId)));
    process.env.API_URL = `http://localhost:${(fake.address() as any).port}`;
    process.env.BOT_RESULTS_SECRET = "s3cret";
    gameConfig.standInWaitMs = 100;
    gameConfig.countdownTickMs = 20;
    rankedRetry.baseDelayMs = 20;
  });
  afterEach(() => {
    Object.assign(gameConfig, saved);
    Object.assign(rankedRetry, savedRetry);
  });

  const join = (token: string, extra: object = {}) =>
    colyseus.sdk.joinOrCreate("ranked", { token, ...extra, ...joinOptions("me", "#ff0000") });

  async function match(extra: object = {}) {
    const client = await join("account-token", extra);
    const room: any = colyseus.getRoomById(client.roomId);
    const updates: any[] = [];
    client.onMessage(SnakeRoom.messageTypes.RATING_UPDATE, (m) => updates.push(m));
    const state = room.state as GameState;
    const standIn = () => state.players.find((p) => p.isBot)!;
    const me = () => state.players.find((p) => !p.isBot)!;
    const trap = (p: any) => p.snake.setTail([{ x: p.snake.x + 1, y: p.snake.y }, { x: p.snake.x + 1, y: p.snake.y + 1 }, { x: p.snake.x, y: p.snake.y + 1 }]);
    return { client, room, state, updates, standIn, me, trap };
  }

  it("refuses a Guest and an invalid token", async () => {
    await assert.rejects(join("guest-token"));
    await assert.rejects(join("nonsense"));
    await assert.rejects(colyseus.sdk.joinOrCreate("ranked", joinOptions("me", "#ff0000")));
  });

  it("is a timed 2-seat room at the default speed, whatever the options", async () => {
    const { room, state } = await match({ mode: "endless", speed: 15, vsBot: true, seed: 3 });
    assert.strictEqual(state.mode, "timed");
    assert.strictEqual(state.tickMs, 1000 / gameConfig.fps);
    assert.strictEqual(room.maxClients, 2);
    assert.strictEqual(state.players.filter((p) => p.isBot).length, 0);
  });

  it("ignores a Start message", async () => {
    gameConfig.standInWaitMs = 100000;
    const { client, room, state } = await match();
    client.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    await wait(100);
    assert.strictEqual(state.phase, "lobby");
  });

  it("seats the rookie and starts the countdown after the wait alone", async () => {
    gameConfig.countdownSeconds = 3;
    const { room, state, standIn } = await match();
    assert.strictEqual(state.phase, "lobby");
    await until(() => state.phase === "countdown");
    assert.strictEqual(room.locked, true);
    assert.strictEqual(state.players.length, 2);
    assert.strictEqual(standIn().name, "Rookie");
  });

  it("reports the engine's outcome with the Account and the Stand-in", async () => {
    const { state, updates, me, trap } = await match();
    await until(() => state.phase === "playing");
    trap(me());
    await until(() => reports.length === 1);
    const [{ headers, body }] = reports;
    assert.strictEqual(headers.authorization, "Bearer s3cret");
    assert.strictEqual(typeof body.resultId, "string");
    assert.deepStrictEqual(body.a, { accountId: "u1" });
    assert.deepStrictEqual(body.b, { standInId: "rookie", rating: ROOKIE_RATING });
    assert.strictEqual(body.outcome, "b");
    assert.strictEqual(body.forfeit, false);
    await until(() => updates.length === 1);
    assert.deepStrictEqual(updates[0], { players: answer("u1").players });
  });

  it("reports a draw when nobody wins", async () => {
    const { room, state } = await match();
    await until(() => state.phase === "playing");
    room.endRound({ reason: "time-up" });
    await until(() => reports.length === 1);
    assert.strictEqual(reports[0].body.outcome, "draw");
  });

  it("reports leaving mid-match as a Forfeit loss", async () => {
    const { client, state } = await match();
    await until(() => state.phase === "playing");
    await client.leave();
    await until(() => reports.length === 1);
    assert.strictEqual(reports[0].body.outcome, "b");
    assert.strictEqual(reports[0].body.forfeit, true);
  });

  it("reports nothing when the Account leaves before the match", async () => {
    gameConfig.standInWaitMs = 100000;
    const { client } = await match();
    await client.leave();
    await wait(150);
    assert.strictEqual(reports.length, 0);
  });

  it("retries a failed report until it is delivered", async () => {
    let failures = 2;
    respond = (res, body) =>
      failures-- > 0 ? res.writeHead(500).end() : res.writeHead(200).end(JSON.stringify(answer(body.a.accountId)));
    const { state, updates, me, trap } = await match();
    await until(() => state.phase === "playing");
    trap(me());
    await until(() => updates.length === 1);
    assert.strictEqual(reports.length, 3);
    assert.strictEqual(new Set(reports.map((r) => r.body.resultId)).size, 1);
  });

  it("does not retry a report go-server refuses", async () => {
    respond = (res) => res.writeHead(400).end();
    const { state, me, trap } = await match();
    await until(() => state.phase === "playing");
    trap(me());
    await until(() => reports.length === 1);
    await wait(200);
    assert.strictEqual(reports.length, 1);
  });

  it("leaves casual snake rooms as they were", async () => {
    const client = await colyseus.sdk.joinOrCreate("snake", { mode: "endless", speed: 12, ...joinOptions("me", "#ff0000") });
    const room: any = colyseus.getRoomById(client.roomId);
    assert.strictEqual(room.maxClients, 4);
    assert.strictEqual(room.state.mode, "endless");
    client.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    await until(() => room.state.phase === "playing");
    await wait(150);
    assert.strictEqual(reports.length, 0);
  });
});
