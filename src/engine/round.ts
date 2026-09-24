import { Cell, spawnCells, startingPositions } from "./config";
import { NewCell, setTail } from "./tail";
import { GameShape, SnakeShape, TickReport, isRoundOver, roundResult } from "./tick";

/**
 * Starts a round: hands every snake a spawn cell, read from the table at
 * `offset`, and resets it to a fresh one-cell snake heading right. Returns the
 * offset the next round starts from, rolled on so the same seat doesn't start
 * in the same corner every round.
 *
 * Nobody is counted in yet: players can still leave during the countdown, so
 * that waits for `beginPlay`.
 */
export const dealRound = <C extends Cell>(
    game: Pick<GameShape<C>, "players">,
    offset: number,
    newCell: NewCell<C>
): number => {
    const players = [...game.players];

    // Handed out together so no two snakes share a cell.
    const spawns = spawnCells(players.length, offset);

    players.forEach(({ snake }, i) => {
        snake.x = spawns[i].x;
        snake.y = spawns[i].y;

        // A turn during the countdown overwrites this and becomes the first move.
        snake.direction.x = 1;
        snake.direction.y = 0;
        snake.movedDirection = { x: 1, y: 0 };

        snake.isDead = false;
        snake.size = 1;
        snake.score = 0;
        snake.hunger = 0;
        setTail(snake, [], newCell);
    });

    return (offset + spawns.length) % startingPositions.length;
};

/**
 * The snakes start moving: everyone still in the game is counted alive, and a
 * timed game's clock starts at `tickLimit` ticks. An endless game ignores it;
 * its snakes' hunger clocks start from the 0 `dealRound` left them at.
 */
export const beginPlay = (
    game: Pick<GameShape<Cell>, "players" | "aliveCount" | "mode" | "ticksLeft">,
    tickLimit?: number
) => {
    game.aliveCount = [...game.players].length;
    if (game.mode !== "endless" && tickLimit !== undefined) game.ticksLeft = tickLimit;
};

/**
 * Takes a leaving player's snake out of play mid-round, and says whether that
 * leaves the round over, and to whom. A snake that was already dead isn't
 * counted twice.
 */
export const removeFromPlay = (
    game: Pick<GameShape<Cell>, "aliveCount" | "players">,
    snake: Pick<SnakeShape<Cell>, "isDead">
): Omit<TickReport, "events"> => {
    if (!snake.isDead) {
        snake.isDead = true;
        game.aliveCount--;
    }
    return roundResult(game, isRoundOver(game));
};
