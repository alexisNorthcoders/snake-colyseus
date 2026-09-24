import { Cell, cellKey, foodScore, rulesConfig } from "./config";
import { Direction, DirectionVector, directionMap } from "./direction";
import { FoodPlacement, pickFreeCell, randomFoodType } from "./food";
import { GameMode } from "./mode";
import { Rng } from "./rng";
import { NewCell, TailRing, advanceTail, growTail } from "./tail";

/**
 * A snake as the rules see it: the schema `Snake` in the live room, a plain
 * object in a headless game. Changed in place, never copied.
 */
export interface SnakeShape<C extends Cell> extends TailRing<C>, Cell {
    // The key last pressed, changed field by field since the schema syncs it.
    direction: Cell;
    // The direction the snake last actually moved in, which a turn is checked
    // against: two keys inside one tick could otherwise add up to a reversal.
    movedDirection: DirectionVector;
    size: number;
    score: number;
    isDead: boolean;
}

export interface PlayerShape<C extends Cell> {
    id: string;
    snake: SnakeShape<C>;
}

/** A pellet on the board: the schema `Food` in the room, a placement in a headless game. */
export type FoodShape = FoodPlacement;

/** The part of the game state a tick reads and changes. */
export interface GameShape<C extends Cell> {
    players: Iterable<PlayerShape<C>>;
    foodCoordinates: Iterable<FoodShape>;
    aliveCount: number;
    // Fixed when the game is created; a game without one is timed. No rule
    // reads it yet.
    mode?: GameMode;
}

/** How a snake died. `body` is another snake's body; running into your own is `self`. */
export type DeathCause = "self" | "body" | "head-on";

/** A survivor ate `food`, as it was before it respawned, gaining `score` points. */
export interface AteEvent {
    kind: "ate";
    player: string;
    food: Omit<FoodShape, "index">;
    score: number;
}

/** A snake died of `cause`, running into `by` unless it was its own doing. */
export interface DiedEvent {
    kind: "died";
    player: string;
    cause: DeathCause;
    by?: string;
}

export type TickEvent = AteEvent | DiedEvent;

/**
 * What a tick did, as events in the order it did them (every pellet eaten,
 * then every death), and whether the round is now over.
 */
export interface TickReport {
    events: TickEvent[];
    roundOver: boolean;
}

/** The one place that decides a round is over: one snake or none left alive. */
export const isRoundOver = (game: Pick<GameShape<Cell>, "aliveCount">) => game.aliveCount <= 1;

/** Points the snake in direction `key`, ignoring a turn that would reverse it. */
export const turn = (snake: Pick<SnakeShape<Cell>, "direction" | "movedDirection">, key: Direction) => {
    const to = directionMap[key];

    // Reversing would step the head straight back onto the body, so a
    // reversal is ignored rather than left to kill the snake.
    const moved = snake.movedDirection;
    if (to.x === -moved.x && to.y === -moved.y) return;

    snake.direction.x = to.x;
    snake.direction.y = to.y;
};

/**
 * One tick, resolved simultaneously: every live snake moves, then collisions
 * are judged against where everyone ended up, then the survivors eat. Judging
 * each snake as it moved made the outcome depend on join order and let two
 * heads meeting on one cell slip past each other.
 *
 * `newCell` makes the segment a snake grows by: a schema `Coordinates` in the
 * room, a plain cell in a headless game.
 */
export const tick = <C extends Cell>(game: GameShape<C>, rng: Rng, newCell: NewCell<C>): TickReport => {
    const live = [...game.players].filter((player) => !player.snake.isDead);

    const moves = new Map(live.map((player) => {
        const from = cellKey(player.snake.x, player.snake.y);
        moveSnake(player.snake);
        return [player, { from, to: cellKey(player.snake.x, player.snake.y) }];
    }));

    const crashes = findCrashed(moves);

    // A snake that died this tick doesn't eat on its way out: the points
    // would still count towards the final ranking, and the pellet it landed
    // on stays on the board.
    const meals: AteEvent[] = [];
    live.forEach((player) => {
        if (crashes.has(player)) return;
        const ate = eat(game, player, rng, newCell);
        if (ate) meals.push(ate);
    });

    const deaths = killAll(game, crashes);
    return { events: [...meals, ...deaths.events], roundOver: deaths.roundOver };
};

const moveSnake = <C extends Cell>(snake: SnakeShape<C>) => {
    const prevX = snake.x;
    const prevY = snake.y;

    snake.x += snake.direction.x;
    snake.y += snake.direction.y;
    snake.movedDirection = { x: snake.direction.x, y: snake.direction.y };

    if (snake.x >= rulesConfig.scaleFactor) {
        snake.x = 0;
    } else if (snake.x < 0) {
        snake.x = rulesConfig.scaleFactor - 1;
    }

    if (snake.y >= rulesConfig.scaleFactor) {
        snake.y = 0;
    } else if (snake.y < 0) {
        snake.y = rulesConfig.scaleFactor - 1;
    }

    advanceTail(snake, { x: prevX, y: prevY });
};

