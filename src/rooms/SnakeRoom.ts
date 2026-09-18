import { Room, Client } from "@colyseus/core";
import { GameState, Player, Snake, Food, PlayerColors } from "./schema/SnakeState";
import { Direction, directionMap } from "../contants";
import { cellKey, foodScore, gameConfig, generateFoodCoordinates, pickFreeCell, randomFoodType, spawnCells, startingPositions } from "../gameConfig";

export class SnakeRoom extends Room<GameState> {
  // Add type definition for your message types
  static messageTypes = {
    MOVE: "move",
    START_GAME: "startGame",
    GAME_STARTED: "gameStarted",
    NEW_PLAYER: "newPlayer",
    GAME_OVER: "gameOver",
    UPDATE_PLAYER: "updatePlayer",
    PING: "ping",
    PONG: "pong"
  };

  maxClients = 4;

  // Server-only, not synced: where the next round starts reading the spawn
  // table. Clients never needed it.
  private spawnOffset = 0;

  // Server-only: players who left during the current round, kept so their
  // score still appears in the final rankings. Cleared at each round start.
  private roundLeavers: { id: string; name: string; score: number }[] = [];

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.backgroundNumber = Math.floor(Math.random() * 91) + 1;

    generateFoodCoordinates().forEach((placement) => {
      const food = new Food();
      food.x = placement.x;
      food.y = placement.y;
      food.index = placement.index;
      food.type = placement.type;
      this.state.foodCoordinates.push(food);
    });

    // Patches are flushed by hand at the end of each simulation tick (below),
    // so turn off Colyseus's independent 20 Hz patch timer. Left on, a move
    // computed at tick time waits 0–50 ms for the next beat of that unrelated
    // clock before it ships, which reads as stutter against a 125 ms tick.
    this.patchRate = null;

    // Run a single simulation loop for the room's lifetime; update() itself
    // is a no-op while hasGameStarted is false. Previously this was (re)started
    // on every "startGame" message, and since Colyseus's setSimulationInterval
    // doesn't clear the previous interval, each "Play Again" click left the
    // old loop running alongside the new one — stacking update() calls per
    // tick and causing snakes to desync/speed up after repeated rounds.
    this.setSimulationInterval((deltaTime) => {
      this.update();

      // Outside update()'s "no round in progress" early return on purpose:
      // this is now the room's only flush, so the lobby needs it too — without
      // it a joining player and mid-lobby colour changes would never reach the
      // other clients. It also drains the afterNextPatch broadcast queue.
      this.broadcastPatch();
    }, 1000 / gameConfig.fps);

    // Use the static message types
    this.onMessage(SnakeRoom.messageTypes.MOVE, (client, data) => {
      const player = this.state.players.find(p => p.id === client.sessionId);

      if (player && player.snake && !player.snake.isDead) {
        // hasOwn, not a plain lookup: a key like "toString" would otherwise
        // find a prototype method and write undefined into the synced state.
        if (!Object.hasOwn(directionMap, data.key)) return;
        const turn = directionMap[data.key as Direction];

        // Reversing would step the head straight back onto the body, so a
        // reversal is ignored rather than left to kill the snake.
        const moved = player.snake.movedDirection;
        if (turn.x === -moved.x && turn.y === -moved.y) return;

        player.snake.direction.x = turn.x;
        player.snake.direction.y = turn.y;
      }
    });

    this.onMessage(SnakeRoom.messageTypes.START_GAME, (client) => {
      console.log("[SnakeRoom] Received startGame message from", client.sessionId);

      if (this.state.hasGameStarted) {
        // A round is already in progress (e.g. two clients both clicked
        // "Play Again" before either received the gameStarted broadcast) —
        // ignore the duplicate request instead of resetting mid-round state.
        return;
      }

      this.state.hasGameStarted = true;
      this.roundLeavers = [];
      this.state.aliveCount = this.state.players.length; // Set initial alive count

      // Handed out together so no two snakes share a cell; the offset rolls
      // on so the same seat doesn't start in the same corner every round.
      const spawns = spawnCells(this.state.players.length, this.spawnOffset);
      this.spawnOffset = (this.spawnOffset + spawns.length) % startingPositions.length;

      this.state.players.forEach((player, i) => {
        const position = spawns[i];
        player.snake.x = position.x;
        player.snake.y = position.y;

        // Set initial direction to right
        player.snake.direction.x = 1;
        player.snake.direction.y = 0;
        player.snake.movedDirection = { x: 1, y: 0 };

        player.snake.isDead = false;
        player.snake.size = 1;
        player.snake.score = 0;
        player.snake.setTail([]);
      });

      console.log("[SnakeRoom] All snake positions initialized");

      // Broadcast game start after positions are set
      this.broadcast(SnakeRoom.messageTypes.GAME_STARTED, {}, { afterNextPatch: true });
    });

