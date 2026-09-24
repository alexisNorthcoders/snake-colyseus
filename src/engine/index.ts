/**
 * The game's rules, on plain objects: nothing in here knows about the room,
 * the schema or Colyseus (a test holds it to that), so a whole round can be
 * played headless and replayed from its seed plus the turns made each tick.
 *
 * This is the engine's one way in: anything outside the engine imports it
 * from here, never from its individual files. Helpers only the engine uses
 * aren't re-exported here.
 */

/**
 * Bump this whenever a rule changes, so a recorded game is only ever replayed
 * under the rules it was played by.
 */
export const RULES_VERSION = 1;

// The values the rules are played by, and the board's cells.
export type { Cell } from "./config";
export { cellKey, foodScore, rulesConfig, startingPositions } from "./config";
export type { GameMode } from "./mode";
export { modeOf } from "./mode";
export type { Direction, DirectionVector } from "./direction";
export { directionMap } from "./direction";

// Starting a round, and a player leaving it.
export { beginPlay, dealRound, removeFromPlay } from "./round";

// Playing it, one tick at a time.
export type {
    AteEvent,
    DeathCause,
    DiedEvent,
    FoodShape,
    GameShape,
    PlayerShape,
    SnakeShape,
    TickEvent,
    TickReport
} from "./tick";
export { tick, turn } from "./tick";

// The food, and the seeded generator every random rule draws from.
export type { FoodPlacement } from "./food";
export { layFood } from "./food";
export type { Rng } from "./rng";
export { mulberry32 } from "./rng";

// A snake's tail: reading its cells, and keeping a schema one in step.
export type { NewCell, TailRing } from "./tail";
export { advanceTail, growTail, newPlainCell, setTail, tailCells } from "./tail";
