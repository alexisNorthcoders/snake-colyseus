import { Cell, foodScore, rulesConfig } from "../engine";
import { BotView } from "./view";

/**
 * Encoder v1: a bot's view as the fixed list of numbers a brain reads. Every
 * brain trained on v1 depends on exactly these features, in this order, with
 * this scaling, so v1 is frozen: any change to it is a v2.
 *
 * Everything is in the snake's own frame. "Straight" is the way it last moved
 * (right, if it hasn't moved), and left and right are turns from that. An
 * offset to another cell takes the shortest way round the wrapping board, the
 * positive way when both are as short (so it runs from -half + 1 to half a
 * board), is split into how far forward (negative: behind) and how far to the
 * right (negative: left) the cell is, and is scaled by half the board.
 *
 *  0-8   Blocked, for left, straight and right in turn, the cells 1, 2 and 3
 *        steps that way: 1 if it's the snake's own body or a live enemy's
 *        head or body, else 0. Dead snakes are free, as they are in the rules.
 *  9-11  Head-on risk, for left, straight and right: 1 if the next cell that
 *        way is beside a live enemy's head, else 0.
 * 12-14  Best pellet, the one with the highest score ÷ distance (the shortest
 *        Manhattan distance round the board, with no vision limit, the first
 *        listed winning a tie): its forward and sideways offsets and its
 *        score ÷ the highest food score. All 0 with no pellet.
 * 15-17  Nearest live enemy head (the first listed winning a tie): its forward
 *        and sideways offsets and 1, or all 0 with no live enemy.
 *    18  Its length, head included, ÷ (board width + height), at most 1.
 *    19  The mode: 0 timed, 1 endless.
 *    20  Ticks left ÷ the round's total ticks; 1 in a round with no limit.
 *    21  Its hunger clock ÷ `hungerTicks`, at most 1 (it's draining from 1 on);
 *        0 in a timed round, where there's no hunger.
 *    22  The drains its score can take before it starves (score ÷ `starveDrain`,
 *        rounded down) ÷ 10, at most 1; 1 in a timed round, where it can't.
 *
 * Deterministic, and pure as far as a caller can tell: it reuses one scratch
 * board between calls, which is safe since a call never yields part way.
 */
export const ENCODER_VERSION = 1;

/** How many numbers the encoder gives. */
export const ENCODER_SIZE = 23;

const maxFoodScore = Math.max(...Object.values(foodScore));

// Where each group of features starts in the output.
const BLOCKED = 0;
const HEAD_ON = 9;
const PELLET = 12;
const ENEMY = 15;
const LENGTH = 18;
const MODE = 19;

/** How far along each turn the blocked features look. */
const LOOKAHEAD = 3;

/** Drains of score that count as plenty: that many or more encode as 1. */
const PLENTY_OF_DRAINS = 10;

/** Scratch for the board's blocked cells, reused between calls; only ever grown. */
let blocked = new Uint8Array(0);

/**
 * `view` encoded as `ENCODER_SIZE` numbers, written into `out` if it's given
 * (so a trainer can reuse one array) and returned.
 */
export function encode(view: BotView, out: number[] = new Array<number>(ENCODER_SIZE)): number[] {
  const { width, height } = view.grid;
  const { head, body } = view.self;
  const live = view.others.filter((other) => !other.isDead);

  // Straight, and right of it (left is its negative), as board vectors.
  const moved = view.self.movedDirection;
  const [fx, fy] = moved.x === 0 && moved.y === 0 ? [1, 0] : [moved.x, moved.y];
  const [rx, ry] = [-fy, fx];

  // The shortest way from `from` to `to` round a board `size` cells long, scaled by half of it.
  const offset = (from: number, to: number, size: number) => {
    const d = (((to - from) % size) + size) % size;
    return (d > size / 2 ? d - size : d) / (size / 2);
  };
  // `|| 0` so a zero is never -0.
  const forward = (x: number, y: number) => (offset(head.x, x, width) * fx + offset(head.y, y, height) * fy) || 0;
  const sideways = (x: number, y: number) => (offset(head.x, x, width) * rx + offset(head.y, y, height) * ry) || 0;
  // The shortest Manhattan distance between two cells, round the board.
  const distance = (a: Cell, b: Cell) => {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.min(dx, width - dx) + Math.min(dy, height - dy);
  };
  const wrapX = (x: number) => ((x % width) + width) % width;
  const wrapY = (y: number) => ((y % height) + height) % height;

  if (blocked.length < width * height) blocked = new Uint8Array(width * height);
  else blocked.fill(0, 0, width * height);
  const block = ({ x, y }: Cell) => (blocked[y * width + x] = 1);
  body.forEach(block);
  live.forEach((other) => {
    block(other.head);
    other.body.forEach(block);
  });

  // Left, straight and right, as board vectors.
  const turns = [[-rx, -ry], [fx, fy], [rx, ry]];
  turns.forEach(([tx, ty], t) => {
    for (let steps = 1; steps <= LOOKAHEAD; steps++) {
      out[BLOCKED + t * LOOKAHEAD + steps - 1] = blocked[wrapY(head.y + ty * steps) * width + wrapX(head.x + tx * steps)];
    }
    const next = { x: wrapX(head.x + tx), y: wrapY(head.y + ty) };
    out[HEAD_ON + t] = live.some((other) => distance(other.head, next) === 1) ? 1 : 0;
  });

  // A pellet on the head has just been eaten, so it isn't counted.
  let pellet: BotView["food"][number] | undefined;
  let bestValue = 0;
  view.food.forEach((food) => {
    const d = distance(food, head);
    if (d > 0 && food.score / d > bestValue) {
      pellet = food;
      bestValue = food.score / d;
    }
  });
  out[PELLET] = pellet ? forward(pellet.x, pellet.y) : 0;
  out[PELLET + 1] = pellet ? sideways(pellet.x, pellet.y) : 0;
  out[PELLET + 2] = pellet ? pellet.score / maxFoodScore : 0;

  let enemy: Cell | undefined;
  let nearest = Infinity;
  live.forEach((other) => {
    const d = distance(other.head, head);
    if (d < nearest) {
      enemy = other.head;
      nearest = d;
    }
  });
  out[ENEMY] = enemy ? forward(enemy.x, enemy.y) : 0;
  out[ENEMY + 1] = enemy ? sideways(enemy.x, enemy.y) : 0;
  out[ENEMY + 2] = enemy ? 1 : 0;

  out[LENGTH] = Math.min((body.length + 1) / (width + height), 1);

  const endless = view.mode === "endless";
  out[MODE] = endless ? 1 : 0;
  out[MODE + 1] = !endless && view.tickLimit > 0 ? view.ticksLeft / view.tickLimit : 1;
  out[MODE + 2] = endless ? Math.min(view.self.hunger / rulesConfig.hungerTicks, 1) : 0;
  out[MODE + 3] = endless
    ? Math.min(Math.max(Math.floor(view.self.score / rulesConfig.starveDrain), 0) / PLENTY_OF_DRAINS, 1)
    : 1;

  return out;
}
