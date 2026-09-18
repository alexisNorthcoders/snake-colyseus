import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState, Snake } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { gameConfig } from "../src/gameConfig";
import { joinOptions } from "./helpers";

const BOTTOM_ROW = gameConfig.scaleFactor - 1;

describe("snake collision", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /**
   * A started round of `players` snakes with the simulation loop stopped, the
   * pellets parked along the bottom row and every game-over broadcast kept.
   */
  async function frozenRoom(players = 2) {
    const room: any = await colyseus.createRoom<GameState>("snake", {});
    room.maxClients = players;
    const clients = [];
    for (let i = 0; i < players; i++) {
      clients.push(await colyseus.connectTo(room, joinOptions(`p${i}`, "#ff0000")));
    }
    clients[0].send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    room.setSimulationInterval(null);

    const state: GameState = room.state;
    state.foodCoordinates.forEach((food, i) => {
      food.x = i;
      food.y = BOTTOM_ROW;
    });

    const gameOvers: any[] = [];
    const broadcast = room.broadcast.bind(room);
    room.broadcast = (type: string, message: any, options?: any) => {
      if (type === SnakeRoom.messageTypes.GAME_OVER) gameOvers.push(message);
      return broadcast(type, message, options);
    };

    return { room, state, snakes: state.players.map((player) => player.snake), gameOvers };
  }

  function place(
    snake: Snake,
    head: [number, number],
    direction: [number, number],
    tail: Array<[number, number]> = []
  ) {
    [snake.x, snake.y] = head;
    [snake.direction.x, snake.direction.y] = direction;
    snake.movedDirection = { x: direction[0], y: direction[1] };
    snake.setTail(tail.map(([x, y]) => ({ x, y })));
  }

  describe("head to head", () => {
    it("kills both snakes when they meet head-on", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [1, 0], [[4, 5]]);
      place(b, [7, 5], [-1, 0], [[8, 5]]);

      room.update();

      assert.ok(a.isDead, "the first snake survived a head-on collision");
      assert.ok(b.isDead, "the second snake survived a head-on collision");
    });

    it("kills both snakes when adjacent heads swap cells", async () => {
      // No tails, as every snake has at round start, so neither lands on a
      // body: the heads cross between cells rather than meet on one.
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [1, 0]);
      place(b, [6, 5], [-1, 0]);

      room.update();

      assert.ok(a.isDead, "the first snake passed through the second");
      assert.ok(b.isDead, "the second snake passed through the first");
    });

    it("kills both snakes when they converge on a cell from different directions", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [1, 0]);
      place(b, [6, 4], [0, 1]);

      room.update();

      assert.ok(a.isDead, "the first snake survived converging on the second");
      assert.ok(b.isDead, "the second snake survived converging on the first");
    });

    it("does not let two snakes sharing a cell travel in lockstep", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [1, 0]);
      place(b, [5, 5], [1, 0]);

      room.update();

      assert.ok(a.isDead && b.isDead, "snakes sharing a cell both kept going");
    });

    it("ends the round with no winner when the last two snakes collide", async () => {
      const { room, state, snakes: [a, b], gameOvers } = await frozenRoom();
      place(a, [5, 5], [1, 0]);
      place(b, [7, 5], [-1, 0]);

      room.update();

      assert.strictEqual(state.aliveCount, 0);
      assert.strictEqual(state.hasGameStarted, false);
      assert.strictEqual(gameOvers.length, 1, "expected exactly one game-over broadcast");
      assert.strictEqual(gameOvers[0].winnerId, undefined, "a snake that died was named winner");
    });

    it("spares a third snake elsewhere on the board and names it winner", async () => {
      const { room, state, snakes: [a, b, c], gameOvers } = await frozenRoom(3);
      place(a, [5, 5], [1, 0]);
      place(b, [7, 5], [-1, 0]);
      place(c, [10, 10], [1, 0]);

      room.update();

      assert.ok(a.isDead && b.isDead, "the colliding snakes survived");
      assert.ok(!c.isDead, "the bystander died");
      assert.strictEqual(state.aliveCount, 1);
      assert.strictEqual(gameOvers.length, 1, "expected exactly one game-over broadcast");
      assert.strictEqual(gameOvers[0].winnerId, state.players[2].id);
    });
  });

  describe("bodies", () => {
    it("kills a snake that runs into its own body", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      // Heading up into a coiled body: (5,4) is still part of the tail.
      place(a, [5, 5], [0, -1], [[6, 5], [6, 4], [5, 4], [4, 4]]);
      place(b, [15, 15], [1, 0]);

      room.update();

      assert.ok(a.isDead, "the snake ran through its own body");
      assert.ok(!b.isDead, "the bystander died");
    });

    it("kills a snake that runs into another snake's body, and only that snake", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [0, 1]);
      place(b, [7, 6], [1, 0], [[6, 6], [5, 6], [4, 6]]);

      room.update();

      assert.ok(a.isDead, "the snake ran through the other's body");
      assert.ok(!b.isDead, "the snake whose body was hit died");
    });

    // Snakes move together, so both of these hold whichever snake joined first.
    for (const order of ["first", "second"] as const) {
      it(`lets a head follow into the cell a tail end leaves this tick (chaser moves ${order})`, async () => {
        const { room, snakes } = await frozenRoom();
        const [chaser, leader] = order === "first" ? snakes : [...snakes].reverse();
        // The leader's tail end is at (6,5), and moves off it as the chaser arrives.
        place(chaser, [5, 5], [1, 0]);
        place(leader, [7, 4], [0, -1], [[7, 5], [6, 5]]);

        room.update();

        assert.ok(!chaser.isDead, "the chaser died on a cell the tail had already left");
        assert.ok(!leader.isDead, "the leader died");
      });

      it(`kills a head that enters the cell another head is leaving (it moves ${order})`, async () => {
        const { room, snakes } = await frozenRoom();
        const [chaser, leader] = order === "first" ? snakes : [...snakes].reverse();
        // The leader's neck moves onto (6,5) as the chaser arrives there.
        place(chaser, [6, 6], [0, -1]);
        place(leader, [6, 5], [1, 0], [[5, 5]]);

        room.update();

        assert.ok(chaser.isDead, "the chaser survived landing on the leader's neck");
        assert.ok(!leader.isDead, "the leader died");
      });
    }

    it("lets a snake pass through a dead snake's body and head", async () => {
      const { room, snakes: [a, b] } = await frozenRoom();
      place(a, [5, 5], [1, 0]);
      place(b, [7, 5], [0, 0], [[6, 5], [6, 6]]);
      b.isDead = true;

      room.update();
      assert.ok(!a.isDead, "the snake died on a dead snake's body");

      room.update();
      assert.ok(!a.isDead, "the snake died on a dead snake's head");
    });
  });
});
