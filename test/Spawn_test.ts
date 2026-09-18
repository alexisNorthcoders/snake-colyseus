import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { cellKey, spawnCells, startingPositions } from "../src/gameConfig";
import { GameState } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { joinOptions } from "./helpers";

const distinctCells = (cells: Array<{ x: number; y: number }>) =>
  new Set(cells.map((c) => cellKey(c.x, c.y))).size;

describe("spawn table", () => {
  it("lists no cell twice", () => {
    assert.strictEqual(
      distinctCells(startingPositions),
      startingPositions.length,
      "the spawn table has a duplicate cell"
    );
  });

  it("keeps spawns spread across the board", () => {
    // Chebyshev distance: how many ticks before one snake could reach the
    // other's spawn cell, ignoring wrap-around.
    const MIN_GAP = 5;
    startingPositions.forEach((a, i) => {
      startingPositions.slice(i + 1).forEach((b) => {
        const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        assert.ok(
          gap >= MIN_GAP,
          `${cellKey(a.x, a.y)} and ${cellKey(b.x, b.y)} are only ${gap} cells apart`
        );
      });
    });
  });
});

describe("spawnCells", () => {
  it("hands every snake its own cell, for any player count and starting offset", () => {
    for (let count = 1; count <= startingPositions.length; count++) {
      for (let offset = 0; offset < startingPositions.length * 2; offset++) {
        const cells = spawnCells(count, offset);
        assert.strictEqual(cells.length, count);
        assert.strictEqual(
          distinctCells(cells),
          count,
          `${count} players from offset ${offset} share a spawn cell`
        );
      }
    }
  });

  it("refuses more snakes than there are spawn cells", () => {
    assert.throws(() => spawnCells(startingPositions.length + 1, 0));
  });
});

describe("round spawns", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  it("has a spawn cell for every seat in the room", async () => {
    const room = await colyseus.createRoom<GameState>("snake", {});
    assert.ok(
      room.maxClients <= startingPositions.length,
      `the room seats ${room.maxClients} but there are only ${startingPositions.length} spawn cells`
    );
  });

  /**
   * Seats a full room, then plays `startingPositions.length + 1` rounds — enough
   * to wrap the spawn rotation — handing each round's head cells to `check`.
   */
  async function everyRound(check: (heads: Array<{ x: number; y: number }>, round: number, seats: number) => void) {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    const clients = [];
    for (let seat = 0; seat < room.maxClients; seat++) {
      clients.push(await colyseus.connectTo(room, joinOptions(`p${seat}`, "#ff0000")));
    }
    room.setSimulationInterval(null);

    const state: GameState = room.state;
    for (let round = 0; round < startingPositions.length + 1; round++) {
      clients[0].send(SnakeRoom.messageTypes.START_GAME);
      await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);

      check(state.players.map((p) => ({ x: p.snake.x, y: p.snake.y })), round, clients.length);

      state.hasGameStarted = false;
    }
  }

  it("keeps spawns distinct across repeated rounds", async () => {
    await everyRound((heads, round) =>
      assert.strictEqual(
        distinctCells(heads),
        heads.length,
        `round ${round + 1} spawned two snakes on one cell`
      )
    );
  });

  it("rotates the spawn offset from one round to the next", async () => {
    await everyRound((heads, round, seats) =>
      assert.deepStrictEqual(
        heads,
        spawnCells(seats, (round * seats) % startingPositions.length),
        `round ${round + 1} did not start where the rotation left off`
      )
    );
  });
});
