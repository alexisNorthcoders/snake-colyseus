import { Direction, directionMap } from "./contants";
import { Cell, cellKey } from "./gameConfig";

/** Everything a human player could see this tick, as plain data. */
export interface BotView {
  grid: { width: number; height: number };
  self: { head: Cell; body: Cell[]; movedDirection: { x: number; y: number } };
  others: { head: Cell; body: Cell[]; isDead: boolean }[];
  food: { x: number; y: number; type: string; score: number }[];
}

/** How a bot plays. The placeholder policy has nothing to tune yet. */
export interface BotProfile {
  name: string;
}

export const defaultBotProfile: BotProfile = { name: "Bot" };

const directions = Object.keys(directionMap) as Direction[];

/**
 * Placeholder policy: keep going straight, and turn only when the next cell
 * is fatal. Pure: the same view and profile always give the same answer.
 */
export function decide(view: BotView, _profile: BotProfile): Direction {
  const { head, movedDirection: moved } = view.self;
  const { width, height } = view.grid;

  // Dead snakes can be passed through; live heads are treated as walls since
  // they may well be where that snake ends up.
  const blocked = new Set<string>(view.self.body.map(({ x, y }) => cellKey(x, y)));
  view.others.filter((other) => !other.isDead).forEach((other) => {
    blocked.add(cellKey(other.head.x, other.head.y));
    other.body.forEach(({ x, y }) => blocked.add(cellKey(x, y)));
  });

  const fatal = (d: Direction) => {
    const { x, y } = directionMap[d];
    const nx = (head.x + x + width) % width;
    const ny = (head.y + y + height) % height;
    return blocked.has(cellKey(nx, ny));
  };

  const straight = directions.find((d) => {
    const v = directionMap[d];
    return v.x === moved.x && v.y === moved.y;
  }) ?? "r";

  if (!fatal(straight)) return straight;

  const turn = directions.find((d) => {
    const v = directionMap[d];
    const reversal = v.x === -moved.x && v.y === -moved.y;
    return !reversal && d !== straight && !fatal(d);
  });
  return turn ?? straight;
}
