/*
 * The values the rules are played by: the board, the pellets, their scores
 * and the spawn table. Changing any of them changes the game, so bump
 * `RULES_VERSION` with it.
 */

export const rulesConfig = {
    // The board is `scaleFactor` cells on a side.
    scaleFactor: 20,
    // Pellets on the board at once.
    foodStorage: 20,
}

/**
 * One cell per quadrant, each ten cells from its neighbours: on a board that
 * wraps round, that is as far apart as two snakes can start.
 */
export const startingPositions = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }]

export const foodScore: { [key: string]: number } = {
    redApple: 10,
    greenApple: 20,
    yellowApple: 15,
    banana: 25,
    cherry: 30,
    chili: 50,
    strawberry: 40
};

export interface Cell {
    x: number;
    y: number;
}

/** Board cells are keyed as strings so they can live in a Set. */
export const cellKey = (x: number, y: number) => `${x},${y}`;

/**
 * The spawn cells for a round of `count` snakes, read from the table starting
 * at `offset` and wrapping round. Consecutive entries of a table with no
 * duplicates are always distinct, so this only has to refuse a round with
 * more snakes than there are cells.
 */
export const spawnCells = (count: number, offset: number): Cell[] => {
    if (count > startingPositions.length) {
        throw new Error(`${count} snakes but only ${startingPositions.length} spawn cells`);
    }

    return Array.from({ length: count }, (_, i) =>
        startingPositions[(offset + i) % startingPositions.length]);
};
