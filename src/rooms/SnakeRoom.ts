import { Room, Client } from "@colyseus/core";
import { GameState, Phase, Player, Snake, PlayerColors, newCoordinates, newFood } from "./schema/SnakeState";
import { BotView, Snapshots, rookie, rookieBotProfile, viewFor } from "../bots";
import { gameConfig } from "../gameConfig";
import {
  DiedEvent,
  Direction,
  Rng,
  beginPlay,
  dealRound,
  directionMap,
  layFood,
  modeOf,
  mulberry32,
  removeFromPlay,
  tick,
  turn as turnSnake,
  type RoundEndReason
} from "../engine";

// Which phase may follow which. Start moves lobby to countdown, and the
// countdown's last tick moves it on to playing. "ended" is terminal: rooms are
// single-use, and Play Again means a fresh room.
const transitions: Record<Phase, Phase[]> = {
  lobby: ["countdown"],
  countdown: ["playing", "lobby"],
  playing: ["ended"],
  ended: []
};

const defaultBotReactionTicks = 2;
const maxBotReactionTicks = 4;

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

  // Server-only: how each player died this round, by id, for the final
  // rankings. Cleared at each round start.
  private roundDeaths = new Map<string, Pick<DiedEvent, "cause" | "by">>();

  // Server-only: the running countdown's timer, cleared when it reaches 0.
  private countdownTimer?: { clear(): void };

  // Server-only: how many ticks old the bot's view of other snakes is. Fixed at creation.
  private botReactionTicks = defaultBotReactionTicks;

  // Server-only: every random choice the game rules make (not cosmetics like the background)
  // draws from `rng`, derived from `state.seed` at room creation, so the same seed lays out the same food.
  private rng!: Rng;

  // Server-only: where every snake was over the last few ticks, for the bot's reaction delay.
  // Made once `botReactionTicks` is known; cleared at each round start.
  private snapshots!: Snapshots;

  /** The only place the phase changes. Returns false, doing nothing, if `to` can't follow the current phase. */
  private transition(to: Phase) {
    if (!transitions[this.state.phase].includes(to)) return false;
    this.state.phase = to;
    return true;
  }

  /** Ends the countdown: the snakes move from the next tick on, and a timed round's clock starts. */
  private beginRound() {
    this.countdownTimer?.clear();
    this.snapshots.clear();
    this.transition("playing");
    beginPlay(this.state, Math.round(gameConfig.roundSeconds * 1000 / this.state.tickMs));
  }

  /** Lobby to countdown: locks the room, deals out spawns and starts the clock. Does nothing outside the lobby. */
  private startCountdown() {
    if (!this.transition("countdown")) {
      // A countdown or round is already in progress or over (e.g. a
      // duplicate click before the gameStarted broadcast arrived, or a
      // stale request after the round ended) — ignore it instead of
      // resetting state.
      return;
    }

    // Matchmaking must never place anyone into a room that has started.
    // Never unlocked: the room is single-use.
    this.lock();

    this.roundLeavers = [];
    this.roundDeaths.clear();

    this.spawnOffset = dealRound(this.state, this.spawnOffset, newCoordinates);

    console.log("[SnakeRoom] All snake positions initialized");

    // Broadcast start after positions are set
    this.broadcast(SnakeRoom.messageTypes.GAME_STARTED, {}, { afterNextPatch: true });

    this.state.countdown = gameConfig.countdownSeconds;
    if (this.state.countdown <= 0) return this.beginRound();

    this.countdownTimer = this.clock.setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) this.beginRound();
    }, gameConfig.countdownTickMs);
  }

  /** Points the snake in direction `key`, ignoring anything that isn't a direction. The engine ignores reversals. */
  private turn(snake: Snake, key: unknown) {
    // hasOwn, not a plain lookup: a key like "toString" would otherwise
    // find a prototype method and write undefined into the synced state.
    if (typeof key !== "string" || !Object.hasOwn(directionMap, key)) return;
    turnSnake(snake, key as Direction);
  }

  /**
   * Seats the room's one bot. Only ever called for a vsBot room, which is
   * locked from creation: `spawnCells` tops out at 4 snakes, so a bot must
   * never sit in a room that can still take humans.
   */
  private seatBot() {
    // The colon can't appear in a session id, so this never collides with one.
    const id = `bot:${this.roomId}`;
    const bot = new Player(id, rookieBotProfile.name, new PlayerColors("#8a8a8a", "#5c5c5c", "#ffffff"));
    bot.isBot = true;
    this.state.players.push(bot);
  }

  /** The board as `me` sees it, with the bot's reaction delay. */
  private botView(me: Player): BotView {
    return viewFor(this.state, me, this.snapshots);
  }

  /** Asks each live bot which way to go; a bot that throws keeps its current direction. */
  private steerBots() {
    this.snapshots.record(this.state);
    this.state.players.forEach((player) => {
      if (!player.isBot || player.snake.isDead) return;
      try {
        this.turn(player.snake, rookie(this.botView(player)));
      } catch (error) {
        console.error("[SnakeRoom] Bot decision failed:", error);
      }
    });
  }

  private get inRound() {
    return this.state.phase === "playing";
  }

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.mode = modeOf(options?.mode);
    const speed = options?.speed;
    const ticksPerSecond = typeof speed === "number" && Number.isFinite(speed)
      ? Math.min(gameConfig.maxSpeed, Math.max(gameConfig.minSpeed, Math.round(speed)))
      : gameConfig.fps;
    this.state.tickMs = 1000 / ticksPerSecond;
    this.state.backgroundNumber = Math.floor(Math.random() * 91) + 1;
    const seed = options?.seed;
    this.state.seed = Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32
      ? seed
      : Math.floor(Math.random() * 2 ** 32);
    this.rng = mulberry32(this.state.seed);

    // A private match against a bot: locked before anyone can be matched in.
    if (options?.vsBot === true) {
      this.lock();
      const ticks = options.botReactionTicks;
      if (typeof ticks === "number" && Number.isFinite(ticks)) {
        this.botReactionTicks = Math.min(maxBotReactionTicks, Math.max(0, Math.round(ticks)));
      }
      this.seatBot();
    }
    this.snapshots = new Snapshots(this.botReactionTicks);

    layFood(this.state, this.rng, newFood);

    // Patches are flushed by hand at the end of each simulation tick (below),
    // so turn off Colyseus's independent 20 Hz patch timer. Left on, a move
    // computed at tick time waits 0–50 ms for the next beat of that unrelated
    // clock before it ships, which reads as stutter against a 125 ms tick.
    this.patchRate = null;

    // Run a single simulation loop for the room's lifetime; update() itself
    // is a no-op while no round is playing. Previously this was (re)started
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
    }, this.state.tickMs);

    // Use the static message types
    this.onMessage(SnakeRoom.messageTypes.MOVE, (client, data) => {
      const player = this.state.players.find(p => p.id === client.sessionId);

      if (player && player.snake && !player.snake.isDead) {
        this.turn(player.snake, data.key);
      }
    });

    this.onMessage(SnakeRoom.messageTypes.START_GAME, (client) => {
      console.log("[SnakeRoom] Received startGame message from", client.sessionId);
      this.startCountdown();
    });

    this.onMessage(SnakeRoom.messageTypes.NEW_PLAYER, (client, message) => {
      // Same guards as a normal join: a repeated message must not add the
      // same player twice, and the room can't exceed its capacity.
      if (this.state.phase !== "lobby") return;
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
      if (!player || this.state.phase !== "lobby") return;

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

    // A full room has no one left to wait for; same path as pressing Start,
    // and a no-op unless the room is still in the lobby.
    // The bot isn't a client, so it doesn't count towards a full room.
    if (this.state.players.filter(p => !p.isBot).length >= this.maxClients) this.startCountdown();
  }

  onLeave(client: Client) {
    const index = this.state.players.findIndex(p => p.id === client.sessionId);
    if (index !== -1) {
      const [player] = this.state.players.splice(index, 1);
      // Leaving isn't a death cause, so a leaver keeps none from earlier in the round.
      this.roundDeaths.delete(player.id);
      if (!this.inRound) return;

      this.roundLeavers.push({ id: player.id, name: player.name, score: player.snake.score });

      // A leaver can be the one that leaves a single snake standing. Taken
      // out of the synced list first, so marking the snake dead never syncs.
      const result = removeFromPlay(this.state, player.snake);
      if (result.roundOver) this.endRound(result);
    }
  }

  /** One tick: the bots steer, then the engine runs the rules and says whether the round is over. */
  update() {
    if (!this.inRound) return;

    this.steerBots();

    const report = tick(this.state, this.rng, newCoordinates);
    const { events } = report;
    events.forEach((event) => {
      if (event.kind !== "died") return;
      const { kind, player, ...death } = event;
      this.roundDeaths.set(player, death);
    });
    if (report.roundOver) this.endRound(report);
  }

  /**
   * Announces why the round ended and the winner the engine named in its
   * report (if there is one: see `winnerOf`), with the full ranking, and ends
   * the round. The reason goes in the message because it reaches the client
   * before the patch with the final ticks left and deaths. Each snake that
   * died says how, and into whom; the snakes alive at the end and anyone who
   * left mid-round have no cause.
   */
  private endRound({ reason, winnerId }: { reason?: RoundEndReason; winnerId?: string }) {
    const rankings = [
      ...this.state.players.map(p => ({ id: p.id, name: p.name, score: p.snake.score, ...this.roundDeaths.get(p.id) })),
      ...this.roundLeavers
    ].sort((a, b) => b.score - a.score);
    this.roundLeavers = [];

    // Left out, not sent as undefined, when nobody won.
    this.broadcast(SnakeRoom.messageTypes.GAME_OVER, {
      reason,
      ...(winnerId !== undefined && { winnerId }),
      rankings
    });

    this.transition("ended");
  }
}
