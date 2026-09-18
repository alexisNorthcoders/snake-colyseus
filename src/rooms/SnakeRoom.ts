import { Room, Client } from "@colyseus/core";
import { GameState, Player, Snake, Food, PlayerColors, Coordinates } from "./schema/SnakeState";
import { Direction, directionMap } from "../contants";
import { cellKey, foodScore, gameConfig, generateFoodCoordinates, pickFreeCell, randomFoodType, startingPositions } from "../gameConfig";
// Removed import of Player from './schema/Player'

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

  maxClients = 2;

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
        // Update snake direction based on key
        switch (data.key) {
          case 'u': // up
            player.snake.direction.x = 0;
            player.snake.direction.y = -1;
            break;
          case 'd': // down
            player.snake.direction.x = 0;
            player.snake.direction.y = 1;
            break;
          case 'l': // left
            player.snake.direction.x = -1;
            player.snake.direction.y = 0;
            break;
          case 'r': // right
            player.snake.direction.x = 1;
            player.snake.direction.y = 0;
            break;
        }
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
      this.state.aliveCount = this.state.players.length; // Set initial alive count

      // Initialize snake positions for all players
      this.state.players.forEach((player) => {

        // Set initial position and direction
        const position = this.getNextStartPosition();
        player.snake.x = position.x;
        player.snake.y = position.y;

        // Set initial direction to right
        player.snake.direction.x = 1;
        player.snake.direction.y = 0;

        player.snake.isDead = false;
        player.snake.size = 1;
        player.snake.score = 0;
        player.snake.tail.splice(0, player.snake.tail.length);

      });

      console.log("[SnakeRoom] All snake positions initialized");

      // Broadcast game start after positions are set
      this.broadcast(SnakeRoom.messageTypes.GAME_STARTED, {}, { afterNextPatch: true });
    });

    this.onMessage(SnakeRoom.messageTypes.NEW_PLAYER, (client, message) => {
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

    this.state.players.push(player);
  }

  onLeave(client: Client) {
    const index = this.state.players.findIndex(p => p.id === client.sessionId);
    if (index !== -1) {
      const player = this.state.players[index];
      if (!player.snake.isDead && this.state.hasGameStarted) {
        this.state.aliveCount--;
      }
      this.state.players.splice(index, 1);
    }
  }

  private getNextStartPosition() {
    // Get next available starting position
    const position = startingPositions[this.state.nextPositionIndex];
    this.state.nextPositionIndex = (this.state.nextPositionIndex + 1) % startingPositions.length;
    return position;
  }

  update() {
    if (!this.state.hasGameStarted) return;

    this.state.players.forEach((player) => {
      const snake = player.snake;

      if (!snake || snake.isDead) return;

      const prevX = snake.x;
      const prevY = snake.y;

      snake.x += snake.direction.x;
      snake.y += snake.direction.y;

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

      if (snake.tail.length > 0) {
        // Move tail segments backwards
        for (let i = snake.tail.length - 1; i > 0; i--) {
          snake.tail[i].x = snake.tail[i - 1].x;
          snake.tail[i].y = snake.tail[i - 1].y;
        }

        // First segment moves to previous head position
        snake.tail[0].x = prevX;
        snake.tail[0].y = prevY;
      }

      this.checkSnakeCollision(player);

      // A snake that died this tick doesn't eat on its way out: the points
      // would still count towards the final ranking, and the pellet it landed
      // on stays on the board.
      if (!snake.isDead) this.checkFoodCollision(player);
    });
  }

  private checkFoodCollision(player: Player) {
    const food = this.state.foodCoordinates.find(food =>
      food.x === player.snake.x && food.y === player.snake.y
    );

    if (food) {
      player.snake.size++;
      player.snake.score += foodScore[food.type];

      const lastSegment = player.snake.tail[player.snake.tail.length - 1];
      const tailX = lastSegment ? lastSegment.x : player.snake.x;
      const tailY = lastSegment ? lastSegment.y : player.snake.y;
      player.snake.tail.push(new Coordinates(tailX, tailY));

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

  private checkSnakeCollision(player: Player) {
    // Check self collision with tail
    const selfCollision = player.snake.tail.some(segment =>
      segment.x === player.snake.x && segment.y === player.snake.y
    );

    if (selfCollision) {
      this.handleSnakeDeath(player);
      return;
    }

    // Check collision with other snakes
    this.state.players.forEach(otherPlayer => {
      if (otherPlayer.id === player.id ||
        otherPlayer.snake.isDead ||
        (otherPlayer.snake.type === "server")) {
        return;
      }

      // Check collision with other snake's tail
      const otherSnakeCollision = otherPlayer.snake.tail.some(segment =>
        segment.x === player.snake.x && segment.y === player.snake.y
      );

      if (otherSnakeCollision) {
        this.handleSnakeDeath(player);
      }
    });
  }

  private handleSnakeDeath(player: Player) {
    player.snake.isDead = true;
    this.state.aliveCount--;

    if (this.state.aliveCount <= 1) {
      // Game over - round has ended, whether or not a survivor remains
      const winner = this.state.players.find(p => !p.snake.isDead);
      const rankings = [...this.state.players]
        .sort((a, b) => b.snake.score - a.snake.score)
        .map(p => ({ id: p.id, name: p.name, score: p.snake.score }));

      this.broadcast(SnakeRoom.messageTypes.GAME_OVER, {
        winnerId: winner?.id,
        rankings
      });

      this.state.hasGameStarted = false;
    }
  }
}