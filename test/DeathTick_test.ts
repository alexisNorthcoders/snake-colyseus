import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { GameState, Snake } from "../src/rooms/schema/SnakeState";
import { SnakeRoom } from "../src/rooms/SnakeRoom";
import { gameConfig } from "../src/gameConfig";
import { joinOptions } from "./helpers";

const BOTTOM_ROW = gameConfig.scaleFactor - 1;

describe("death tick", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  /** A started two-player round with the simulation loop stopped. */
  async function frozenRoom() {
    const room = await colyseus.createRoom<GameState>("snake", {});
    const client1 = await colyseus.connectTo(room, joinOptions("p1", "#ff0000"));
    await colyseus.connectTo(room, joinOptions("p2", "#00ff00"));
    client1.send(SnakeRoom.messageTypes.START_GAME);
    await room.waitForMessage(SnakeRoom.messageTypes.START_GAME);
    room.setSimulationInterval(null);
    return room as any;
  }

  function place(
    snake: Snake,
    head: [number, number],
    direction: [number, number],
    tail: Array<[number, number]>
  ) {
    [snake.x, snake.y] = head;
    [snake.direction.x, snake.direction.y] = direction;
    snake.setTail(tail.map(([x, y]) => ({ x, y })));
  }

  /**
   * The survivor heads right from (10,10) into pellet 1 at (11,10), dragging
   * its body along row 10. The victim heads down from (9,9) onto (9,10), where
   * pellet 0 sits under the survivor's freshly moved body, and dies on the
   * pellet's cell. The other pellets are parked along the bottom row.
   */
  function arrangeDeathOnPellet(state: GameState) {
    const [survivor, victim] = state.players.map((player) => player.snake);
    place(survivor, [10, 10], [1, 0], [[9, 10], [8, 10]]);
    place(victim, [9, 9], [0, 1], []);

    state.foodCoordinates.forEach((food, i) => {
      if (i === 0) {
        food.x = 9;
        food.y = 10;
      } else if (i === 1) {
        food.x = 11;
        food.y = 10;
      } else {
        food.x = i;
        food.y = BOTTOM_ROW;
      }
    });

    return { survivor, victim };
  }

  it("gives a snake that dies on a food cell no score and no size", async () => {
    const room = await frozenRoom();
    const state: GameState = room.state;
    const { victim } = arrangeDeathOnPellet(state);

    room.update();

    assert.ok(victim.isDead, "the victim should have died running into the survivor's body");
    assert.strictEqual(victim.score, 0, "the dead snake banked the pellet's points");
    assert.strictEqual(victim.size, 1, "the dead snake grew");
    assert.strictEqual(victim.tail.length, 0, "the dead snake gained a tail segment");
  });

  it("leaves the pellet a dying snake landed on where it was", async () => {
    const room = await frozenRoom();
    const state: GameState = room.state;
    arrangeDeathOnPellet(state);
    const type = state.foodCoordinates[0].type;

    room.update();

    const pellet = state.foodCoordinates[0];
    assert.deepStrictEqual(
      { x: pellet.x, y: pellet.y, type: pellet.type },
      { x: 9, y: 10, type },
      "the pellet under the dead snake was respawned"
    );
  });

  it("still feeds a snake that survives the same tick", async () => {
    const room = await frozenRoom();
    const state: GameState = room.state;
    const { survivor } = arrangeDeathOnPellet(state);

    room.update();

    assert.ok(!survivor.isDead, "the survivor should have survived");
    assert.strictEqual(survivor.size, 2, "the surviving snake did not grow");
    assert.ok(survivor.score > 0, "the surviving snake scored nothing");
    assert.strictEqual(survivor.tail.length, 3, "the surviving snake gained no tail segment");
    assert.notDeepStrictEqual(
      [state.foodCoordinates[1].x, state.foodCoordinates[1].y],
      [11, 10],
      "the eaten pellet was not respawned"
    );
  });
});
