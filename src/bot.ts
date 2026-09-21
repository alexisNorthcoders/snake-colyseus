import { Direction, directionMap } from "./contants";
import { Cell, cellKey } from "./gameConfig";

/** Everything a human player could see this tick, as plain data. */
export interface BotView {
  grid: { width: number; height: number };
  self: { head: Cell; body: Cell[]; movedDirection: { x: number; y: number } };
  others: { head: Cell; body: Cell[]; isDead: boolean }[];
  food: { x: number; y: number; type: string; score: number }[];
}

/** How a bot plays. */
export interface BotProfile {
  name: string;
  /** Pellets further than this (toroidal, in cells) are ignored. */
  visionRadius: number;
  /** Reserved for a smarter bot: rookie ignores it and can walk into dead ends. */
  avoidSelfTrap: boolean;
}

export const rookieBotProfile: BotProfile = { name: "Bot", visionRadius: 8, avoidSelfTrap: false };

const directions = Object.keys(directionMap) as Direction[];

/**
 * Hunts the best `score / distance` pellet in view, never steps onto a live
 * body or next to a live enemy head (a head-on kills both snakes), and with
 * nothing in view keeps straight. Pure and deterministic: no RNG.
 */
export function decide(view: BotView, profile: BotProfile): Direction {
  const { head, movedDirection: moved } = view.self;
  const { width, height } = view.grid;
  const wrap = (x: number, y: number): Cell => ({ x: (x + width) % width, y: (y + height) % height });
  const step = (from: Cell, d: Direction) => wrap(from.x + directionMap[d].x, from.y + directionMap[d].y);

  // Dead snakes are pass-through, matching the room's collision rules.
  const blocked = new Set<string>(view.self.body.map(({ x, y }) => cellKey(x, y)));
  const danger = new Set<string>();
  view.others.filter((other) => !other.isDead).forEach((other) => {
    blocked.add(cellKey(other.head.x, other.head.y));
    other.body.forEach(({ x, y }) => blocked.add(cellKey(x, y)));
    directions.forEach((d) => {
      const next = step(other.head, d);
      danger.add(cellKey(next.x, next.y));
    });
  });

  const straight = directions.find((d) => directionMap[d].x === moved.x && directionMap[d].y === moved.y) ?? "r";
  const options = directions.filter((d) => directionMap[d].x !== -moved.x || directionMap[d].y !== -moved.y);
  const isSafe = (d: Direction) => {
    const { x, y } = step(head, d);
    return !blocked.has(cellKey(x, y)) && !danger.has(cellKey(x, y));
  };
  const freeBeyond = (d: Direction) => {
    const cell = step(head, d);
    return directions.filter((n) => {
      const { x, y } = step(cell, n);
      return !blocked.has(cellKey(x, y));
    }).length;
  };

  // The safe step to fall back on: straight if it's safe, else the roomiest turn.
  const fallback = (): Direction => {
    if (options.includes(straight) && isSafe(straight)) return straight;
    let best: Direction | undefined;
    let bestRoom = -1;
    options.filter(isSafe).forEach((d) => {
      const room = freeBeyond(d);
      if (room > bestRoom) { best = d; bestRoom = room; }
    });
    return best ?? straight;
  };

  const pellets = new Map<string, number>();
  view.food.forEach((f) => {
    const dx = Math.abs(f.x - head.x);
    const dy = Math.abs(f.y - head.y);
    const distance = Math.min(dx, width - dx) + Math.min(dy, height - dy);
    if (distance > 0 && distance <= profile.visionRadius) pellets.set(cellKey(f.x, f.y), Math.max(pellets.get(cellKey(f.x, f.y)) ?? 0, f.score));
  });
  if (pellets.size === 0) return fallback();

  // BFS over free cells, remembering which first step reached each cell.
  const firstStep = new Map<string, Direction>();
  const dist = new Map<string, number>();
  let frontier: Cell[] = [];
  options.forEach((d) => {
    const cell = step(head, d);
    const key = cellKey(cell.x, cell.y);
    if (blocked.has(key) || dist.has(key)) return;
    dist.set(key, 1);
    firstStep.set(key, d);
    frontier.push(cell);
  });
  while (frontier.length > 0) {
    const next: Cell[] = [];
    frontier.forEach((cell) => {
      const key = cellKey(cell.x, cell.y);
      directions.forEach((d) => {
        const n = step(cell, d);
        const nKey = cellKey(n.x, n.y);
        if (blocked.has(nKey) || dist.has(nKey) || (n.x === head.x && n.y === head.y)) return;
        dist.set(nKey, dist.get(key)! + 1);
        firstStep.set(nKey, firstStep.get(key)!);
        next.push(n);
      });
    });
    frontier = next;
  }

  let target: Direction | undefined;
  let bestValue = -1;
  pellets.forEach((score, key) => {
    const d = dist.get(key);
    if (d === undefined || score / d <= bestValue) return;
    bestValue = score / d;
    target = firstStep.get(key);
  });

  return target !== undefined && isSafe(target) ? target : fallback();
}