const eat = <C extends Cell>(
    game: GameShape<C>,
    { id, snake }: PlayerShape<C>,
    rng: Rng,
    newCell: NewCell<C>
): AteEvent | undefined => {
    const food = [...game.foodCoordinates].find(food =>
        food.x === snake.x && food.y === snake.y
    );

    if (!food) return;

    // Copied before the pellet respawns in place.
    const eaten = { type: food.type, x: food.x, y: food.y };
    const score = foodScore[food.type];

    snake.size++;
    snake.score += score;
    growTail(snake, newCell);

    respawnFood(game, food, rng);

    return { kind: "ate", player: id, food: eaten, score };
};

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
const respawnFood = (game: GameShape<Cell>, food: FoodShape, rng: Rng) => {
    const occupied = occupiedCells(game, food);
    const cell = pickFreeCell((x, y) => occupied.has(cellKey(x, y)), rng);

    if (!cell) return;

    food.x = cell.x;
    food.y = cell.y;
    food.type = randomFoodType(rng);
};

/**
 * Every cell a new pellet has to stay off: snake heads, snake bodies and the
 * pellets already on the board. `ignore` leaves out the pellet being moved,
 * whose own cell is up for grabs again.
 *
 * Dead snakes count: their bodies stay on the board until the next round, so
 * a pellet underneath one would look just as unreachable as a real ghost.
 */
const occupiedCells = (game: GameShape<Cell>, ignore?: FoodShape) => {
    const occupied = new Set<string>();

    for (const { snake } of game.players) {
        occupied.add(cellKey(snake.x, snake.y));
        for (let i = 0; i < snake.tail.length; i++) {
            occupied.add(cellKey(snake.tail[i].x, snake.tail[i].y));
        }
    }

    for (const food of game.foodCoordinates) {
        if (food !== ignore) occupied.add(cellKey(food.x, food.y));
    }

    return occupied;
};

/** How a snake crashed, and into whom unless it was its own body. */
interface Crash<P> {
    cause: DeathCause;
    by?: P;
}

/**
 * The live snakes, given in player order with the cell each head moved from
 * and to this tick, that crashed, and how: `head-on` when the head landed on
 * another head or swapped cells with one — two tailless snakes side by side
 * would otherwise cross without ever sharing a cell — else `body` when it
 * landed on another snake's body, else `self` on its own. Where more than one
 * other snake qualifies, `by` is the first in player order. Every occupied
 * cell is counted once up front, so the cost follows the total number of
 * segments rather than players squared.
 *
 * Dead snakes aren't counted: their bodies stay on the board but can be
 * passed through, and so never show up as `by`.
 */
const findCrashed = <P extends PlayerShape<Cell>>(moves: Map<P, { from: string; to: string }>) => {
    // Each cell's snakes, in player order since `moves` is walked in it. A
    // head-on merges two of these lists, so `firstOther` re-sorts.
    const bodies = new Map<string, P[]>();
    const heads = new Map<string, P[]>();
    const steps = new Map<string, P[]>();
    const add = (cells: Map<string, P[]>, key: string, player: P) => {
        const here = cells.get(key);
        if (!here) cells.set(key, [player]);
        else if (here[here.length - 1] !== player) here.push(player);
    };

    moves.forEach(({ from, to }, player) => {
        add(heads, to, player);
        add(steps, `${from}>${to}`, player);
        const { tail } = player.snake;
        for (let i = 0; i < tail.length; i++) add(bodies, cellKey(tail[i].x, tail[i].y), player);
    });

    const order = new Map([...moves.keys()].map((player, i) => [player, i]));
    const firstOther = (player: P, ...groups: (P[] | undefined)[]) => groups
        .flatMap((group) => group ?? [])
        .filter((other) => other !== player)
        .sort((a, b) => order.get(a)! - order.get(b)!)[0];

    const crashed = new Map<P, Crash<P>>();
    moves.forEach(({ from, to }, player) => {
        const headOn = firstOther(player, heads.get(to), steps.get(`${to}>${from}`));
        const body = firstOther(player, bodies.get(to));

        if (headOn) crashed.set(player, { cause: "head-on", by: headOn });
        else if (body) crashed.set(player, { cause: "body", by: body });
        else if (bodies.get(to)?.includes(player)) crashed.set(player, { cause: "self" });
    });
    return crashed;
};

/**
 * Kills everyone in `crashes` before deciding whether the round is over, so
 * snakes that die together all miss out on the win — ending the round on the
 * first of them would crown one that is about to die too. A tick where nobody
 * dies never ends the round.
 */
const killAll = <P extends PlayerShape<Cell>>(
    game: GameShape<Cell>,
    crashes: Map<P, Crash<P>>
): { events: DiedEvent[]; roundOver: boolean } => {
    if (crashes.size === 0) return { events: [], roundOver: false };

    const events: DiedEvent[] = [];
    crashes.forEach(({ cause, by }, player) => {
        player.snake.isDead = true;
        events.push({ kind: "died", player: player.id, cause, ...(by && { by: by.id }) });
    });
    game.aliveCount -= crashes.size;

    return { events, roundOver: isRoundOver(game) };
};
