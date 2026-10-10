import assert from "assert";
import http from "http";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { gameConfig } from "../src/gameConfig";
import { dummyBrain, roster } from "../src/bots";
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
  let ratingOf: (res: http.ServerResponse) => void;
  let botReports: any[];
  let respond: (res: http.ServerResponse, body: any) => void;
  const saved = { ...gameConfig };
  const savedRetry = { ...rankedRetry };
  const savedEnv = { API_URL: process.env.API_URL, BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET };
  // These tests choose Stand-ins from a roster where only the rookie is rated, whatever bots are committed.
  const savedRoster = [...roster];
  before(() => roster.splice(0, roster.length, ...savedRoster.filter((e) => e.id === "rookie" || e.rating === undefined)));
  after(() => roster.splice(0, roster.length, ...savedRoster));
  const drop = (e: unknown) => {
    const i = roster.indexOf(e as (typeof roster)[number]);
    if (i >= 0) roster.splice(i, 1);
  };

  // Tokens go-server knows: "account-token" is u1, "other-token" is u2, "account-token-3" is u3, "guest-token" a Guest.
  const verdicts: Record<string, object> = {
    "account-token": { kind: "account", userId: "u1" },
    "other-token": { kind: "account", userId: "u2" },
    "account-token-3": { kind: "account", userId: "u3" },
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
        if (req.url?.startsWith("/rating?")) return ratingOf(res);
        if (req.url === "/bot-results") {
          botReports.push(JSON.parse(raw));
          return res.writeHead(200).end();
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
    botReports = [];
    ratingOf = (res) => res.writeHead(200).end(JSON.stringify({ userId: "u1", rating: 1500, rd: 200, rankedMatches: 9, provisional: false }));
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

  describe("choosing the Stand-in", () => {
    const rated = (id: string, rating: number) =>
      ({ id, name: id, generation: 1, method: "hand-made", rating, kind: "brain", encoderVersion: 1, rulesVersion: 1, brain: dummyBrain }) as any;
    const extras = [rated("weak", 1300), rated("strong", 1800), { ...rated("unrated", 1500), rating: undefined }];
    beforeEach(() => roster.push(...extras));
    afterEach(() => extras.forEach(drop));

    const lookup = (rating: number) => (ratingOf = (res) => res.writeHead(200).end(JSON.stringify({ rating })));

    it("seats the rated bot closest to the Account's Rating", async () => {
      lookup(1700);
      const { state, standIn } = await match();
      await until(() => state.players.length === 2);
      assert.strictEqual(standIn().name, "strong");
    });

    it("never seats an unrated bot", async () => {
      lookup(1500);
      const { state, standIn } = await match();
      await until(() => state.players.length === 2);
      assert.notStrictEqual(standIn().name, "unrated");
      assert.strictEqual(standIn().name, "weak");
    });

    it("treats an Account go-server can't rate as 1500", async () => {
      ratingOf = (res) => res.writeHead(500).end();
      const { state, standIn } = await match();
      await until(() => state.players.length === 2);
      assert.strictEqual(standIn().name, "weak");
    });

    it("starts the match with the rookie when nothing else is rated", async () => {
      extras.forEach(drop);
      lookup(1900);
      const { state, standIn } = await match();
      await until(() => state.players.length === 2);
      assert.strictEqual(standIn().name, "Rookie");
      roster.push(...extras);
    });

    it("reports the match to /ranked-results with the bot's Rating and to /bot-results", async () => {
      lookup(1700);
      const { room, state } = await match();
      await until(() => state.phase === "playing");
      room.endRound({ reason: "time-up" });
      // Rooms left over from earlier tests may still report their forfeits.
      const mine = <T extends { resultId: string }>(all: T[]) => all.filter((r) => r.resultId.startsWith(room.roomId));
      await until(() => mine(reports.map((r) => r.body)).length === 1 && mine(botReports).length === 1);
      assert.deepStrictEqual(mine(reports.map((r) => r.body))[0].b, { standInId: "strong", rating: 1800 });
      assert.strictEqual(mine(botReports)[0].botId, "strong");
      assert.strictEqual(mine(botReports)[0].outcome, "draw");
    });
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

  describe("two Accounts", () => {
    async function pair() {
      const first = await match();
      const second = await join("other-token");
      const updates2: any[] = [];
      second.onMessage(SnakeRoom.messageTypes.RATING_UPDATE, (m) => updates2.push(m));
      return { ...first, first: first.client, second, updates2 };
    }

    it("seats the second Account in the same room and starts the countdown on its own", async () => {
      gameConfig.standInWaitMs = 100000;
      gameConfig.countdownSeconds = 3;
      const { first, second, state, room } = await pair();
      assert.strictEqual(second.roomId, first.roomId);
      await until(() => state.phase === "countdown");
      assert.strictEqual(room.locked, true);
      assert.strictEqual(state.players.filter((p) => p.isBot).length, 0);
    });

    it("seats no Stand-in after the wait once a second Account joined", async () => {
      gameConfig.countdownSeconds = 3;
      const { state } = await pair();
      await wait(250);
      assert.strictEqual(state.players.length, 2);
      assert.strictEqual(state.players.filter((p) => p.isBot).length, 0);
    });

    it("gives a third Account a new room", async () => {
      const { first } = await pair();
      const third = await join("account-token-3");
      assert.notStrictEqual(third.roomId, first.roomId);
    });

    it("refuses the same Account joining twice", async () => {
      gameConfig.standInWaitMs = 100000;
      const { state } = await match();
      await assert.rejects(join("account-token"));
      assert.strictEqual(state.players.length, 1);
    });

    it("reports both Accounts and sends both clients ratingUpdate", async () => {
      const { state, room, updates, updates2 } = await pair();
      await until(() => state.phase === "playing");
      room.endRound({ winnerId: state.players[1].id });
      await until(() => reports.length === 1);
      const { body } = reports[0];
      assert.deepStrictEqual([body.a.accountId, body.b.accountId].sort(), ["u1", "u2"]);
      assert.strictEqual(body.forfeit, false);
      await until(() => updates.length === 1 && updates2.length === 1);
    });

    it("reports either Account leaving mid-match as their Forfeit", async () => {
      const { state, second } = await pair();
      await until(() => state.phase === "playing");
      await second.leave();
      await until(() => reports.length === 1);
      const { body } = reports[0];
      assert.strictEqual(body.forfeit, true);
      assert.strictEqual(body.outcome, body.a.accountId === "u1" ? "a" : "b");
    });
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
