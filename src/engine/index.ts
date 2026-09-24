/**
 * The game's rules, on plain objects: nothing in here knows about the room,
 * the schema or Colyseus (a test holds it to that), so a whole round can be
 * played headless and replayed from its seed plus the turns made each tick.
 *
 * Bump this whenever a rule changes, so a recorded game is only ever replayed
 * under the rules it was played by.
 */
export const RULES_VERSION = 1;
