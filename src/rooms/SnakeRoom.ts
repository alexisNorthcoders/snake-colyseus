import { Room, Client } from "@colyseus/core";
import { GameState, Player, Snake, Food, PlayerColors, Coordinates } from "./schema/SnakeState";
import { Direction, directionMap } from "../contants";
import { foodScore, gameConfig, generateFoodCoordinates, startingPositions } from "../gameConfig";
// Removed import of Player from './schema/Player'

export class SnakeRoom extends Room<GameState> {
  // Add type definition for your message types
  static messageTypes = {
    MOVE: "move",
    START_GAME: "startGame",
    GAME_STARTED: "gameStarted",
    NEW_PLAYER: "newPlayer",
    GAME_OVER: "gameOver",
    PING: "ping",
    PONG: "pong"
  };

  maxClients = 1;

  onCreate(options: any) {
    this.setState(new GameState());

    const initialFood = generateFoodCoordinates();
    initialFood.forEach(([x, y, index, type]) => {
      const food = new Food();
      food.x = x;
      food.y = y;
      food.index = index;
      food.type = type;
      this.state.foodCoordinates.push(food);
    });

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

      });

      console.log("[SnakeRoom] All snake positions initialized");

      this.setSimulationInterval((deltaTime) => {

        this.update();
      }, 1000 / gameConfig.fps); // Use your configured FPS

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
      this.checkFoodCollision(player);
    });
  }

  private checkFoodCollision(player: Player) {
    const foodIndex = this.state.foodCoordinates.findIndex(food =>
      food.x === player.snake.x && food.y === player.snake.y
    );

    if (foodIndex !== -1) {

      player.snake.size++;
      const food = this.state.foodCoordinates[foodIndex];
      player.snake.score += foodScore[food.type];

      const lastSegment = player.snake.tail[player.snake.tail.length - 1];
      const tailX = lastSegment ? lastSegment.x : player.snake.x;
      const tailY = lastSegment ? lastSegment.y : player.snake.y;
      player.snake.tail.push(new Coordinates(tailX, tailY));

      this.state.foodCoordinates.splice(foodIndex, 1);
      const newFood = new Food();
      const [x, y, index, type] = generateFoodCoordinates()[0];
      newFood.x = x;
      newFood.y = y;
      newFood.index = index;
      newFood.type = type;
      this.state.foodCoordinates.push(newFood);
    }
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
      // Game over - find winner
      const winner = this.state.players.find(p => !p.snake.isDead);
      if (winner) {
        // Use the static message type for broadcast
        this.broadcast(SnakeRoom.messageTypes.GAME_OVER, { winnerId: winner.id });
      }
      this.state.hasGameStarted = false;
    }
  }
}