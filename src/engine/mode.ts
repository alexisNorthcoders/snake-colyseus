/**
 * The two kinds of round a game can be played as, fixed when the game is
 * created. `timed` is the default: anything that isn't a mode reads as timed.
 */
const gameModes = ["timed", "endless"] as const;
export type GameMode = (typeof gameModes)[number];

/** `value` as a mode, or `timed` when it isn't one. */
export const modeOf = (value: unknown): GameMode =>
    gameModes.includes(value as GameMode) ? (value as GameMode) : "timed";
