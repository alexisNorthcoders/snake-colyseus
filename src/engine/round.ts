import { Cell, spawnCells, startingPositions } from "../gameConfig";
import { NewCell, setTail } from "./tail";
import { GameShape, SnakeShape, isRoundOver } from "./tick";

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
        setTail(snake, [], newCell);
    });

    return (offset + spawns.length) % startingPositions.length;
};

/** The snakes start moving: everyone still in the game is counted alive. */
export const beginPlay = (game: Pick<GameShape<Cell>, "players" | "aliveCount">) => {
    game.aliveCount = [...game.players].length;
};

/**
 * Takes a leaving player's snake out of play mid-round, and says whether that
 * leaves the round over. A snake that was already dead isn't counted twice.
 */
export const removeSnake = (
    game: Pick<GameShape<Cell>, "aliveCount">,
    snake: Pick<SnakeShape<Cell>, "isDead">
): { roundOver: boolean } => {
    if (!snake.isDead) {
        snake.isDead = true;
        game.aliveCount--;
    }
    return { roundOver: isRoundOver(game) };
};
