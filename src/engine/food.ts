import { Cell, cellKey, foodScore, gameConfig } from "../gameConfig";
import { Rng } from "./rng";

export interface FoodPlacement extends Cell {
    index: number;
    type: string;
}

// Derived from foodScore rather than listed again: a type that appears in one
// list but not the other scores NaN when it is eaten.
const foodTypes = Object.keys(foodScore);

export const randomFoodType = (rng: Rng): string =>
    foodTypes[Math.floor(rng() * foodTypes.length)];

/**
 * How many random cells to try before giving up on guessing. Every miss is a
 * cell already taken, so on a board that is mostly empty the first guess
 * almost always lands; the budget only matters once the snakes have grown.
 */
const MAX_PROBES = 30;

/**
 * Picks a free cell for a single pellet, asking `isOccupied` about each
 * candidate and drawing from `rng`. Returns null when the board has no free
 * cell left at all.
 */
export const pickFreeCell = (
    isOccupied: (x: number, y: number) => boolean,
    rng: Rng
): Cell | null => {
    const size = gameConfig.scaleFactor;

    for (let probe = 0; probe < MAX_PROBES; probe++) {
        const x = Math.floor(rng() * size);
        const y = Math.floor(rng() * size);
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

    return free[Math.floor(rng() * free.length)];
};

/**
 * The board's opening stock of pellets, one per cell: each placement is fed
 * back in as occupied, so no two pellets share a cell.
 */
export const generateFoodCoordinates = (rng: Rng): FoodPlacement[] => {
    const placements: FoodPlacement[] = [];
    const placed = new Set<string>();

    for (let index = 0; index < gameConfig.foodStorage; index++) {
        const cell = pickFreeCell((x, y) => placed.has(cellKey(x, y)), rng);
        if (!cell) break;

        placed.add(cellKey(cell.x, cell.y));
        placements.push({ x: cell.x, y: cell.y, index, type: randomFoodType(rng) });
    }

    return placements;
};
