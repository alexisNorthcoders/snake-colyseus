export const gameConfig = {
    side: 800,
    leftSectionSize: 200,
    fps: 8,
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

export interface FoodPlacement extends Cell {
    index: number;
    type: string;
}

/** Board cells are keyed as strings so they can live in a Set. */
export const cellKey = (x: number, y: number) => `${x},${y}`;

// Derived from foodScore rather than listed again: a type that appears in one
// list but not the other scores NaN when it is eaten.
const foodTypes = Object.keys(foodScore);

export const randomFoodType = (): string =>
    foodTypes[Math.floor(Math.random() * foodTypes.length)];

/**
 * How many random cells to try before giving up on guessing. Every miss is a
 * cell already taken, so on a board that is mostly empty the first guess
 * almost always lands; the budget only matters once the snakes have grown.
 */
const MAX_PROBES = 30;

/**
 * Picks a free cell for a single pellet, asking `isOccupied` about each
 * candidate. Returns null when the board has no free cell left at all.
 */
export const pickFreeCell = (
    isOccupied: (x: number, y: number) => boolean,
    random: () => number = Math.random
): Cell | null => {
    const size = gameConfig.scaleFactor;

    for (let probe = 0; probe < MAX_PROBES; probe++) {
        const x = Math.floor(random() * size);
        const y = Math.floor(random() * size);
        if (!isOccupied(x, y)) return { x, y };
    }

    // Crowded board: guessing keeps hitting the snakes, so collect what is
    // actually left and pick from that. This is also what makes "there is
    // nowhere to put it" an answer rather than an endless loop.
    const free: Cell[] = [];
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (!isOccupied(x, y)) free.push({ x, y });
        }
    }

    if (free.length === 0) return null;

    return free[Math.floor(random() * free.length)];
};

/**
 * The board's opening stock of pellets, one per cell: each placement is fed
 * back in as occupied, so no two pellets share a cell.
 */
export const generateFoodCoordinates = (): FoodPlacement[] => {
    const placements: FoodPlacement[] = [];
    const placed = new Set<string>();

    for (let index = 0; index < gameConfig.foodStorage; index++) {
        const cell = pickFreeCell((x, y) => placed.has(cellKey(x, y)));
        if (!cell) break;

        placed.add(cellKey(cell.x, cell.y));
        placements.push({ x: cell.x, y: cell.y, index, type: randomFoodType() });
    }

    return placements;
};

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
