import { Cell, Direction, FoodShape, PlayerShape, foodScore, rulesConfig, tailCells } from "../engine";

/** Everything a human player could see this tick, as plain data. */
export interface BotView {
  grid: { width: number; height: number };
  self: { head: Cell; body: Cell[]; movedDirection: { x: number; y: number } };
  others: { head: Cell; body: Cell[]; isDead: boolean }[];
  food: { x: number; y: number; type: string; score: number }[];
}

/** How a bot plays: which way to go next, from what it sees. Pure. */
export type Decider = (view: BotView) => Direction;

/** The part of a game a bot's view is built from: the schema state in the room, plain objects headless. */
export interface ViewedGame {
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
  return {
    grid: { width: rulesConfig.scaleFactor, height: rulesConfig.scaleFactor },
    self: { head, body, movedDirection: { ...me.snake.movedDirection } },
    others: [...game.players].filter((p) => p !== me).map((p) => snapshots.past(p.id) ?? seenSnake(p)),
    food: [...game.foodCoordinates].map((f) => ({ x: f.x, y: f.y, type: f.type, score: foodScore[f.type] }))
  };
}
