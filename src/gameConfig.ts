export const gameConfig = {
    side: 800,
    leftSectionSize: 200,
    fps: 8,
    // Bounds for a room's requested speed, in ticks per second.
    minSpeed: 4,
    maxSpeed: 15,
    // Seconds counted down after Start before snakes move (0 = no countdown),
    // and the real time between counts; tests shorten both.
    countdownSeconds: 3,
    countdownTickMs: 1000,
    foodStorage: 20,
    backgroundColour: 'black',
    scaleFactor: 20,
    gridSize: 800 / 20,
    waitingRoom: {
        waitingRoomMessage: 'bla bla',
        backgroundColour: 'black'
    }
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
