import { foodScore, rulesConfig } from "../engine";
import { BotView } from "./view";

/**
 * Encoder v2: a bot's view as a picture of the board around its head, then
 * the mode. Every brain trained on v2 depends on exactly this layout, in this
 * order, with this scaling, so v2 is frozen: any change to it is a v3.
 *
 * The picture is a 9×9 window centred on the head, in the snake's own frame,
 * like v1's: "up" in the window is the way it last moved (right, if it hasn't
 * moved), and left and right are turns from that. The window wraps round the
 * board as the rules do. Each cell is read as a board cell `up` steps ahead
 * (negative: behind) and `across` steps to the right (negative: left) of the
 * head, `up` and `across` each running from -4 to 4.
 *
 * Four channels of 81 numbers, one after the other, each row by row: the first
 * row is the front of the window (`up` 4), from its left (`across` -4) to its
 * right, and the last row is the back (`up` -4). So a cell's place in its
 * channel is `(4 - up) * 9 + (across + 4)`, and the centre (the head) is 40.
 *
 *   0-80   Self: 1 for a cell of the snake's own body, the head excluded (the
 *          centre is always the head), else 0.
 *  81-161  Enemies: 1 for a cell of a live enemy's head or body, else 0. Dead
 *          snakes are free, as they are in the rules.
 * 162-242  Food: a pellet's score ÷ the highest food score, so 0 to 1, else 0.
 * 243-323  Enemy heads: 1 for a cell of a live enemy's head, else 0.
 *
 *    324   The mode: 0 timed, 1 endless.
 *    325   Ticks left ÷ the round's total ticks; 1 in a round with no limit.
 *    326   Its hunger clock ÷ `hungerTicks`, at most 1 (it's draining from 1
 *          on); 0 in a timed round, where there's no hunger.
 *    327   The drains its score can take before it starves (score ÷
 *          `starveDrain`, rounded down) ÷ 10, at most 1; 1 in a timed round,
 *          where it can't.
 *
 * The last four are v1's last group, with the same scaling. Other snakes are
 * as the view shows them, so with the reaction delay applied.
 *
 * Deterministic, and pure as far as a caller can tell: it reuses one scratch
 * board between calls, which is safe since a call never yields part way.
 */
export const ENCODER_V2_VERSION = 2;

/** How many numbers the encoder gives: 4 channels of the window, and the 4 mode inputs. */
export const ENCODER_V2_SIZE = 328;

/** How far the window reaches from the head in each direction: it's 2 × this + 1 cells across. */
const REACH = 4;
const SPAN = 2 * REACH + 1;
const CELLS = SPAN * SPAN;

const SELF = 0;
const ENEMIES = CELLS;
const FOOD = 2 * CELLS;
const HEADS = 3 * CELLS;
const MODE = 4 * CELLS;

const maxFoodScore = Math.max(...Object.values(foodScore));

/** Drains of score that count as plenty: that many or more encode as 1. */
const PLENTY_OF_DRAINS = 10;

/** Scratch for the four channels over the whole board, reused between calls; only ever grown. */
let board = new Float64Array(0);

/**
 * `view` encoded as `ENCODER_V2_SIZE` numbers, written into `out` if it's
 * given (so a trainer can reuse one array) and returned.
 */
export function encodeV2(view: BotView, out: number[] = new Array<number>(ENCODER_V2_SIZE)): number[] {
  const { width, height } = view.grid;
  const area = width * height;
  const { head, body } = view.self;

  // Straight, and right of it, as board vectors.
  const moved = view.self.movedDirection;
  const [fx, fy] = moved.x === 0 && moved.y === 0 ? [1, 0] : [moved.x, moved.y];
  const [rx, ry] = [-fy, fx];

  // Channel `c` of the board, at (x, y): the four are laid end to end.
  if (board.length < 4 * area) board = new Float64Array(4 * area);
  else board.fill(0, 0, 4 * area);
  const at = (c: number, x: number, y: number) => c * area + y * width + x;

  for (let i = 0; i < body.length; i++) board[at(0, body[i].x, body[i].y)] = 1;
  for (let o = 0; o < view.others.length; o++) {
    const other = view.others[o];
    if (other.isDead) continue;
    board[at(1, other.head.x, other.head.y)] = 1;
    board[at(3, other.head.x, other.head.y)] = 1;
    for (let i = 0; i < other.body.length; i++) board[at(1, other.body[i].x, other.body[i].y)] = 1;
  }
  for (let i = 0; i < view.food.length; i++) {
    const food = view.food[i];
    board[at(2, food.x, food.y)] = food.score / maxFoodScore;
  }

  for (let row = 0; row < SPAN; row++) {
    for (let col = 0; col < SPAN; col++) {
      const up = REACH - row;
      const across = col - REACH;
      const x = (((head.x + up * fx + across * rx) % width) + width) % width;
      const y = (((head.y + up * fy + across * ry) % height) + height) % height;
      const cell = row * SPAN + col;
      out[SELF + cell] = board[at(0, x, y)];
      out[ENEMIES + cell] = board[at(1, x, y)];
      out[FOOD + cell] = board[at(2, x, y)];
      out[HEADS + cell] = board[at(3, x, y)];
    }
  }

  const endless = view.mode === "endless";
  out[MODE] = endless ? 1 : 0;
  out[MODE + 1] = !endless && view.tickLimit > 0 ? view.ticksLeft / view.tickLimit : 1;
  out[MODE + 2] = endless ? Math.min(view.self.hunger / rulesConfig.hungerTicks, 1) : 0;
  out[MODE + 3] = endless
    ? Math.min(Math.max(Math.floor(view.self.score / rulesConfig.starveDrain), 0) / PLENTY_OF_DRAINS, 1)
    : 1;

  return out;
}
