export const directionMap: Record<Direction, DirectionVector> = {
    "l": { x: -1, y: 0 },
    "r": { x: 1, y: 0 },
    "u": { x: 0, y: -1 },
    "d": { x: 0, y: 1 },
}

export type Direction = "l" | "r" | "u" | "d";

interface DirectionVector {
    x: number;
    y: number;
}