    this.onMessage(SnakeRoom.messageTypes.NEW_PLAYER, (client, message) => {
      // Same guards as a normal join: a repeated message must not add the
      // same player twice, and the room can't exceed its capacity.
      if (this.state.players.some(p => p.id === client.sessionId)) return;
      if (this.state.players.length >= this.maxClients) return;

      const { name, colours } = message.player;
      // Convert the raw colors object to the expected format
      const formattedOptions = {
        name,
        colours: {
          head: colours.head,
          body: colours.body
        }
      };
      this.onJoin(client, formattedOptions);
    });

    this.onMessage(SnakeRoom.messageTypes.UPDATE_PLAYER, (client, message) => {
      const player = this.state.players.find(p => p.id === client.sessionId);
      if (!player || this.state.hasGameStarted) return;

      if (message.colours?.head) player.colours.head = message.colours.head;
      if (message.colours?.body) player.colours.body = message.colours.body;
      if (message.colours?.eyes) player.colours.eyes = message.colours.eyes;
    });

    // Add ping handler
    this.onMessage(SnakeRoom.messageTypes.PING, (client) => {
      client.send(SnakeRoom.messageTypes.PONG, { timestamp: Date.now() });
    });
  }

  onJoin(client: Client, options: any) {
    const colors = new PlayerColors(
      options.colours.head,
      options.colours.body,
      options.colours.eyes
    );

    const player = new Player(
      client.sessionId,
      options.name,
      colors
    );

    // Set the id explicitly
    player.id = client.sessionId;

    // If player has a snake, set its playerId too
    if (player.snake) {
      player.snake.playerId = client.sessionId;
    }

    console.log("[SnakeRoom] Player joined:", {
      id: player.id,
      sessionId: client.sessionId,
      name: player.name
    });

    // Arriving mid-round, the joiner sits it out: aliveCount was fixed at
    // round start, so a live late snake would break the win check. The next
    // round start revives everyone.
    if (this.state.hasGameStarted) player.snake.isDead = true;

    this.state.players.push(player);
  }

  onLeave(client: Client) {
    const index = this.state.players.findIndex(p => p.id === client.sessionId);
    if (index !== -1) {
      const player = this.state.players[index];
      if (!player.snake.isDead && this.state.hasGameStarted) {
        this.state.aliveCount--;
      }
      if (this.state.hasGameStarted) {
        this.roundLeavers.push({ id: player.id, name: player.name, score: player.snake.score });
      }
      this.state.players.splice(index, 1);

      // A leaver can be the one that leaves a single snake standing.
      if (this.state.hasGameStarted && this.state.aliveCount <= 1) this.endRound();
    }
  }

  /**
   * One tick, resolved simultaneously: every live snake moves, then collisions
   * are judged against where everyone ended up, then the survivors eat. Judging
   * each snake as it moved made the outcome depend on join order and let two
   * heads meeting on one cell slip past each other.
   */
  update() {
    if (!this.state.hasGameStarted) return;

    const live = this.state.players.filter((player) => player.snake && !player.snake.isDead);

    const moves = new Map(live.map((player) => {
      const from = cellKey(player.snake.x, player.snake.y);
      this.moveSnake(player.snake);
      return [player, { from, to: cellKey(player.snake.x, player.snake.y) }];
    }));

    const dying = this.findCrashed(moves);

    // A snake that died this tick doesn't eat on its way out: the points
    // would still count towards the final ranking, and the pellet it landed
    // on stays on the board.
    live.forEach((player) => {
      if (!dying.has(player)) this.checkFoodCollision(player);
    });

    this.handleDeaths(dying);
  }

  private moveSnake(snake: Snake) {
    const prevX = snake.x;
    const prevY = snake.y;

    snake.x += snake.direction.x;
    snake.y += snake.direction.y;
    snake.movedDirection = { x: snake.direction.x, y: snake.direction.y };

    if (snake.x >= gameConfig.scaleFactor) {
      snake.x = 0;
    } else if (snake.x < 0) {
      snake.x = gameConfig.scaleFactor - 1;
    }

    if (snake.y >= gameConfig.scaleFactor) {
      snake.y = 0;
    } else if (snake.y < 0) {
      snake.y = gameConfig.scaleFactor - 1;
    }

    snake.advanceTail({ x: prevX, y: prevY });
  }

  private checkFoodCollision(player: Player) {
    const food = this.state.foodCoordinates.find(food =>
      food.x === player.snake.x && food.y === player.snake.y
    );

    if (food) {
      player.snake.size++;
      player.snake.score += foodScore[food.type];
      player.snake.growTail();

      this.respawnFood(food);
    }
  }

  /**
   * Moves an eaten pellet to a free cell, in place. Splicing it out and pushing
   * a replacement would shift every later index, making the patch carry the
   * whole food array instead of the three fields that actually changed.
   *
   * A pellet that lands on a snake or on another pellet is a ghost the player
   * can never eat, since food collision only ever finds the first entry for a
   * cell. When there is nowhere free left at all — the snakes and the other
   * pellets between them covering every cell on the board — the pellet stays
   * where it is, under the head that just ate it, and becomes eatable again as
   * soon as the snake's tail moves off it.
   */
  private respawnFood(food: Food) {
    const occupied = this.occupiedCells(food);
    const cell = pickFreeCell((x, y) => occupied.has(cellKey(x, y)));

    if (!cell) return;

    food.x = cell.x;
    food.y = cell.y;
    food.type = randomFoodType();
  }

  /**
   * Every cell a new pellet has to stay off: snake heads, snake bodies and the
   * pellets already on the board. `ignore` leaves out the pellet being moved,
   * whose own cell is up for grabs again.
   *
   * Dead snakes count: their bodies stay on the board until the next round, so
   * a pellet underneath one would look just as unreachable as a real ghost.
   */
  private occupiedCells(ignore?: Food) {
    const occupied = new Set<string>();

    this.state.players.forEach((player) => {
      const snake = player.snake;
      if (!snake) return;

      occupied.add(cellKey(snake.x, snake.y));
      snake.tail.forEach((segment) => occupied.add(cellKey(segment.x, segment.y)));
    });

    this.state.foodCoordinates.forEach((food) => {
      if (food !== ignore) occupied.add(cellKey(food.x, food.y));
    });

    return occupied;
  }

  /**
   * The live snakes, given with the cell each head moved from and to this
   * tick, that crashed: landed on a body segment (their own or anyone else's),
   * on another head, or swapped cells with another head — two tailless snakes
   * side by side would otherwise cross without ever sharing a cell. Every
   * occupied cell is counted once up front, so the cost follows the total
   * number of segments rather than players squared.
   *
   * Dead snakes aren't counted: their bodies stay on the board but can be
   * passed through.
   */
  private findCrashed(moves: Map<Player, { from: string; to: string }>) {
    const bodies = new Set<string>();
    const heads = new Map<string, number>();
    const steps = new Set<string>();

    moves.forEach(({ from, to }, { snake }) => {
      heads.set(to, (heads.get(to) ?? 0) + 1);
      steps.add(`${from}>${to}`);
      snake.tail.forEach((segment) => bodies.add(cellKey(segment.x, segment.y)));
    });

    const crashed = new Set<Player>();
    moves.forEach(({ from, to }, player) => {
      const swapped = from !== to && steps.has(`${to}>${from}`);
      if (bodies.has(to) || (heads.get(to) ?? 0) > 1 || swapped) crashed.add(player);
    });
    return crashed;
  }

  /**
   * Kills everyone in `dying` before deciding whether the round is over, so
   * snakes that die together all miss out on the win — ending the round on the
   * first of them would crown one that is about to die too.
   */
  private handleDeaths(dying: Set<Player>) {
    if (dying.size === 0) return;

    dying.forEach((player) => (player.snake.isDead = true));
    this.state.aliveCount -= dying.size;

    if (this.state.aliveCount <= 1) this.endRound();
  }

  /** Announces the winner (if a snake is left) and the full ranking, and ends the round. */
  private endRound() {
    const winner = this.state.players.find(p => !p.snake.isDead);
    const rankings = [
      ...this.state.players.map(p => ({ id: p.id, name: p.name, score: p.snake.score })),
      ...this.roundLeavers
    ].sort((a, b) => b.score - a.score);
    this.roundLeavers = [];

    this.broadcast(SnakeRoom.messageTypes.GAME_OVER, {
      winnerId: winner?.id,
      rankings
    });

    this.state.hasGameStarted = false;
  }
}
