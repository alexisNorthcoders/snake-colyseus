import { Direction, DirectionVector, directionMap } from "../contants";
import { Cell, cellKey, foodScore, gameConfig } from "../gameConfig";
import { pickFreeCell, randomFoodType } from "./food";
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

export interface FoodShape extends Cell {
    index: number;
    type: string;
}

/** The part of the game state a tick reads and changes. */
export interface GameShape<C extends Cell> {
    players: Iterable<PlayerShape<C>>;
    foodCoordinates: Iterable<FoodShape>;
    aliveCount: number;
}

/**
 * What a tick did: which players died, and whether the round is now over.
 * The next slice turns this into events with death causes.
 */
export interface TickReport {
    died: string[];
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

    const dying = findCrashed(moves);

    // A snake that died this tick doesn't eat on its way out: the points
    // would still count towards the final ranking, and the pellet it landed
    // on stays on the board.
    live.forEach((player) => {
        if (!dying.has(player)) eat(game, player.snake, rng, newCell);
    });

    return killAll(game, dying);
};

const moveSnake = <C extends Cell>(snake: SnakeShape<C>) => {
    const prevX = snake.x;
    const prevY = snake.y;

    snake.x += snake.direction.x;
    snake.y += snake.direction.y;
    snake.movedDirection = { x: snake.direction.x, y: snake.direction.y };

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

    advanceTail(snake, { x: prevX, y: prevY });
};

const eat = <C extends Cell>(game: GameShape<C>, snake: SnakeShape<C>, rng: Rng, newCell: NewCell<C>) => {
    const food = [...game.foodCoordinates].find(food =>
        food.x === snake.x && food.y === snake.y
    );

    if (food) {
        snake.size++;
        snake.score += foodScore[food.type];
        growTail(snake, newCell);

        respawnFood(game, food, rng);
    }
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

/**
 * The live snakes, given with the cell each head moved from and to this
 * tick, that crashed: landed on a body segment (their own or anyone else's),
 * on another head, or swapped cells with another head — two tailless snakes
 * side by side would otherwise cross without ever sharing a cell. Every
 * occupied cell is counted once up front, so the cost follows the total
 * number of segments rather than players squared.
 *
 * Dead snakes aren't counted: their bodies stay on the board but can be
 * passed through.
 */
const findCrashed = <P extends PlayerShape<Cell>>(moves: Map<P, { from: string; to: string }>) => {
    const bodies = new Set<string>();
    const heads = new Map<string, number>();
    const steps = new Set<string>();

    moves.forEach(({ from, to }, { snake }) => {
        heads.set(to, (heads.get(to) ?? 0) + 1);
        steps.add(`${from}>${to}`);
        for (let i = 0; i < snake.tail.length; i++) {
            bodies.add(cellKey(snake.tail[i].x, snake.tail[i].y));
        }
    });

    const crashed = new Set<P>();
    moves.forEach(({ from, to }, player) => {
        const swapped = from !== to && steps.has(`${to}>${from}`);
        if (bodies.has(to) || (heads.get(to) ?? 0) > 1 || swapped) crashed.add(player);
    });
    return crashed;
};

/**
 * Kills everyone in `dying` before deciding whether the round is over, so
 * snakes that die together all miss out on the win — ending the round on the
 * first of them would crown one that is about to die too. A tick where nobody
 * dies never ends the round.
 */
const killAll = (game: GameShape<Cell>, dying: Set<PlayerShape<Cell>>): TickReport => {
    if (dying.size === 0) return { died: [], roundOver: false };

    dying.forEach((player) => (player.snake.isDead = true));
    game.aliveCount -= dying.size;

    return { died: [...dying].map((player) => player.id), roundOver: isRoundOver(game) };
};
