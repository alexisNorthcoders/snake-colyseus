import { Cell, Direction, FoodShape, GameMode, GameShape, PlayerShape, foodScore, modeOf, rulesConfig, tailCells } from "../engine";

/** Everything a human player could see this tick, as plain data. */
export interface BotView {
  grid: { width: number; height: number };
  mode: GameMode;
  // The timer: ticks left in a timed round and the ticks it started with,
  // both 0 in a round with no limit (every endless one).
  ticksLeft: number;
  tickLimit: number;
  // Its score, and its hunger clock: ticks since it last ate, only counted in an endless round.
  self: { head: Cell; body: Cell[]; movedDirection: { x: number; y: number }; score: number; hunger: number };
  others: { head: Cell; body: Cell[]; isDead: boolean }[];
  food: { x: number; y: number; type: string; score: number }[];
}

/** How a bot plays: which way to go next, from what it sees. Pure. */
export type Decider = (view: BotView) => Direction;

/** The part of a game a bot's view is built from: the schema state in the room, plain objects headless. */
export interface ViewedGame extends Pick<GameShape<Cell>, "mode" | "ticksLeft" | "tickLimit"> {
  players: Iterable<PlayerShape<Cell>>;
  foodCoordinates: Iterable<FoodShape>;
}

type SeenSnake = BotView["others"][number];

const seenSnake = ({ snake }: PlayerShape<Cell>): SeenSnake =>
  ({ head: { x: snake.x, y: snake.y }, body: tailCells(snake), isDead: snake.isDead });

/**
 * Where every snake was over the last `delay + 1` ticks, oldest first: what a
 * bot's reaction delay reads from. Record once a tick, before the bots steer;
 * clear at round start.
 */
export class Snapshots {
  private ticks: Map<string, SeenSnake>[] = [];

  constructor(readonly delay: number) {}

  /** Records where every snake is now, forgetting any tick older than `delay` before it. */
  record(game: Pick<ViewedGame, "players">) {
    const snapshot = new Map<string, SeenSnake>();
    for (const player of game.players) snapshot.set(player.id, seenSnake(player));
    this.ticks.push(snapshot);
    if (this.ticks.length > this.delay + 1) this.ticks.shift();
  }

  /** Forgets every tick recorded, as at round start. */
  clear() {
    this.ticks = [];
  }

  /** The player's snake as it was `delay` ticks ago; early in a round, before that many ticks exist, the oldest recorded. */
  past(id: string): SeenSnake | undefined {
    return this.ticks[0]?.get(id);
  }
}

/**
 * The board as player `me` sees it: its own snake and the food as they are
 * now, other snakes as `snapshots` last saw them `delay` ticks ago (or as they
 * are now, if they were never recorded).
 */
export function viewFor(game: ViewedGame, me: PlayerShape<Cell>, snapshots: Snapshots): BotView {
  const { head, body } = seenSnake(me);
  const mode = modeOf(game.mode);
  const clocked = mode === "timed" && game.tickLimit !== undefined;
  return {
    grid: { width: rulesConfig.scaleFactor, height: rulesConfig.scaleFactor },
    mode,
    ticksLeft: clocked ? game.ticksLeft ?? 0 : 0,
    tickLimit: clocked ? game.tickLimit : 0,
    self: { head, body, movedDirection: { ...me.snake.movedDirection }, score: me.snake.score, hunger: me.snake.hunger },
    others: [...game.players].filter((p) => p !== me).map((p) => snapshots.past(p.id) ?? seenSnake(p)),
    food: [...game.foodCoordinates].map((f) => ({ x: f.x, y: f.y, type: f.type, score: foodScore[f.type] }))
  };
}
