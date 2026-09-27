/**
 * What a bot sees and how it plays, on plain objects: like the engine, nothing
 * in here knows about the room, the schema or Colyseus, and it reaches the
 * engine only through its entry point (a test holds it to both). So a bot plays
 * headless exactly as it does in the live room.
 *
 * This is the bots' one way in: anything outside imports it from here.
 */

// What a bot sees, with its reaction delay.
export type { BotView, Decider, ViewedGame } from "./view";
export { Snapshots, viewFor } from "./view";

// The rookie: the first bot.
export type { BotProfile } from "./rookie";
export { decide, rookie, rookieBotProfile } from "./rookie";

// Encoder v1: a view as the numbers a brain reads.
export { ENCODER_SIZE, ENCODER_VERSION, encode } from "./encoder";

// Brains: trained snakes, saved as JSON, played as a `Decider`.
export type { Activation, Brain } from "./brain";
export { BRAIN_FORMAT, BRAIN_FORMAT_VERSION, brainDecider, brainProblems, forward } from "./brain";

// Dummy: the hand-made brain.
export { dummyBrain } from "./dummy";
